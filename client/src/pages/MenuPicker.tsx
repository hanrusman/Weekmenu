import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Bean, Beef, CalendarDays, Carrot, Check, ChevronLeft, ChevronRight, Circle, CircleAlert,
  CircleCheck, CircleX, Eraser, Fish, Loader2, LucideIcon, Pizza, Repeat, RotateCcw, Search, Shuffle, Timer, Utensils,
  WandSparkles, X,
} from 'lucide-react';
import { api, formatDateRange, formatShortDay, plannerApi } from '../lib/api';
import {
  CHECK_RANK, CheckState, DraftDay, Fit, KADERS, MenuCheck, PlannerRecipe, RecipeLookup, checkMenu, fitOf,
} from '../../../shared/menu-rules';
import type { PlannerExtra, PlannerState, ProposalJob } from '../../../shared/menu-planner';
import { MEAL_TYPE_EMOJI, recipeImageUrl } from '../lib/mealImages';
import MealImage from '../components/MealImage';
import Button from '../components/Button';

const POLL_MS = 3000;

const card = 'bg-surface rounded-3xl p-5 md:p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)]';
const sectionTitle = 'font-bold text-sm tracking-wide text-accent uppercase';
const input = 'w-full p-3 border border-line rounded-2xl text-sm bg-sunken focus:outline-none focus:ring-2 focus:ring-brand';

const TONE: Record<CheckState, string> = {
  ok: 'bg-success-soft text-success',
  open: 'bg-raised text-muted',
  warn: 'bg-warn-soft text-warn',
  fail: 'bg-danger-soft text-danger',
};
const TEXT: Record<CheckState, string> = { ok: 'text-success', open: 'text-muted', warn: 'text-warn', fail: 'text-danger' };
const STATE_ICON: Record<CheckState, LucideIcon> = { ok: CircleCheck, open: Circle, warn: CircleAlert, fail: CircleX };
const STATE_WORD: Record<CheckState, string> = { ok: 'in orde', open: 'nog open', warn: 'let op', fail: 'buiten de kaders' };
const SUMMARY: Record<CheckState, string> = {
  ok: 'Binnen de kaders', open: 'Nog niet compleet', warn: 'Met kanttekeningen', fail: 'Buiten de kaders',
};

const WEEK_ICON: Record<string, LucideIcon> = {
  dagen: CalendarDays, groente: Carrot, vis: Fish, peulvruchten: Bean, vlees: Beef, uitzondering: Pizza,
  maaltijd: Utensils, herhaling: Repeat, soort: Shuffle, tijd: Timer,
};
/** Always in the bar at the top; the other rules only when something is off. */
const COUNTS = ['dagen', 'groente', 'vis', 'peulvruchten', 'vlees', 'uitzondering'];

/** A week being picked, kept in this browser until it is on the menu. */
interface Draft {
  days: DraftDay[];
  breakfasts: number[];
  snacks: number[];
  /** The model's explanation of the proposal that was filled in. */
  note: string | null;
  /** When that proposal started, so it is filled in once. */
  applied: string | null;
}

const draftKey = (week: number, year: number) => `weekmenu:kiezen:${year}-${week}`;

function blankDays(state: PlannerState): DraftDay[] {
  return state.days.map((d) => ({ day_name: d.day_name, date: d.date, recipe_id: null, free: false }));
}

/** The menu that is on this week now; days it does not have are open. */
function existingDraft(state: PlannerState): Draft | null {
  const existing = state.existing;
  if (!existing) return null;
  return {
    days: blankDays(state).map((d) => ({
      ...d, recipe_id: existing.days.find((e) => e.day_name === d.day_name)?.recipe_id ?? null,
    })),
    breakfasts: existing.breakfasts,
    snacks: existing.snacks,
    note: null,
    applied: null,
  };
}

/** What this browser kept for the week, else the menu that is there, else an empty week. */
function initialDraft(state: PlannerState): Draft {
  try {
    const stored = JSON.parse(localStorage.getItem(draftKey(state.week_number, state.year)) ?? 'null') as Draft | null;
    if (stored && Array.isArray(stored.days) && stored.days.length === state.days.length
      && stored.days.every((d, i) => d.day_name === state.days[i].day_name)) {
      return { ...stored, days: stored.days.map((d, i) => ({ ...d, date: state.days[i].date })) };
    }
  } catch { /* storage blocked or malformed: start afresh */ }
  return existingDraft(state) ?? { days: blankDays(state), breakfasts: [], snacks: [], note: null, applied: null };
}

function keep(state: PlannerState, draft: Draft | null) {
  try {
    const key = draftKey(state.week_number, state.year);
    if (draft) localStorage.setItem(key, JSON.stringify(draft));
    else localStorage.removeItem(key);
  } catch { /* storage blocked: the draft lives as long as the page */ }
}

function Thumb({ recipe, size }: { recipe: Pick<PlannerRecipe, 'id' | 'name' | 'meal_type' | 'recipe_image_version'>; size: number }) {
  return (
    <div className="shrink-0 rounded-xl bg-sunken flex items-center justify-center overflow-hidden" style={{ width: size, height: size }}>
      <MealImage ownSrc={recipeImageUrl(recipe.id, recipe.recipe_image_version)} recipeName={recipe.name}
        mealType={recipe.meal_type ?? ''} size={size} className="w-full h-full"
        fallback={<span className="text-lg">{MEAL_TYPE_EMOJI[recipe.meal_type ?? ''] || '🍽️'}</span>} />
    </div>
  );
}

/** "vis · 🥦 360 g · 25 min · ★ 4,5" */
function recipeMeta(r: PlannerRecipe): string {
  return [
    r.protein.length ? r.protein.join(' + ') : 'vega',
    `🥦 ${r.veg_per_serving} g${r.veg_exception ? ' · uitzondering' : ''}`,
    r.prep_time_minutes ? `${r.prep_time_minutes} min` : null,
    r.rating_avg !== null ? `★ ${String(r.rating_avg).replace('.', ',')}` : null,
    r.status === 'concept' ? 'concept' : null,
  ].filter(Boolean).join(' · ');
}

/** The week's counts, always in view while picking. */
function CountBar({ check }: { check: MenuCheck }) {
  const shown = check.week.filter((c) => COUNTS.includes(c.key) || c.state === 'warn' || c.state === 'fail');
  return (
    <div className="sticky top-0 z-20 -mx-4 px-4 py-2 bg-canvas/90 backdrop-blur-md">
      <ul className="flex flex-wrap gap-1.5" aria-label="Tellingen deze week">
        {shown.map((c) => {
          const Icon = WEEK_ICON[c.key] ?? Circle;
          return (
            <li key={c.key} title={`${c.label}: ${c.detail}`}
              className={`flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold ${TONE[c.state]}`}>
              <Icon size={13} aria-hidden />
              {c.short ?? ''}
              <span className="sr-only">{c.label}: {c.detail}, {STATE_WORD[c.state]}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function WeekChecks({ check }: { check: MenuCheck }) {
  return (
    <section className={card} aria-labelledby="kaders-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="kaders-title" className={sectionTitle}>Kaders deze week</h2>
        <span className={`text-[11px] font-bold px-2 py-1 rounded-full text-right ${TONE[check.state]}`}>{SUMMARY[check.state]}</span>
      </div>
      <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
        {check.week.map((c) => {
          const Icon = WEEK_ICON[c.key] ?? Circle;
          return (
            <li key={c.key} className={`flex items-start gap-2 p-2.5 rounded-2xl ${TONE[c.state]}`}>
              <Icon size={16} className="shrink-0 mt-0.5" aria-hidden />
              <div className="min-w-0">
                <span className="block text-xs font-bold">{c.label}<span className="sr-only">, {STATE_WORD[c.state]}</span></span>
                <span className="block text-[11px] leading-snug">{c.detail}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function FitLine({ fit }: { fit: Fit }) {
  if (fit.state === 'ok') {
    return (
      <span className="block text-[11px] font-bold text-success">
        Past{fit.helps.length ? ` · telt mee voor ${fit.helps.join(' en ')}` : ''}
      </span>
    );
  }
  return (
    <span className="block text-[11px] leading-snug">
      {fit.helps.length > 0 && <span className="font-bold text-success">telt mee voor {fit.helps.join(' en ')} · </span>}
      {fit.problems.map((p, i) => (
        <span key={i} className={`font-bold ${TEXT[p.state]}`}>{i > 0 && ' · '}{p.detail}</span>
      ))}
    </span>
  );
}

type Filter = 'alles' | 'past' | 'vis' | 'peulvruchten' | 'vega' | 'vlees' | 'snel';

const FILTERS: Array<{ key: Filter; label: string; test: (r: PlannerRecipe) => boolean }> = [
  { key: 'alles', label: 'Alles', test: () => true },
  { key: 'past', label: 'Past', test: () => true },
  { key: 'vis', label: 'Vis', test: (r) => r.protein.includes('vis') },
  { key: 'peulvruchten', label: 'Peulvruchten', test: (r) => r.protein.includes('peulvruchten') },
  { key: 'vega', label: 'Vega', test: (r) => !r.protein.includes('vis') && !r.protein.includes('vlees') },
  { key: 'vlees', label: 'Vlees', test: (r) => r.protein.includes('vlees') },
  { key: 'snel', label: `≤ ${KADERS.weekdayMinutes} min`, test: (r) => (r.prep_time_minutes ?? 0) <= KADERS.weekdayMinutes },
];

const SHOWN = 25;

const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** The library for one day, best fit first, each saying how it fits the week. */
function Chooser({ days, index, recipes, lookup, onPick, onFree }: {
  days: DraftDay[]; index: number; recipes: PlannerRecipe[]; lookup: RecipeLookup;
  onPick: (id: number) => void; onFree: () => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('alles');
  const [all, setAll] = useState(false);
  const current = days[index].recipe_id;

  const candidates = useMemo(() => {
    const q = normalize(query.trim());
    const test = FILTERS.find((f) => f.key === filter)!.test;
    return recipes
      .filter((r) => test(r) && (!q || normalize(`${r.name} ${r.ingredients.join(' ')}`).includes(q)))
      .map((recipe) => ({ recipe, fit: fitOf(days, index, recipe, lookup) }))
      .filter(({ fit }) => filter !== 'past' || fit.state === 'ok')
      .sort((a, b) => Number(a.recipe.status === 'concept') - Number(b.recipe.status === 'concept')
        || CHECK_RANK[a.fit.state] - CHECK_RANK[b.fit.state]
        || b.fit.helps.length - a.fit.helps.length
        || (b.recipe.rating_avg ?? 0) - (a.recipe.rating_avg ?? 0)
        || a.recipe.name.localeCompare(b.recipe.name, 'nl'));
  }, [recipes, days, index, lookup, query, filter]);

  const shown = all ? candidates : candidates.slice(0, SHOWN);

  return (
    <div className="mx-3 mb-3 p-3 bg-sunken rounded-2xl">
      <label className="relative block">
        <span className="sr-only">Zoek een recept voor {days[index].day_name.toLowerCase()}</span>
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Zoek op naam of ingrediënt"
          className={`${input} pl-9 bg-surface`} />
      </label>
      <div className="flex flex-wrap gap-1.5 mt-2" role="group" aria-label="Filter">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}
            className={`min-h-8 px-3 rounded-full text-xs font-bold transition-colors ${
              filter === f.key ? 'bg-brand text-on-brand' : 'bg-surface text-muted hover:text-ink'
            }`}>
            {f.label}
          </button>
        ))}
      </div>
      <ul className="mt-2 space-y-1">
        {shown.map(({ recipe, fit }) => (
          <li key={recipe.id}>
            <button onClick={() => onPick(recipe.id)} aria-current={recipe.id === current ? 'true' : undefined}
              className={`w-full flex items-start gap-3 p-2 rounded-2xl text-left transition-colors hover:bg-surface ${
                recipe.id === current ? 'bg-surface ring-2 ring-brand' : ''
              }`}>
              <Thumb recipe={recipe} size={40} />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-bold leading-snug">{recipe.name}</span>
                <span className="block text-[11px] text-muted">{recipeMeta(recipe)}</span>
                <FitLine fit={fit} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {candidates.length === 0 && <p className="text-sm text-muted p-2">Niets gevonden.</p>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2 text-xs">
        {!all && candidates.length > SHOWN && (
          <button onClick={() => setAll(true)} className="font-bold text-brand hover:text-brand-hover">
            Toon alle {candidates.length}
          </button>
        )}
        <button onClick={onFree} className="font-bold text-muted hover:text-ink">Geen avondeten plannen (vrij)</button>
      </div>
    </div>
  );
}

function DayRow({ day, recipe, check, open, onToggle, onClear, children }: {
  day: DraftDay; recipe: PlannerRecipe | undefined; check: MenuCheck['days'][number]; open: boolean;
  onToggle: () => void; onClear: () => void; children?: React.ReactNode;
}) {
  const StateIcon = STATE_ICON[check.state];
  const [short, ...rest] = formatShortDay(day).split(' ');
  const filled = day.recipe_id !== null || day.free;
  return (
    <li>
      <div className="flex items-center gap-2 p-2 pl-3">
        <button onClick={onToggle} aria-expanded={open}
          className="flex-1 min-w-0 flex items-center gap-3 text-left py-1 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
          <span className="w-12 shrink-0">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-accent">{short}</span>
            <span className="block text-[11px] text-muted">{rest.join(' ')}</span>
          </span>
          {recipe ? <Thumb recipe={recipe} size={44} /> : (
            <span className="w-11 h-11 shrink-0 rounded-xl border-2 border-dashed border-line" aria-hidden />
          )}
          <span className="flex-1 min-w-0">
            {day.free ? (
              <span className="block text-sm text-muted">Vrij, geen avondeten</span>
            ) : recipe ? (
              <>
                <span className="block text-sm font-bold leading-snug line-clamp-2">{recipe.name}</span>
                <span className="block text-[11px] text-muted truncate">{recipeMeta(recipe)}</span>
              </>
            ) : day.recipe_id !== null ? (
              <span className="block text-sm text-muted">Recept #{day.recipe_id} staat niet meer in de bibliotheek</span>
            ) : (
              <span className="block text-sm font-bold text-brand">Kies een recept</span>
            )}
          </span>
          {recipe && (
            <span className={TEXT[check.state]} title={STATE_WORD[check.state]}>
              <StateIcon size={18} aria-hidden />
              <span className="sr-only">{STATE_WORD[check.state]}</span>
            </span>
          )}
        </button>
        {filled && (
          <button onClick={onClear} aria-label={`Maak ${day.day_name.toLowerCase()} leeg`}
            className="flex items-center justify-center w-9 h-9 shrink-0 text-faint hover:text-ink hover:bg-raised rounded-xl transition-colors">
            <X size={15} />
          </button>
        )}
      </div>
      {check.checks.length > 0 && (
        <ul className="px-3 pb-2 -mt-1 flex flex-wrap gap-1.5 pl-[4.25rem]">
          {check.checks.map((c) => (
            <li key={c.key} className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${TONE[c.state]}`}>{c.detail}</li>
          ))}
        </ul>
      )}
      {children}
    </li>
  );
}

function ExtrasPicker({ title, options, perWeek, chosen, onChange }: {
  title: string; options: PlannerExtra[]; perWeek: number; chosen: number[]; onChange: (ids: number[]) => void;
}) {
  const set = (slot: number, value: string) => {
    const next = [...chosen];
    next[slot] = Number(value);
    onChange([...new Set(next.filter((id) => id > 0))]);
  };
  return (
    <div>
      <span className="block text-sm font-bold mb-2">{title} <span className="font-normal text-muted">({perWeek} per week)</span></span>
      {options.length === 0 ? (
        <p className="text-xs text-muted">Nog niets in de bibliotheek.</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-2">
          {Array.from({ length: perWeek }, (_, slot) => (
            <select key={slot} value={chosen[slot] ?? ''} onChange={(e) => set(slot, e.target.value)}
              aria-label={`${title} ${slot + 1}`} className={input}>
              <option value="">Geen</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>{o.name}{o.status === 'concept' ? ' (concept)' : ''}</option>
              ))}
            </select>
          ))}
        </div>
      )}
    </div>
  );
}

/** Ask a model for the open days; it runs on the server, the page follows it. */
function ProposeCard({ state, job, draft, onPropose, wishes, setWishes }: {
  state: PlannerState; job: ProposalJob; draft: Draft; onPropose: () => void; wishes: string; setWishes: (w: string) => void;
}) {
  const open = draft.days.filter((d) => !d.free && d.recipe_id === null).length;
  const planned = draft.days.filter((d) => !d.free).length;
  const here = job.week_number === state.week_number && job.year === state.year;
  return (
    <section className={card} aria-labelledby="voorstel-title">
      <div className="flex items-center gap-2 mb-2">
        <WandSparkles size={18} className="text-brand" aria-hidden />
        <h2 id="voorstel-title" className="text-lg font-bold">Laat voorstellen</h2>
      </div>
      <p className="text-sm text-muted">
        Een taalmodel kiest uit de goedgekeurde recepten voor de open dagen, met de kaders, wat recent gepland is en de
        feedback van het gezin. De app controleert het voorstel en laat het model verbeteren wat buiten de kaders valt.
        Wat je al gekozen hebt, blijft staan.
      </p>
      {!state.configured ? (
        <p className="mt-3 p-3 rounded-2xl bg-warn-soft text-warn text-sm">Het taalmodel is op deze server niet ingesteld.</p>
      ) : job.running ? (
        <div className="mt-3 p-3 rounded-2xl bg-sunken text-sm" role="status">
          <span className="flex items-center gap-2 font-bold">
            <Loader2 size={16} className="animate-spin" aria-hidden />
            {here ? `Poging ${job.attempt} van ${job.attempts}` : `Bezig met week ${job.week_number}`}
            {job.model ? ` · ${job.model}` : ''}
          </span>
          <span className="block text-xs text-muted mt-1">Dit kan een paar minuten duren. Je mag de pagina sluiten; het voorstel wacht hier op je.</span>
        </div>
      ) : (
        <>
          <textarea value={wishes} onChange={(e) => setWishes(e.target.value)} rows={2} maxLength={1000}
            aria-label="Wensen voor deze week" placeholder="Wensen (mag leeg), bijv. iets met pompoen, vrijdag heel snel"
            className={`${input} mt-3 resize-y`} />
          <Button className="mt-3" block onClick={onPropose} disabled={open === 0}>
            <WandSparkles size={16} />
            {open === 0 ? 'Alle dagen zijn gekozen' : open === planned ? 'Stel een week voor' : `Vul ${open} open ${open === 1 ? 'dag' : 'dagen'}`}
          </Button>
          {open === 0 && <p className="text-xs text-muted mt-2">Maak een dag leeg om die te laten voorstellen.</p>}
        </>
      )}
      {here && !job.running && job.error && (
        <p role="alert" className="mt-3 p-3 rounded-2xl bg-danger-soft text-danger text-sm">{job.error}</p>
      )}
      {draft.note && (
        <p className="mt-3 p-3 rounded-2xl bg-sunken text-sm">
          {draft.note}
          {here && job.proposal?.model && <span className="block text-xs text-muted mt-1">Voorgesteld door {job.proposal.model}</span>}
        </p>
      )}
    </section>
  );
}

/**
 * Pick the week's dinners from the library, or have a model propose them, and
 * see per day and for the week whether it keeps to the family's rules: the
 * vegetables, fish, pulses and meat, an exception at most once, and variety.
 */
export default function MenuPicker() {
  const [params, setParams] = useSearchParams();
  const week = Number(params.get('week')) || undefined;
  const year = Number(params.get('year')) || undefined;
  const [state, setState] = useState<PlannerState | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [job, setJob] = useState<ProposalJob | null>(null);
  const [openDay, setOpenDay] = useState<number | null>(null);
  const [wishes, setWishes] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ week: number; first: string | null; last: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setState(null);
    setOpenDay(null);
    plannerApi.get(week, year).then((next) => {
      if (!alive) return;
      setState(next);
      setDraft(initialDraft(next));
      setJob(next.job);
    }).catch((err) => alive && setError((err as Error).message));
    return () => { alive = false; };
  }, [week, year]);

  /** Change the draft and keep it in this browser. */
  const update = useCallback((change: (d: Draft) => Draft) => {
    setDraft((d) => {
      if (!d) return d;
      const next = change(d);
      if (state) keep(state, next);
      return next;
    });
  }, [state]);

  // Follow a proposal while it runs
  useEffect(() => {
    if (!job?.running) return;
    const timer = setTimeout(() => {
      plannerApi.proposal().then(({ job: next }) => setJob(next)).catch((err) => setError((err as Error).message));
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [job]);

  // A finished proposal for this week fills the days that are still open, once
  useEffect(() => {
    const proposal = job?.proposal;
    if (!state || !draft || !job || job.running || !proposal) return;
    if (job.week_number !== state.week_number || job.year !== state.year || draft.applied === job.started_at) return;
    update((d) => ({
      ...d,
      days: d.days.map((day) => {
        if (day.free || day.recipe_id !== null) return day;
        const proposed = proposal.days.find((p) => p.day_name === day.day_name);
        return proposed?.recipe_id && !proposed.free ? { ...day, recipe_id: proposed.recipe_id } : day;
      }),
      breakfasts: d.breakfasts.length ? d.breakfasts : proposal.breakfasts,
      snacks: d.snacks.length ? d.snacks : proposal.snacks,
      note: proposal.note || null,
      applied: job.started_at,
    }));
  }, [job, state, draft, update]);

  const lookup: RecipeLookup = useMemo(() => new Map((state?.recipes ?? []).map((r) => [r.id, r])), [state]);
  const check = useMemo(() => (draft ? checkMenu(draft.days, lookup) : null), [draft, lookup]);

  if (saved) {
    return (
      <div className="p-4 md:p-8 max-w-2xl mx-auto pt-8 md:pt-12 pb-32">
        <div className={`${card} text-center`}>
          <div className="mx-auto w-12 h-12 rounded-full bg-success-soft text-success flex items-center justify-center mb-3">
            <Check size={24} />
          </div>
          <h1 className="text-xl font-bold">Week {saved.week} staat op het menu</h1>
          <p className="text-sm text-muted mt-1">{formatDateRange(saved.first, saved.last)} · de boodschappenlijst is klaar</p>
          <div className="grid grid-cols-2 gap-3 mt-5">
            <Link to="/" className="inline-flex items-center justify-center min-h-11 rounded-2xl font-bold text-sm bg-brand text-on-brand hover:bg-brand-hover">
              Bekijk menu
            </Link>
            <Link to="/boodschappen" className="inline-flex items-center justify-center min-h-11 rounded-2xl font-bold text-sm bg-surface border border-line hover:bg-raised">
              Boodschappen
            </Link>
          </div>
          <Button variant="ghost" size="sm" className="mt-3" onClick={() => { setSaved(null); setParams({}); }}>
            Nog een week kiezen
          </Button>
        </div>
      </div>
    );
  }

  if (!state || !draft || !check || !job) {
    return <div className="p-6 pt-16 text-center text-muted">{error || 'Laden...'}</div>;
  }

  const setDay = (index: number, fields: Partial<DraftDay>) =>
    update((d) => ({ ...d, days: d.days.map((day, i) => (i === index ? { ...day, ...fields } : day)) }));

  async function propose() {
    if (!state || !draft) return;
    setError(null);
    try {
      const { job: started } = await plannerApi.propose({
        week_number: state.week_number,
        year: state.year,
        days: draft.days.map(({ day_name, recipe_id, free }) => ({ day_name, recipe_id, free })),
        breakfasts: draft.breakfasts,
        snacks: draft.snacks,
        wishes: wishes.trim(),
      });
      setJob(started);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const chosen = draft.days.filter((d) => !d.free && d.recipe_id !== null);

  async function save() {
    if (!state || !draft) return;
    setBusy(true);
    setError(null);
    try {
      await api.importMenu({
        menu: {
          start_day: draft.days[0].day_name,
          days: chosen.map((d) => ({ day_name: d.day_name, recipe_id: d.recipe_id, recipe_name: lookup.get(d.recipe_id!)?.name })),
          breakfasts: draft.breakfasts.map((recipe_id) => ({ recipe_id })),
          snacks: draft.snacks.map((recipe_id) => ({ recipe_id })),
        },
        weekNumber: state.week_number,
        year: state.year,
      });
      keep(state, null);
      setSaved({ week: state.week_number, first: chosen[0]?.date ?? null, last: chosen[chosen.length - 1]?.date ?? null });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const goTo = (target: { week_number: number; year: number }) =>
    setParams({ week: String(target.week_number), year: String(target.year) });
  const fromMenu = existingDraft(state);

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto pt-8 md:pt-12 pb-32 space-y-5">
      <Link to="/plannen" className="inline-flex items-center gap-2 text-muted text-sm hover:text-ink transition-colors">
        <ArrowLeft size={16} /> plannen
      </Link>
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Menu kiezen</h1>

      <div className="flex items-center justify-between gap-2">
        <button onClick={() => goTo(state.previous)} aria-label={`Week ${state.previous.week_number}`}
          className="flex items-center justify-center w-11 h-11 rounded-2xl text-muted hover:text-ink hover:bg-raised">
          <ChevronLeft size={20} />
        </button>
        <div className="text-center">
          <p className="font-bold">Week {state.week_number}{state.year !== new Date().getFullYear() ? `, ${state.year}` : ''}</p>
          <p className="text-xs text-muted">{formatDateRange(state.days[0]?.date, state.days[state.days.length - 1]?.date)}</p>
        </div>
        <button onClick={() => goTo(state.next)} aria-label={`Week ${state.next.week_number}`}
          className="flex items-center justify-center w-11 h-11 rounded-2xl text-muted hover:text-ink hover:bg-raised">
          <ChevronRight size={20} />
        </button>
      </div>

      {state.existing && (
        <p className="flex items-start gap-2 p-3 rounded-2xl bg-warn-soft text-warn text-sm">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden />
          <span>
            Week {state.week_number} staat al {state.existing.status === 'archived' ? 'in het archief' : 'op het menu'}.
            Opslaan vervangt hem, met afvinkjes en beoordelingen.
          </span>
        </p>
      )}

      <CountBar check={check} />
      <WeekChecks check={check} />

      <ProposeCard state={state} job={job} draft={draft} onPropose={propose} wishes={wishes} setWishes={setWishes} />

      <section aria-labelledby="dagen-title">
        <h2 id="dagen-title" className={`${sectionTitle} mb-3`}>Avondeten</h2>
        <ul className="bg-surface rounded-3xl divide-y divide-line-soft shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
          {draft.days.map((day, i) => (
            <DayRow key={day.day_name} day={day} recipe={day.recipe_id !== null ? lookup.get(day.recipe_id) : undefined}
              check={check.days[i]} open={openDay === i}
              onToggle={() => setOpenDay(openDay === i ? null : i)}
              onClear={() => setDay(i, { recipe_id: null, free: false })}>
              {openDay === i && (
                <Chooser days={draft.days} index={i} recipes={state.recipes} lookup={lookup}
                  onPick={(id) => { setDay(i, { recipe_id: id, free: false }); setOpenDay(null); }}
                  onFree={() => { setDay(i, { recipe_id: null, free: true }); setOpenDay(null); }} />
              )}
            </DayRow>
          ))}
        </ul>
      </section>

      <section className={`${card} space-y-4`} aria-label="Ontbijt en tussendoortjes">
        <ExtrasPicker title="Ontbijt" options={state.breakfasts} perWeek={state.per_week.breakfasts}
          chosen={draft.breakfasts} onChange={(breakfasts) => update((d) => ({ ...d, breakfasts }))} />
        <ExtrasPicker title="Tussendoortje" options={state.snacks} perWeek={state.per_week.snacks}
          chosen={draft.snacks} onChange={(snacks) => update((d) => ({ ...d, snacks }))} />
      </section>

      {error && (
        <div role="alert" className="flex items-start gap-2 bg-danger-soft text-danger p-3 rounded-2xl text-sm">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} aria-label="Sluit melding"><X size={16} /></button>
        </div>
      )}

      <div className="space-y-2">
        <Button block size="lg" onClick={save} disabled={busy || chosen.length === 0}>
          <Check size={18} />
          {busy ? 'Bezig...' : `Zet ${chosen.length} ${chosen.length === 1 ? 'dag' : 'dagen'} op het menu`}
        </Button>
        {check.state === 'fail' && chosen.length > 0 && (
          <p className="text-xs text-muted text-center">De week valt nog buiten de kaders; opslaan kan wel.</p>
        )}
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="ghost" size="sm"
            onClick={() => update((d) => ({ ...d, days: blankDays(state), breakfasts: [], snacks: [], note: null }))}>
            <Eraser size={14} /> Leeg maken
          </Button>
          {fromMenu && (
            <Button variant="ghost" size="sm" onClick={() => update((d) => ({ ...fromMenu, applied: d.applied }))}>
              <RotateCcw size={14} /> Zoals op het menu
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
