import { useState, useEffect, useRef } from 'react';
import { Plus, X, AlertTriangle, Sparkles, ArrowRight } from 'lucide-react';
import { api, IngredientPreview, RecipeInput, RecipeIngredient, RecipeStatus } from '../lib/api';
import { Course, COURSE_LABELS, COURSES } from '../lib/courses';

const MEAL_TYPES = ['pasta', 'rijst', 'wrap', 'oven', 'salade', 'soep', 'stamppot', 'vrij', 'overig'];
const PRODUCT_GROUPS = ['groenten', 'fruit', 'vis', 'vlees', 'zuivel', 'brood', 'droogwaren', 'kruiden', 'olie', 'sauzen', 'diepvries', 'overig'];
const UNITS = ['g', 'ml', 'el', 'tl', 'stuks', 'teen', 'blik', 'pot', 'zak', 'bos', 'plak', 'snufje', 'takje', 'krop', 'bakje'];

interface Row {
  key: number;
  name: string;
  amount: string;
  unit: string;
  product_group: string;
  note: string;
}

export interface EditorAction {
  label: string;
  /** Status to save with; omitted keeps the recipe's current status. */
  status?: RecipeStatus;
  primary?: boolean;
}

interface Props {
  initial: RecipeInput;
  initialPreview?: IngredientPreview[];
  actions: EditorAction[];
  onSave: (recipe: RecipeInput) => Promise<void>;
}

let nextKey = 1;

function toRow(ing: RecipeIngredient): Row {
  return {
    key: nextKey++,
    name: ing.name,
    amount: ing.amount === null || ing.amount === undefined ? '' : String(ing.amount).replace('.', ','),
    unit: ing.unit || '',
    product_group: ing.product_group || 'overig',
    note: ing.note || '',
  };
}

/** "0,5" -> 0.5; free text like "1-2" is passed on for the server to interpret. */
function toAmount(value: string): number | string | null {
  const v = value.trim();
  if (!v) return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : v;
}

function toIngredient(row: Row): RecipeIngredient {
  return {
    name: row.name.trim(),
    amount: toAmount(row.amount),
    unit: row.unit.trim(),
    product_group: row.product_group,
    note: row.note.trim() || null,
  };
}

/** What a preview depends on; a preview only shows while its row still matches. */
function signature(row: Row): string {
  return [row.name, row.amount, row.unit].map((v) => v.trim().toLowerCase()).join('|');
}

type Previews = Map<number, { sig: string; preview: IngredientPreview }>;

const inputClass = 'w-full min-w-0 px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm';
const labelClass = 'text-xs font-bold text-muted uppercase tracking-wide';

export default function RecipeEditor({ initial, initialPreview, actions, onSave }: Props) {
  const [name, setName] = useState(initial.name);
  const [servings, setServings] = useState(String(initial.servings || 4));
  const [mealType, setMealType] = useState(initial.meal_type || '');
  const [prepTime, setPrepTime] = useState(initial.prep_time_minutes ? String(initial.prep_time_minutes) : '');
  const [costIndex, setCostIndex] = useState(initial.cost_index || '');
  // '' for a recipe whose kind is not known yet; a new recipe starts as hoofdgerecht
  const [course, setCourse] = useState<Course | ''>(initial.course === undefined ? 'hoofdgerecht' : initial.course ?? '');
  const mainCourse = course === 'hoofdgerecht';
  const [vegException, setVegException] = useState(initial.veg_exception ?? false);
  const [start] = useState(() => {
    const initialRows = (initial.ingredients.length ? initial.ingredients : [{ name: '', amount: null, unit: '', product_group: 'overig' }]).map(toRow);
    const previews: Previews = new Map();
    initialRows.forEach((row, i) => {
      if (initialPreview?.[i]) previews.set(row.key, { sig: signature(row), preview: initialPreview[i] });
    });
    return { rows: initialRows, previews };
  });
  const [rows, setRows] = useState<Row[]>(start.rows);
  const [steps, setSteps] = useState(initial.steps.join('\n'));
  const [tip, setTip] = useState(initial.tip || '');
  // Keyed by row, not position, so removing a row never shows its preview on the next one
  const [previews, setPreviews] = useState<Previews>(start.previews);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstPreview = useRef(Boolean(initialPreview));
  const previewRequest = useRef(0);

  // Show how each line lands in the library, refreshed shortly after typing stops
  useEffect(() => {
    if (firstPreview.current) {
      firstPreview.current = false;
      return;
    }
    const timer = setTimeout(() => {
      const request = ++previewRequest.current;
      const asked = rows.map((row) => ({ key: row.key, sig: signature(row) }));
      api.previewIngredients(rows.map(toIngredient))
        .then((result) => {
          if (request !== previewRequest.current) return; // a newer request is on its way
          setPreviews(new Map(asked.map((a, i) => [a.key, { sig: a.sig, preview: result[i] }])));
        })
        .catch(() => {
          if (request === previewRequest.current) setPreviews(new Map());
        });
    }, 400);
    return () => clearTimeout(timer);
  }, [rows]);

  function previewFor(row: Row): IngredientPreview | undefined {
    const entry = previews.get(row.key);
    return row.name.trim() && entry && entry.sig === signature(row) ? entry.preview : undefined;
  }

  function updateRow(key: number, patch: Partial<Row>) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function save(action: EditorAction) {
    setError(null);
    const ingredients = rows.map(toIngredient).filter((i) => i.name);
    if (!name.trim()) { setError('Geef het recept een naam'); return; }
    if (ingredients.length === 0) { setError('Voeg minstens één ingrediënt toe'); return; }

    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        status: action.status ?? initial.status,
        servings: Math.max(1, parseInt(servings, 10) || 4),
        meal_type: mealType || null,
        prep_time_minutes: prepTime ? parseInt(prepTime, 10) || null : null,
        cost_index: costIndex || null,
        // Not chosen yet: leave it to the bulk run
        course: course || undefined,
        veg_exception: mainCourse && vegException,
        ingredients,
        steps: steps.split('\n').map((s) => s.trim()).filter(Boolean),
        tip: tip.trim() || null,
        nutrition_per_serving: initial.nutrition_per_serving,
      });
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  const shown = rows.map(previewFor).filter((p): p is IngredientPreview => Boolean(p));
  const newCount = shown.filter((p) => p.match === 'new').length;
  const splitCount = shown.filter((p) => !p.adds_up).length;

  return (
    <div className="space-y-6 text-sm">
      <div className="bg-white rounded-3xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03)] space-y-4">
        <label className="block">
          <span className={labelClass}>Naam</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={`${inputClass} mt-1 text-base font-bold`} />
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="block">
            <span className={labelClass}>Personen</span>
            <input value={servings} onChange={(e) => setServings(e.target.value)} inputMode="numeric" className={`${inputClass} mt-1`} />
          </label>
          <label className="block">
            <span className={labelClass}>Minuten</span>
            <input value={prepTime} onChange={(e) => setPrepTime(e.target.value)} inputMode="numeric" className={`${inputClass} mt-1`} />
          </label>
          <label className="block">
            <span className={labelClass}>Type</span>
            <select value={mealType} onChange={(e) => setMealType(e.target.value)} className={`${inputClass} mt-1`}>
              <option value="">–</option>
              {!MEAL_TYPES.includes(mealType) && mealType && <option value={mealType}>{mealType}</option>}
              {MEAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>Kosten</span>
            <select value={costIndex} onChange={(e) => setCostIndex(e.target.value)} className={`${inputClass} mt-1`}>
              <option value="">–</option>
              {['€', '€€', '€€€'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <label className="flex items-center gap-2">
            <span className={labelClass}>Soort</span>
            <select value={course} onChange={(e) => setCourse(e.target.value as Course | '')} aria-label="Soort gerecht"
              className="px-3 py-1.5 border border-gray-200 rounded-xl bg-white text-sm">
              {course === '' && <option value="">nog onbekend</option>}
              {COURSES.map((c) => <option key={c} value={c}>{COURSE_LABELS[c]}</option>)}
            </select>
            {mainCourse && <span className="text-muted">(komt in het weekmenu)</span>}
          </label>
          {mainCourse && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={vegException} onChange={(e) => setVegException(e.target.checked)} />
              Uitzondering op de groentenorm <span className="text-muted">(zoals pizza; 250 g met bijgerecht)</span>
            </label>
          )}
        </div>
      </div>

      <div className="bg-white rounded-3xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
        <div className="flex items-baseline justify-between gap-2 mb-3">
          <h2 className="font-bold text-sm tracking-wide text-accent uppercase">Ingrediënten</h2>
          <span className="text-xs text-muted">
            {newCount > 0 && `${newCount} nieuw`}
            {newCount > 0 && splitCount > 0 && ' · '}
            {splitCount > 0 && `${splitCount} telt niet op`}
          </span>
        </div>
        <datalist id="recipe-units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
        <div className="divide-y divide-gray-100">
          {rows.map((row) => (
            <IngredientRow
              key={row.key}
              row={row}
              preview={previewFor(row)}
              onChange={(patch) => updateRow(row.key, patch)}
              onRemove={() => setRows((current) => current.filter((r) => r.key !== row.key))}
            />
          ))}
        </div>
        <button
          onClick={() => setRows((current) => [...current, toRow({ name: '', amount: null, unit: '', product_group: 'overig' })])}
          className="mt-3 flex items-center gap-1.5 text-xs font-bold text-warmth-500 hover:text-warmth-600">
          <Plus size={14} /> Ingrediënt toevoegen
        </button>
      </div>

      <div className="bg-white rounded-3xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03)] space-y-4">
        <label className="block">
          <span className={labelClass}>Bereiding — één stap per regel</span>
          <textarea value={steps} onChange={(e) => setSteps(e.target.value)} rows={Math.max(4, steps.split('\n').length + 1)}
            className={`${inputClass} mt-1 leading-relaxed`} />
        </label>
        <label className="block">
          <span className={labelClass}>Tip</span>
          <input value={tip} onChange={(e) => setTip(e.target.value)} className={`${inputClass} mt-1`} />
        </label>
      </div>

      {error && <div className="bg-red-50 text-red-600 p-3 rounded-2xl">{error}</div>}

      <div className="flex flex-col sm:flex-row gap-3">
        {actions.map((action) => (
          <button key={action.label} onClick={() => save(action)} disabled={saving}
            className={`flex-1 py-3.5 rounded-2xl font-bold transition-colors disabled:opacity-50 ${
              action.primary
                ? 'bg-warmth-500 text-white shadow-[0_10px_30px_rgba(242,153,74,0.3)] hover:bg-warmth-600'
                : 'bg-white text-ink shadow-[0_2px_10px_rgba(0,0,0,0.04)] hover:bg-gray-50'
            }`}>
            {saving ? 'Opslaan...' : action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function IngredientRow({ row, preview, onChange, onRemove }: {
  row: Row;
  preview?: IngredientPreview;
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="py-3 space-y-2">
      <div className="flex gap-2 items-center">
        <input value={row.amount} onChange={(e) => onChange({ amount: e.target.value })} placeholder="aantal" inputMode="decimal"
          className={`${inputClass} !w-16 shrink-0`} aria-label="Hoeveelheid" />
        <input value={row.unit} onChange={(e) => onChange({ unit: e.target.value })} placeholder="eenheid" list="recipe-units"
          className={`${inputClass} !w-20 shrink-0`} aria-label="Eenheid" />
        <input value={row.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="ingrediënt"
          className={`${inputClass} flex-1 font-medium`} aria-label="Ingrediënt" />
        <button onClick={onRemove} className="text-muted hover:text-red-500 shrink-0 p-1" aria-label={`${row.name || 'Regel'} verwijderen`}>
          <X size={16} />
        </button>
      </div>
      <div className="flex gap-2 items-center flex-wrap">
        <select value={row.product_group} onChange={(e) => onChange({ product_group: e.target.value })}
          className={`${inputClass} !w-32 shrink-0 !py-1.5 text-xs`} aria-label="Productgroep">
          {!PRODUCT_GROUPS.includes(row.product_group) && <option value={row.product_group}>{row.product_group}</option>}
          {PRODUCT_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <input value={row.note} onChange={(e) => onChange({ note: e.target.value })} placeholder="opmerking (gesnipperd, uitgelekt…)"
          className={`${inputClass} flex-1 !py-1.5 text-xs min-w-[10rem]`} aria-label="Opmerking" />
        {preview && <PreviewBadge preview={preview} onAdopt={(name) => onChange({ name })} />}
      </div>
    </div>
  );
}

function PreviewBadge({ preview, onAdopt }: { preview: IngredientPreview; onAdopt: (name: string) => void }) {
  if (!preview.adds_up) {
    return (
      <span className="flex items-center gap-1 text-xs text-warmth-600 font-bold" title="Voeg een omrekening toe bij Ingrediënten beheren">
        <AlertTriangle size={12} /> telt niet op met {preview.base_unit}
      </span>
    );
  }
  if (preview.match === 'new' && preview.suggestion) {
    const suggestion = preview.suggestion;
    return (
      <button onClick={() => onAdopt(suggestion)} className="flex items-center gap-1 text-xs text-accent font-bold hover:underline"
        title={`Nieuw ingrediënt "${preview.canonical}" — klik om "${suggestion}" te gebruiken`}>
        <Sparkles size={12} /> nieuw — bedoel je {suggestion}?
      </button>
    );
  }
  if (preview.match === 'new') {
    return <span className="flex items-center gap-1 text-xs text-accent font-bold"><Sparkles size={12} /> nieuw: {preview.canonical}</span>;
  }
  if (preview.match === 'alias') {
    return <span className="flex items-center gap-1 text-xs text-muted"><ArrowRight size={12} /> {preview.canonical}</span>;
  }
  return null;
}
