import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Search, AlertTriangle, Copy, ChevronDown, X } from 'lucide-react';
import { api, Ingredient } from '../lib/api';

const PRODUCT_GROUPS = ['groenten', 'fruit', 'vis', 'vlees', 'zuivel', 'brood', 'droogwaren', 'kruiden', 'olie', 'sauzen', 'diepvries', 'overig'];

const GROUP_EMOJI: Record<string, string> = {
  groenten: '🥬', fruit: '🍎', vis: '🐟', vlees: '🥩', zuivel: '🧀', brood: '🍞',
  droogwaren: '📦', kruiden: '🌿', olie: '🫒', sauzen: '🥫', diepvries: '❄️', overig: '🛒',
};

const WEIGHT_UNITS = ['g', 'ml'];
const VOLUME_UNITS = ['ml', 'tl', 'el'];

type Filter = 'attention' | 'duplicates' | 'all';

export default function IngredientManager() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('attention');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      setIngredients(await api.getIngredients());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  /** Run a mutation, then reload; errors show in the banner, a returned string as notice. */
  async function run(fn: () => Promise<unknown>, nextOpenId?: number | null) {
    setError(null);
    setNotice(null);
    try {
      const message = await fn();
      if (typeof message === 'string') setNotice(message);
      await load();
      if (nextOpenId !== undefined) setOpenId(nextOpenId);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const attentionCount = ingredients.filter((i) => i.needs_attention).length;
  const duplicateCount = ingredients.filter((i) => i.merge_suggestions.length > 0).length;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ingredients.filter((i) => {
      if (q) return i.name.includes(q) || i.aliases.some((a) => a.includes(q));
      if (filter === 'attention') return i.needs_attention;
      if (filter === 'duplicates') return i.merge_suggestions.length > 0;
      return true;
    });
  }, [ingredients, filter, search]);

  const byId = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  const tabs: Array<{ key: Filter; label: string; count?: number }> = [
    { key: 'attention', label: 'Telt niet op', count: attentionCount },
    { key: 'duplicates', label: 'Dubbelen?', count: duplicateCount },
    { key: 'all', label: 'Alles', count: ingredients.length },
  ];

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto pt-8 md:pt-12 pb-32">
      <Link to="/recepten" className="flex items-center gap-2 text-muted text-sm mb-6 hover:text-ink transition-colors">
        <ArrowLeft size={16} /> recepten
      </Link>

      <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2">Ingrediënten</h1>
      <p className="text-sm text-muted mb-6">
        De boodschappenlijst telt per ingrediënt op. Voeg dubbelen samen en vul omrekeningen in waar
        eenheden niet optellen — wijzigingen werken direct door in actieve menu's.
      </p>

      <div className="flex gap-2 mb-4">
        {tabs.map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => { setFilter(key); setSearch(''); }}
            className={`flex-1 py-2.5 px-3 rounded-full text-sm font-bold transition-colors ${
              filter === key && !search
                ? 'bg-warmth-500 text-white shadow-[0_4px_15px_rgba(242,153,74,0.3)]'
                : 'bg-white text-muted shadow-[0_2px_10px_rgba(0,0,0,0.04)]'
            }`}
          >
            {label}{count !== undefined && <span className="ml-1 opacity-70">{count}</span>}
          </button>
        ))}
      </div>

      <div className="relative mb-6">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Zoek in alle ingrediënten..."
          className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-2xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-warmth-400"
        />
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded-2xl mb-4 text-sm flex justify-between gap-2">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Sluiten"><X size={16} /></button>
        </div>
      )}

      {notice && (
        <div className="bg-warmth-400/20 text-ink p-3 rounded-2xl mb-4 text-sm flex justify-between gap-2">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Sluiten"><X size={16} /></button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-muted">Laden...</div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">✨</div>
          <p className="text-muted">
            {search ? 'Niets gevonden.' : filter === 'attention' ? 'Alle ingrediënten tellen netjes op.' : 'Geen mogelijke dubbelen gevonden.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-3xl divide-y divide-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
          {visible.map((ing) => (
            <IngredientRow
              key={ing.id}
              ingredient={ing}
              all={ingredients}
              byId={byId}
              open={openId === ing.id}
              onToggle={() => setOpenId(openId === ing.id ? null : ing.id)}
              run={run}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface RowProps {
  ingredient: Ingredient;
  all: Ingredient[];
  byId: Map<number, Ingredient>;
  open: boolean;
  onToggle: () => void;
  run: (fn: () => Promise<unknown>, nextOpenId?: number | null) => Promise<void>;
}

function IngredientRow({ ingredient: ing, all, byId, open, onToggle, run }: RowProps) {
  const [name, setName] = useState(ing.name);
  const [unit, setUnit] = useState(ing.unit);
  const [mergeInto, setMergeInto] = useState<number | ''>('');
  const [newConvUnit, setNewConvUnit] = useState('');
  const [newConvValue, setNewConvValue] = useState('');

  useEffect(() => { setName(ing.name); setUnit(ing.unit); }, [ing.name, ing.unit]);

  const otherUnits = ing.units_used.filter((u) => u.unit !== ing.unit);

  /**
   * Conversions are rebased onto the new unit when it has one itself;
   * otherwise the server drops them, so ask first and report if it happened.
   */
  function changeUnit(newUnit: string) {
    const conversions = otherUnits.filter((u) => u.factor !== null);
    const target = newUnit.toLowerCase();
    // Spoons and millilitres always relate, also when the new unit is not in use yet
    const rebasable = conversions.some((u) => u.unit === target)
      || (VOLUME_UNITS.includes(target) && VOLUME_UNITS.includes(ing.unit));
    if (conversions.length > 0 && !rebasable && !window.confirm(
      `"${newUnit}" is niet om te rekenen naar "${ing.unit}", dus de omrekeningen van ${ing.name} `
      + `(${conversions.map((u) => u.unit).join(', ')}) worden gewist. Doorgaan?`,
    )) return;
    run(async () => {
      const result = await api.updateIngredient(ing.id, { unit: newUnit });
      if (result.conversions_reset) {
        return `De omrekeningen van ${ing.name} zijn gewist; vul ze opnieuw in voor "${newUnit}".`;
      }
    });
  }
  const suggestions = ing.merge_suggestions.map((id) => byId.get(id)).filter((i): i is Ingredient => !!i);

  return (
    <div className="px-5">
      <button onClick={onToggle} className="w-full flex items-center gap-3 py-4 text-left">
        <span className="text-lg" aria-hidden>{GROUP_EMOJI[ing.product_group] || '🛒'}</span>
        <span className="flex-1 min-w-0">
          <span className="font-bold block truncate">{ing.name}</span>
          <span className="text-xs text-muted">
            {ing.unit || 'geen eenheid'} · {ing.recipe_count} {ing.recipe_count === 1 ? 'recept' : 'recepten'}
          </span>
        </span>
        {ing.needs_attention && <AlertTriangle size={16} className="text-warmth-600 shrink-0" aria-label="Telt niet op" />}
        {suggestions.length > 0 && <Copy size={16} className="text-accent shrink-0" aria-label="Mogelijke dubbele" />}
        <ChevronDown size={16} className={`text-muted shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="pb-5 space-y-5 text-sm">
          {/* Name + group */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-bold text-muted uppercase tracking-wide">Naam</span>
              <div className="flex gap-2 mt-1">
                <input value={name} onChange={(e) => setName(e.target.value)}
                  className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-xl bg-white" />
                {name.trim() && name.trim().toLowerCase() !== ing.name && (
                  <button onClick={() => run(() => api.updateIngredient(ing.id, { name }))}
                    className="px-3 bg-warmth-500 text-white rounded-xl font-bold">Opslaan</button>
                )}
              </div>
            </label>
            <label className="block">
              <span className="text-xs font-bold text-muted uppercase tracking-wide">Productgroep</span>
              <select value={ing.product_group}
                onChange={(e) => run(() => api.updateIngredient(ing.id, { product_group: e.target.value }))}
                className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl bg-white">
                {!PRODUCT_GROUPS.includes(ing.product_group) && <option value={ing.product_group}>{ing.product_group}</option>}
                {PRODUCT_GROUPS.map((g) => <option key={g} value={g}>{GROUP_EMOJI[g]} {g}</option>)}
              </select>
            </label>
          </div>

          {/* Unit */}
          <label className="block">
            <span className="text-xs font-bold text-muted uppercase tracking-wide">Boodschappen-eenheid</span>
            <div className="flex gap-2 mt-1">
              <input value={unit} onChange={(e) => setUnit(e.target.value)} list={`units-${ing.id}`}
                className="w-32 px-3 py-2 border border-gray-200 rounded-xl bg-white" />
              <datalist id={`units-${ing.id}`}>
                {ing.units_used.map((u) => <option key={u.unit} value={u.unit} />)}
              </datalist>
              {unit.trim() && unit.trim() !== ing.unit && (
                <button onClick={() => changeUnit(unit.trim())}
                  className="px-3 bg-warmth-500 text-white rounded-xl font-bold">Opslaan</button>
              )}
            </div>
            <span className="text-xs text-muted mt-1 block">Hierin komt het totaal op de boodschappenlijst.</span>
          </label>

          {/* Conversions */}
          <div>
            <span className="text-xs font-bold text-muted uppercase tracking-wide">Omrekeningen</span>
            <div className="mt-2 space-y-2">
              {otherUnits.length === 0 && (
                <p className="text-muted text-xs">Alle recepten gebruiken al "{ing.unit}".</p>
              )}
              {otherUnits.map((u) => (
                u.builtin ? (
                  <p key={u.unit} className="text-muted">
                    1 {u.unit} = {formatDecimal(u.factor!)} {ing.unit} <span className="text-xs">(vast, {u.count}× in recepten)</span>
                  </p>
                ) : (
                  <ConversionRow key={u.unit} ingredient={ing} unit={u.unit} factor={u.factor} count={u.count} run={run} />
                )
              ))}
              <div className="flex items-center gap-2 pt-1 flex-wrap">
                <span className="text-muted">+ 1</span>
                <input value={newConvUnit} onChange={(e) => setNewConvUnit(e.target.value)} placeholder="eenheid"
                  className="w-24 px-3 py-1.5 border border-gray-200 rounded-xl bg-white" />
                <span className="text-muted">=</span>
                <input value={newConvValue} onChange={(e) => setNewConvValue(e.target.value)} inputMode="decimal" placeholder="aantal"
                  className="w-20 px-3 py-1.5 border border-gray-200 rounded-xl bg-white" />
                <span className="text-muted">{ing.unit}</span>
                {newConvUnit.trim() && parseDecimal(newConvValue) && (
                  <button onClick={() => run(async () => {
                    await api.setConversion(ing.id, newConvUnit, parseDecimal(newConvValue)!);
                    setNewConvUnit(''); setNewConvValue('');
                  })} className="px-3 py-1.5 bg-warmth-500 text-white rounded-xl font-bold">Toevoegen</button>
                )}
              </div>
            </div>
          </div>

          {/* Merge */}
          <div>
            <span className="text-xs font-bold text-muted uppercase tracking-wide">Samenvoegen met</span>
            {suggestions.length > 0 && (
              <div className="flex gap-2 flex-wrap mt-2">
                {suggestions.map((s) => (
                  <button key={s.id} onClick={() => setMergeInto(s.id)}
                    className={`px-3 py-1 rounded-full text-xs font-bold ${mergeInto === s.id ? 'bg-warmth-500 text-white' : 'bg-warmth-400/20 text-warmth-600'}`}>
                    {s.name}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2 mt-2">
              <select value={mergeInto} onChange={(e) => setMergeInto(e.target.value ? Number(e.target.value) : '')}
                className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-xl bg-white">
                <option value="">Kies ingrediënt...</option>
                {all.filter((o) => o.id !== ing.id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              {mergeInto !== '' && (
                <button
                  onClick={() => {
                    const target = byId.get(mergeInto);
                    if (target && window.confirm(`"${ing.name}" samenvoegen met "${target.name}"? "${ing.name}" wordt een alias.`)) {
                      run(() => api.mergeIngredient(ing.id, mergeInto), mergeInto);
                    }
                  }}
                  className="px-3 bg-warmth-500 text-white rounded-xl font-bold">
                  Samenvoegen
                </button>
              )}
            </div>
          </div>

          {ing.aliases.length > 0 && (
            <p className="text-xs text-muted">Ook bekend als: {ing.aliases.join(', ')}</p>
          )}
        </div>
      )}
    </div>
  );
}

function parseDecimal(value: string): number | null {
  const n = parseFloat(value.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatDecimal(n: number): string {
  return String(Math.round(n * 1000) / 1000).replace('.', ',');
}

/**
 * One conversion, phrased the way people think: "1 blik = 400 g", also when
 * the ingredient itself is counted in blikken ("1 blik = 400 g" rather than
 * "1 g = 0,0025 blik").
 */
function ConversionRow({ ingredient: ing, unit, factor, count, run }: {
  ingredient: Ingredient; unit: string; factor: number | null; count: number;
  run: RowProps['run'];
}) {
  const inverted = WEIGHT_UNITS.includes(unit) && !WEIGHT_UNITS.includes(ing.unit);
  const [left, right] = inverted ? [ing.unit, unit] : [unit, ing.unit];
  const shown = factor === null ? '' : formatDecimal(inverted ? 1 / factor : factor);
  const [value, setValue] = useState(shown);

  useEffect(() => { setValue(shown); }, [shown]);

  const parsed = parseDecimal(value);
  const dirty = parsed !== null && value !== shown;

  return (
    <div className={`flex items-center gap-2 flex-wrap rounded-xl ${factor === null ? 'bg-warmth-400/20 px-3 py-2' : ''}`}>
      {factor === null && <AlertTriangle size={14} className="text-warmth-600" />}
      <span>1 {left} =</span>
      <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="?"
        className="w-20 px-3 py-1.5 border border-gray-200 rounded-xl bg-white" />
      <span>{right}</span>
      {count > 0 && <span className="text-xs text-muted">({count}× in recepten)</span>}
      {dirty && (
        <button onClick={() => run(() => api.setConversion(ing.id, unit, inverted ? 1 / parsed! : parsed!))}
          className="px-3 py-1.5 bg-warmth-500 text-white rounded-xl font-bold">Opslaan</button>
      )}
      {factor !== null && !dirty && (
        <button onClick={() => run(() => api.deleteConversion(ing.id, unit))}
          className="text-muted hover:text-red-500" aria-label={`Omrekening ${unit} verwijderen`}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}
