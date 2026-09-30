// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import {
  STYLE_REFERENCE, UnusablePicture, buildPrompt, handleSession, parseArgs, toWebp, type QueueItem,
} from '../scripts/generate-recipe-images';
import { isWebp } from '../server/services/recipe-images';

const item = (id: number, name: string, extra: Partial<QueueItem> = {}): QueueItem => ({
  id, name, meal_type: null, ingredients: [], method: '', requested_at: null, ...extra,
});

/** A white plate on a transparent (or, when opaque, grey) square. */
async function plate(size: number, opaque = false): Promise<Buffer> {
  const circle = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.42}" fill="#fff"/></svg>`);
  return sharp({
    create: { width: size, height: size, channels: 4, background: opaque ? { r: 200, g: 200, b: 200, alpha: 1 } : { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: circle }]).png().toBuffer();
}

describe('options', () => {
  it('defaults to a small run against production', () => {
    expect(parseArgs([], {})).toEqual({ url: 'https://weekmenu.c4w.nl', limit: 10, batch: 4, dryRun: false });
  });

  it('reads flags and the URL from the environment, without a trailing slash', () => {
    expect(parseArgs(['--limit', '25', '--batch', '2', '--dry-run'], { WEEKMENU_URL: 'http://localhost:3001/' }))
      .toEqual({ url: 'http://localhost:3001', limit: 25, batch: 2, dryRun: true });
  });

  it('refuses nonsense instead of guessing', () => {
    expect(() => parseArgs(['--limit', '0'], {})).toThrow('--limit moet tussen 1 en 100 liggen');
    expect(() => parseArgs(['--batch', 'veel'], {})).toThrow('--batch moet tussen 1 en 10 liggen');
    expect(() => parseArgs(['--limit'], {})).toThrow('--limit heeft een waarde nodig');
    expect(() => parseArgs(['--all'], {})).toThrow('Onbekende optie --all');
  });
});

describe('prompt', () => {
  it('names one file per recipe after its id, with what the dish is made of', () => {
    const prompt = buildPrompt([
      item(12, 'Kabeljauw met groente uit de oven', {
        meal_type: 'oven', ingredients: ['prei', 'kabeljauwfilet'], method: 'Verwarm de oven voor.',
      }),
      item(40, 'Warme halloumi salade'),
    ]);
    expect(prompt).toContain('### 12.png — "Kabeljauw met groente uit de oven"\nType: oven\nIngredients: prei, kabeljauwfilet\nMethod (start): Verwarm de oven voor.');
    expect(prompt).toContain('### 40.png — "Warme halloumi salade"');
    expect(prompt).not.toContain('Ingredients: \n');
  });

  it('asks for the house style with a real transparent background', () => {
    const prompt = buildPrompt([item(1, 'Stamppot')]);
    expect(prompt).toContain('built-in `image_gen`');
    expect(prompt).toContain('fully transparent background (real alpha channel)');
    expect(prompt).toContain('top-down');
  });

  it('uses an existing meal icon as style reference', () => {
    expect(fs.existsSync(STYLE_REFERENCE)).toBe(true);
  });
});

describe('conversion', () => {
  it('turns a transparent picture into a 512px webp that keeps its transparency', async () => {
    const out = await toWebp(await plate(1024));
    expect(isWebp(out)).toBe(true);
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height, meta.hasAlpha]).toEqual([512, 512, true]);
    expect((await sharp(out).stats()).isOpaque).toBe(false);
    expect(out.length).toBeLessThan(100 * 1024);
  });

  it('keeps a picture that is not square whole', async () => {
    const wide = await sharp(await plate(1024)).resize(1024, 768, { fit: 'fill' }).png().toBuffer();
    const meta = await sharp(await toWebp(wide)).metadata();
    expect([meta.width, meta.height]).toEqual([512, 512]);
  });

  it('refuses a picture without transparency', async () => {
    await expect(toWebp(await plate(256, true))).rejects.toBeInstanceOf(UnusablePicture);
  });
});

describe('after a Codex session', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

  function session(files: Record<string, Buffer>) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weekmenu-session-test-'));
    dirs.push(dir);
    for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), data);
    return dir;
  }
  const weekmenu = () => ({ upload: vi.fn().mockResolvedValue(undefined), reportError: vi.fn().mockResolvedValue(undefined) });
  const quiet = () => {};

  it('uploads what was made and reports what was not, with the request each one had', async () => {
    const asked = item(2, 'Linzensoep', { requested_at: '2026-09-30T10:00:00.000Z' });
    const dir = session({ '1.png': await plate(256) });
    const api = weekmenu();

    expect(await handleSession(dir, [item(1, 'Stamppot'), asked], api, quiet)).toEqual({ saved: 1, refused: 1 });
    expect(api.upload).toHaveBeenCalledWith(item(1, 'Stamppot'), expect.any(Buffer));
    expect(api.reportError).toHaveBeenCalledWith(asked, 'Codex leverde geen plaatje');
  });

  it('reports a picture without transparency instead of uploading it', async () => {
    const dir = session({ '1.png': await plate(256), '2.png': await plate(256, true) });
    const api = weekmenu();
    await handleSession(dir, [item(1, 'Stamppot'), item(2, 'Linzensoep')], api, quiet);
    expect(api.upload).toHaveBeenCalledTimes(1);
    expect(api.reportError).toHaveBeenCalledWith(item(2, 'Linzensoep'), 'Geen transparante achtergrond');
  });

  it('stops without reporting anything when the session made no picture at all', async () => {
    const api = weekmenu();
    await expect(handleSession(session({}), [item(1, 'Stamppot'), item(2, 'Linzensoep')], api, quiet))
      .rejects.toThrow('Codex maakte geen enkel plaatje');
    expect(api.reportError).not.toHaveBeenCalled();
  });

  it('stops when Weekmenu refuses an upload, rather than marking recipes as failed', async () => {
    const api = weekmenu();
    api.upload.mockRejectedValue(new Error('Weekmenu /recipes/1/image: Ongeldig image-worker token'));
    await expect(handleSession(session({ '1.png': await plate(256) }), [item(1, 'Stamppot')], api, quiet))
      .rejects.toThrow('Ongeldig image-worker token');
    expect(api.reportError).not.toHaveBeenCalled();
  });
});
