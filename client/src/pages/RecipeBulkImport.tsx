import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Upload, ClipboardCopy, Check, AlertTriangle, Loader2, Search } from 'lucide-react';
import { api, RecipeInput } from '../lib/api';
import { detectFormat, recipesFromJson } from '../lib/bulkImport';

type Status = 'idle' | 'busy' | 'saved' | 'exists' | 'error';

interface Item {
  key: number;
  title: string;
  /** Markdown to read with the model, or a recipe that is already structured. */
  text?: string;
  recipe?: Partial<RecipeInput>;
  existing: boolean;
  selected: boolean;
  status: Status;
  message?: string;
}

// Parallel requests while importing; each one is a model call of a few seconds
const CONCURRENCY = 3;
// The server takes request bodies up to 1 MB
const MAX_FILE_BYTES = 900_000;

/** Structured recipe from JSON, made acceptable for saving as concept. */
function toInput(recipe: Partial<RecipeInput>, source: string): RecipeInput & { source: string } {
  return {
    name: String(recipe.name ?? '').trim(),
    status: 'concept',
    servings: Number(recipe.servings) || 4,
    meal_type: recipe.meal_type ?? null,
    prep_time_minutes: Number.isInteger(recipe.prep_time_minutes) ? recipe.prep_time_minutes! : null,
    cost_index: recipe.cost_index ?? null,
    ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients : [],
    steps: Array.isArray(recipe.steps) ? recipe.steps.filter((s) => typeof s === 'string' && s.trim()) : [],
    tip: recipe.tip ?? null,
    nutrition_per_serving: recipe.nutrition_per_serving ?? null,
    source,
  };
}

export default function RecipeBulkImport() {
  const [fileName, setFileName] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [running, setRunning] = useState(false);
  const [runKeys, setRunKeys] = useState<Set<number>>(new Set());
  const [parserAvailable, setParserAvailable] = useState<boolean | null>(null);
  const [formatText, setFormatText] = useState<string | null>(null);
  const [formatCopied, setFormatCopied] = useState(false);
  const stopRequested = useRef(false);

  useEffect(() => {
    api.getParserStatus().then((s) => setParserAvailable(s.configured)).catch(() => setParserAvailable(false));
  }, []);

  function update(key: number, patch: Partial<Item>) {
    setItems((current) => current.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }

  async function handleFile(file: File) {
    setError(null);
    setItems([]);
    setFileName(file.name);
    if (file.size > MAX_FILE_BYTES) {
      setError(`Bestand is te groot (${Math.round(file.size / 1000)} kB, max ${MAX_FILE_BYTES / 1000} kB). Splits het in delen.`);
      return;
    }
    setLoading(true);
    try {
      const text = await file.text();
      if (detectFormat(file.name, text) === 'json') {
        const known = new Set((await api.getRecipes()).recipes.map((r) => r.name.toLowerCase()));
        setItems(recipesFromJson(text).map((recipe, i) => {
          const title = String(recipe.name ?? '').trim() || `Recept ${i + 1}`;
          const existing = known.has(title.toLowerCase());
          return { key: i, title, recipe, existing, selected: !existing, status: 'idle' };
        }));
      } else {
        const { candidates } = await api.splitRecipes(text);
        setItems(candidates.map((c, i) => ({
          key: i, title: c.title, text: c.text, existing: Boolean(c.existing), selected: !c.existing, status: 'idle',
        })));
        if (candidates.length === 0) setError('Geen recepten gevonden: het bestand heeft geen koppen met ingrediëntenlijsten eronder.');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function importOne(item: Item) {
    update(item.key, { status: 'busy', message: undefined });
    try {
      if (item.recipe) await api.createRecipe(toInput(item.recipe, fileName));
      else await api.importRecipeText(item.text!, item.title, fileName);
      update(item.key, { status: 'saved', selected: false });
    } catch (err) {
      const message = (err as Error).message;
      update(item.key, { status: /al een recept/.test(message) ? 'exists' : 'error', message });
    }
  }

  async function handleImport() {
    const queue = items.filter((i) => i.selected && i.status !== 'saved' && i.status !== 'exists');
    stopRequested.current = false;
    setRunKeys(new Set(queue.map((i) => i.key)));
    setRunning(true);
    const worker = async () => {
      while (queue.length && !stopRequested.current) await importOne(queue.shift()!);
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setRunning(false);
  }

  async function copyFormat() {
    try {
      const { text } = await api.getBulkFormat();
      setFormatText(text);
      await navigator.clipboard.writeText(text);
      setFormatCopied(true);
    } catch {
      setFormatCopied(false); // the text is shown for manual copying
    }
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? items.filter((i) => i.title.toLowerCase().includes(q)) : items;
  }, [items, search]);

  /** Select or clear what the search shows. By key: the update may see newer objects than this render's list. */
  function selectVisible(select: boolean) {
    const keys = new Set(visible.map((i) => i.key));
    setItems((current) => current.map((i) => (
      keys.has(i.key) && (!select || i.status !== 'saved') ? { ...i, selected: select } : i
    )));
  }

  const needsModel = items.some((i) => i.text !== undefined);
  const selected = items.filter((i) => i.selected && i.status !== 'saved' && i.status !== 'exists');
  const inRun = items.filter((i) => runKeys.has(i.key));
  const runDone = inRun.filter((i) => ['saved', 'exists', 'error'].includes(i.status)).length;
  const saved = items.filter((i) => i.status === 'saved').length;
  const failed = items.filter((i) => i.status === 'error').length;
  const inProgress = running || items.some((i) => i.status === 'busy');

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto pt-8 md:pt-12 pb-32">
      <Link to="/recepten/nieuw" className="flex items-center gap-2 text-muted text-sm mb-6 hover:text-ink transition-colors">
        <ArrowLeft size={16} /> recept toevoegen
      </Link>

      <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2">Meerdere recepten importeren</h1>
      <p className="text-sm text-muted mb-6">
        Kies een kookboek als <strong>.md</strong>: de app vindt de recepten per kop en leest ze in. Of een <strong>.json</strong>-bestand
        dat Claude in het juiste formaat heeft gemaakt. Alles komt als concept binnen; keur daarna goed wat je wilt houden.
      </p>

      <div className="bg-white rounded-3xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03)] mb-4 space-y-4">
        <label className={`flex items-center justify-center gap-2 py-3.5 rounded-2xl font-bold transition-colors cursor-pointer ${
          inProgress ? 'bg-gray-100 text-muted pointer-events-none' : 'bg-warmth-500 text-white hover:bg-warmth-600'
        }`}>
          <Upload size={18} /> {fileName && items.length ? 'Ander bestand kiezen' : 'Kies een bestand'}
          <input type="file" accept=".md,.markdown,.txt,.json" className="hidden" disabled={inProgress}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
        </label>

        <div className="text-xs text-muted">
          Laat je Claude de recepten omzetten?{' '}
          <button onClick={copyFormat} className="font-bold text-warmth-500 hover:text-warmth-600 inline-flex items-center gap-1">
            {formatCopied ? <Check size={12} /> : <ClipboardCopy size={12} />}
            {formatCopied ? 'Instructie gekopieerd' : 'Kopieer de instructie voor Claude'}
          </button>
          {' '}en bewaar het antwoord als <code>.json</code>.
        </div>
        {formatText && !formatCopied && (
          <textarea readOnly value={formatText} rows={6} onFocus={(e) => e.currentTarget.select()}
            className="w-full p-3 bg-cream-50 rounded-2xl text-xs text-muted font-mono" />
        )}
      </div>

      {error && <div className="bg-red-50 text-red-600 p-3 rounded-2xl mb-4 text-sm">{error}</div>}
      {loading && <div className="text-center py-8 text-muted">Bestand lezen...</div>}

      {items.length > 0 && (
        <>
          {needsModel && parserAvailable === false && (
            <div className="bg-warmth-400/20 p-3 rounded-2xl mb-4 text-sm">
              Recepten inlezen is op deze server niet ingesteld. Gebruik een .json-bestand van Claude.
            </div>
          )}

          <div className="flex items-center justify-between gap-3 mb-3 text-sm">
            <span className="text-muted">
              {items.length} gevonden in <strong className="text-ink">{fileName}</strong>
              {items.some((i) => i.existing) && ` · ${items.filter((i) => i.existing).length} al in de bibliotheek`}
            </span>
            <span className="flex gap-3 shrink-0">
              <button disabled={inProgress} className="font-bold text-warmth-500 disabled:opacity-50"
                onClick={() => selectVisible(true)}>
                Alles
              </button>
              <button disabled={inProgress} className="font-bold text-warmth-500 disabled:opacity-50"
                onClick={() => selectVisible(false)}>
                Niets
              </button>
            </span>
          </div>

          <div className="relative mb-3">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Zoek in de gevonden recepten..."
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-2xl text-sm bg-white" />
          </div>

          <div className="mb-4">
            {inProgress ? (
              <div className="flex items-center gap-3 bg-white rounded-2xl p-3 shadow-[0_10px_30px_rgba(0,0,0,0.1)]">
                <div className="flex-1">
                  <div className="text-sm font-bold mb-1.5">
                    {runDone} van {inRun.length} verwerkt
                    {failed > 0 && <span className="text-red-500 font-normal"> · {failed} fout</span>}
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-warmth-500 transition-all" style={{ width: `${(runDone / Math.max(1, inRun.length)) * 100}%` }} />
                  </div>
                </div>
                <button onClick={() => { stopRequested.current = true; }}
                  className="px-4 py-2 rounded-xl font-bold text-sm bg-gray-100 hover:bg-gray-200">Stop</button>
              </div>
            ) : (
              <button onClick={handleImport}
                disabled={selected.length === 0 || (needsModel && parserAvailable === false)}
                className="w-full py-4 bg-warmth-500 text-white rounded-2xl font-bold shadow-[0_10px_30px_rgba(242,153,74,0.3)] hover:bg-warmth-600 transition-colors disabled:opacity-50">
                {selected.length === 0 ? 'Niets geselecteerd' : `Importeer ${selected.length} ${selected.length === 1 ? 'recept' : 'recepten'} als concept`}
              </button>
            )}
          </div>

          {!inProgress && saved > 0 && (
            <p className="text-sm text-center mb-4">
              {saved} opgeslagen als concept{failed > 0 && `, ${failed} niet gelukt`}.{' '}
              <Link to="/recepten?status=concept" className="font-bold text-warmth-500 hover:text-warmth-600">Bekijk de concepten →</Link>
            </p>
          )}
          <div className="bg-white rounded-3xl divide-y divide-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.03)] max-h-[50vh] overflow-y-auto">
            {visible.map((item) => (
              <label key={item.key} className="flex items-start gap-3 px-5 py-3 text-sm cursor-pointer">
                <input type="checkbox" className="mt-0.5 shrink-0" checked={item.selected}
                  disabled={inProgress || item.status === 'saved'}
                  onChange={(e) => update(item.key, { selected: e.target.checked })} />
                <span className="flex-1 min-w-0">
                  <span className={`block ${item.status === 'saved' ? 'text-muted line-through' : 'font-medium'}`}>{item.title}</span>
                  {item.existing && item.status === 'idle' && <span className="text-xs text-accent">staat al in de bibliotheek</span>}
                  {item.status === 'error' && item.message && <span className="text-xs text-red-500 block">{item.message}</span>}
                </span>
                <StatusIcon status={item.status} />
              </label>
            ))}
          </div>

        </>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: Status }) {
  if (status === 'busy') return <Loader2 size={16} className="animate-spin text-muted shrink-0" />;
  if (status === 'saved') return <Check size={16} className="text-green-500 shrink-0" />;
  if (status === 'exists') return <span className="text-xs text-muted shrink-0">bestond al</span>;
  if (status === 'error') return <AlertTriangle size={16} className="text-red-500 shrink-0" />;
  return null;
}
