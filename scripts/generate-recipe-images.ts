/**
 * Make pictures for the recipes that need one and upload them to Weekmenu.
 *
 * Runs on a Mac with the ChatGPT app: Codex's built-in image generation uses
 * the ChatGPT subscription (no API key) and returns real transparency. Each
 * picture follows the style of the existing meal icons, one of which goes
 * along as reference.
 *
 *   IMAGE_WORKER_TOKEN=… npx tsx scripts/generate-recipe-images.ts [--limit 10] [--batch 4] [--url …] [--dry-run]
 *
 * --limit   how many recipes this run (default 10, max 100)
 * --batch   recipes per Codex session (default 4); fewer means less lost on a hiccup
 * --url     Weekmenu base URL (default $WEEKMENU_URL or https://weekmenu.c4w.nl)
 * --dry-run show the queue and the prompt, generate nothing
 *
 * A picture Codex made but that cannot be used (no transparency) is reported:
 * that recipe waits until someone asks again in the app. A picture that is
 * missing is not held against the recipe, since it may be Codex running out of
 * quota halfway; it stays queued for the next run. When Codex itself fails (an
 * error, or a session without a single picture) the run stops. A result for a
 * recipe whose picture changed meanwhile (another run, a new request) is
 * refused by Weekmenu as stale and skipped.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import sharp from 'sharp';

export interface QueueItem {
  id: number;
  name: string;
  meal_type: string | null;
  ingredients: string[];
  method: string;
  /** With image_version the state this job is for; sent back with the result. */
  requested_at: string | null;
  image_version: number | null;
}

export interface Options {
  url: string;
  limit: number;
  batch: number;
  dryRun: boolean;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** One of the existing meal icons; its look is what new pictures copy. */
export const STYLE_REFERENCE = path.join(ROOT, 'client/public/icons/meals/aloo-gobi.png');
const APP_CODEX = '/Applications/ChatGPT.app/Contents/Resources/codex';
const MINUTES_PER_PICTURE = 6;
const SIZE = 512;

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): Options {
  const options: Options = {
    url: env.WEEKMENU_URL || 'https://weekmenu.c4w.nl',
    limit: 10,
    batch: 4,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} heeft een waarde nodig`);
      return next;
    };
    const count = (max: number) => {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`${arg} moet tussen 1 en ${max} liggen`);
      return n;
    };
    if (arg === '--limit') options.limit = count(100);
    else if (arg === '--batch') options.batch = count(10);
    else if (arg === '--url') options.url = value();
    else if (arg === '--dry-run') options.dryRun = true;
    else throw new Error(`Onbekende optie ${arg}`);
  }
  options.url = options.url.replace(/\/+$/, '');
  return options;
}

export function pictureFile(item: QueueItem): string {
  return `${item.id}.png`;
}

/** Instructions for one Codex session: one picture per recipe, saved as <id>.png. */
export function buildPrompt(items: QueueItem[]): string {
  const recipes = items.map((item) => [
    `### ${pictureFile(item)} — "${item.name}"`,
    item.meal_type ? `Type: ${item.meal_type}` : null,
    item.ingredients.length ? `Ingredients: ${item.ingredients.join(', ')}` : null,
    item.method ? `Method (start): ${item.method}` : null,
  ].filter(Boolean).join('\n')).join('\n\n');

  return `Use the imagegen skill in its default built-in \`image_gen\` tool mode (not the CLI fallback; there is no OPENAI_API_KEY).

Image 1 (attached) is a STYLE REFERENCE from the meal icons of a family meal-planning app. Match its style, not its dish:
- photorealistic food photo, shot straight from above (90° top-down)
- the dish on a plain round white plate, or in a plain white bowl when that suits the dish (soup, stew, curry, salad), centered, filling about 85% of a square frame
- soft even daylight, subtle natural shadow under the plate
- fully transparent background (real alpha channel) around the plate
- no table, no cutlery, no napkins, no props or garnish outside the plate, no text, no watermark

The recipes below are Dutch. For each one, work out from the name, ingredients and method what the finished dish looks like when served, and make one picture of it: a separate \`image_gen\` call per recipe, square 1024x1024, transparent background. Save each final picture in the current working directory under exactly the file name given. If one fails, go on with the next. Do not create or change anything outside the current working directory.

${recipes}

Finish with one line per file name: saved, or why not.
`;
}

/** A picture Codex made that cannot be used; reported so the recipe waits for a new request. */
export class UnusablePicture extends Error {}

/** Square 512px webp for the app. The style needs a transparent background, so an opaque picture is refused. */
export async function toWebp(png: Buffer): Promise<Buffer> {
  const stats = await sharp(png).stats();
  if (stats.isOpaque) throw new UnusablePicture('Geen transparante achtergrond');
  return sharp(png)
    .resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 82, alphaQuality: 90 })
    .toBuffer();
}

function codexBin(env: NodeJS.ProcessEnv): string {
  if (env.CODEX_BIN) return env.CODEX_BIN;
  return fs.existsSync(APP_CODEX) ? APP_CODEX : 'codex';
}

/** One Codex session in `dir`; resolves when it ends well, rejects when Codex itself fails. */
function runCodex(dir: string, prompt: string, pictures: number): Promise<void> {
  const log = fs.openSync(path.join(dir, 'codex.log'), 'w');
  const child = spawn(codexBin(process.env), [
    'exec', '--skip-git-repo-check', '-C', dir, '-s', 'workspace-write',
    '-i', STYLE_REFERENCE,
    '-o', path.join(dir, 'last-message.md'),
    '-',
  ], { cwd: dir, stdio: ['pipe', log, log] });
  child.stdin?.end(prompt);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => child.kill('SIGTERM'), pictures * MINUTES_PER_PICTURE * 60_000);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Codex start niet (${err.message}); zet CODEX_BIN`));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      fs.closeSync(log);
      if (code === 0) resolve();
      else reject(new Error(`Codex stopte (${signal ?? `exit ${code}`}); zie ${path.join(dir, 'codex.log')}`));
    });
  });
}

/** Weekmenu refused a result because the recipe's picture changed since the queue was fetched. */
export class StaleJob extends Error {}

/** What the script needs from Weekmenu after a Codex session. */
export interface Uploader {
  upload(item: QueueItem, webp: Buffer): Promise<void>;
  reportError(item: QueueItem, message: string): Promise<void>;
}

/**
 * Upload what one Codex session made. An unusable picture is reported, so the
 * recipe waits for a new request; a missing one is left queued. A session that
 * made nothing at all points at Codex itself (quota, login) and stops the run.
 */
export async function handleSession(dir: string, items: QueueItem[], weekmenu: Uploader, log: (line: string) => void = console.log) {
  const made = items.filter((item) => fs.existsSync(path.join(dir, pictureFile(item))));
  if (made.length === 0) {
    throw new Error(`Codex maakte geen enkel plaatje; zie ${path.join(dir, 'codex.log')} en ${path.join(dir, 'last-message.md')}`);
  }

  const counts = { saved: 0, refused: 0, missing: 0, stale: 0 };
  for (const item of items) {
    if (!made.includes(item)) {
      counts.missing++;
      log(`  – ${item.name}: geen plaatje, blijft in de wachtrij`);
      continue;
    }
    try {
      try {
        await weekmenu.upload(item, await toWebp(fs.readFileSync(path.join(dir, pictureFile(item)))));
        counts.saved++;
        log(`  ✓ ${item.name}`);
      } catch (err) {
        if (!(err instanceof UnusablePicture)) throw err;
        await weekmenu.reportError(item, err.message);
        counts.refused++;
        log(`  ✗ ${item.name}: ${err.message}`);
      }
    } catch (err) {
      if (!(err instanceof StaleJob)) throw err;
      counts.stale++;
      log(`  – ${item.name}: intussen veranderd of opnieuw aangevraagd, overgeslagen`);
    }
  }
  return counts;
}

class Weekmenu implements Uploader {
  constructor(private url: string, private token: string) {}

  private async call(route: string, init: RequestInit = {}): Promise<unknown> {
    const res = await fetch(`${this.url}/api/image-worker${route}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, ...(init.headers as Record<string, string>) },
    });
    const body = await res.json().catch(() => ({})) as { error?: string };
    if (res.status === 409) throw new StaleJob(body.error ?? 'verouderd');
    if (!res.ok) throw new Error(`Weekmenu ${route}: ${body.error ?? `HTTP ${res.status}`}`);
    return body;
  }

  async queue(limit: number): Promise<QueueItem[]> {
    return ((await this.call(`/queue?limit=${limit}`)) as { recipes: QueueItem[] }).recipes;
  }

  async upload(item: QueueItem, webp: Buffer): Promise<void> {
    await this.call(`/recipes/${item.id}/image`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'image/webp',
        'X-Image-Version': item.image_version === null ? '' : String(item.image_version),
        'X-Image-Request': item.requested_at ?? '',
      },
      body: new Uint8Array(webp),
    });
  }

  async reportError(item: QueueItem, message: string): Promise<void> {
    await this.call(`/recipes/${item.id}/image-error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, image_version: item.image_version, requested_at: item.requested_at }),
    });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const token = process.env.IMAGE_WORKER_TOKEN;
  if (!token) throw new Error('Zet IMAGE_WORKER_TOKEN (dezelfde als in de .env van Weekmenu)');
  if (!fs.existsSync(STYLE_REFERENCE)) throw new Error(`Stijlvoorbeeld ontbreekt: ${STYLE_REFERENCE}`);

  const weekmenu = new Weekmenu(options.url, token);
  const queue = await weekmenu.queue(options.limit);
  console.log(`${queue.length} recept(en) in de wachtrij`);
  if (queue.length === 0) return;

  if (options.dryRun) {
    for (const item of queue) console.log(`- ${item.id} ${item.name}${item.requested_at ? ' (gevraagd)' : ''}`);
    console.log(`\n--- prompt voor de eerste ${Math.min(options.batch, queue.length)} ---\n`);
    console.log(buildPrompt(queue.slice(0, options.batch)));
    return;
  }

  const total = { saved: 0, refused: 0, missing: 0, stale: 0 };
  for (let start = 0; start < queue.length; start += options.batch) {
    const items = queue.slice(start, start + options.batch);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weekmenu-images-'));
    console.log(`\nCodex maakt ${items.map((i) => i.name).join(', ')} …`);
    await runCodex(dir, buildPrompt(items), items.length);
    const result = await handleSession(dir, items, weekmenu);
    for (const key of Object.keys(total) as Array<keyof typeof total>) total[key] += result[key];
    // Kept on failure (the throw above skips this), for the Codex log
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\nKlaar: ${total.saved} opgeslagen, ${total.refused} onbruikbaar, `
    + `${total.missing} niet gemaakt (blijven in de wachtrij), ${total.stale} verouderd`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}
