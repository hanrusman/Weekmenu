import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, ArrowLeftRight, Bean, Beef, CalendarDays, Carrot, Check, ChevronDown, ChevronLeft, ChevronRight,
  Circle, CircleAlert, CircleCheck, CircleX, Eraser, Fish, Loader2, LucideIcon, MessageCircle, Minus, Pizza, Repeat, RotateCcw,
  Search, Send, Shuffle, SkipForward, Timer, Undo2, Utensils, WandSparkles, X,
} from 'lucide-react';
import { api, formatDateRange, formatShortDay, plannerApi } from '../lib/api';
import {
  CHECK_RANK, CheckState, DraftDay, Fit, KADERS, MenuCheck, PlannerRecipe, RecipeLookup, checkMenu, fitOf,
} from '../../../shared/menu-rules';
import { fillWeek, nextRecipe } from '../../../shared/menu-fill';
import type { ChatTurn, PlannerExtra, PlannerState, ProposalJob } from '../../../shared/menu-planner';
import { MEAL_TYPE_EMOJI, recipeImageUrl } from '../lib/mealImages';
import MealImage from '../components/MealImage';
import Button from '../components/Button';

const POLL_MS = 3000;
/** The household; a smaller portion is fewer persons than this. */
const HOUSEHOLD = 4;

const card = 'bg-surface rounded-3xl p-5 md:p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)]';
const sectionTitle = 'font-bold text-sm tracking-wide text-accent uppercase';
const input = 'w-full p-3 border border-line rounded-2xl text-sm bg-sunken focus:outline-none focus:ring-2 focus:ring-brand';
const chip = 'min-h-9 px-3 rounded-full text-xs font-bold transition-colors';

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
  /** The model's explanation of the week it proposed. */
  note: string | null;
  /** When that proposal started, so it is filled in once. */
  applied: string | null;
}

const draftKey = (week: number, year: number) => `weekmenu:kiezen:${year}-${week}`;

function blankDays(state: PlannerState): DraftDay[] {
  return state.days.map((d) => ({ day_name: d.day_name, date: d.date, recipe_id: null, free: false }));
}

/** The menu that is on this week now; days it does not have were left free. */
function existingDraft(state: PlannerState): Draft | null {
  const existing = state.existing;
  if (!existing) return null;
  return {
    days: blankDays(state).map((d) => {
      const day = existing.days.find((e) => e.day_name === d.day_name);
      if (!day) return { ...d, free: true };
      return { ...d, recipe_id: day.recipe_id, ...(day.servings ? { servings: day.servings } : {}) };
    }),
    breakfasts: existing.breakfasts,
    snacks: existing.snacks,
    note: null,
    applied: null,
  };
}

/** A few approved breakfasts or snacks, different ones each week. */
function someExtras(options: PlannerExtra[], count: number): number[] {
  return options.filter((o) => o.status === 'goedgekeurd')
    .map((o) => ({ id: o.id, order: Math.random() }))
    .sort((a, b) => a.order - b.order)
    .slice(0, count)
    .map((o) => o.id);
}

/** A new week, put ready by the rules: dinners, breakfasts and snacks. */
function readyWeek(state: PlannerState): Draft {
  return {
    days: fillWeek(blankDays(state), state.recipes),
    breakfasts: someExtras(state.breakfasts, state.per_week.breakfasts),
    snacks: someExtras(state.snacks, state.per_week.snacks),
    note: null,
    applied: null,
  };
}

/** What this browser kept for the week, else the menu that is there, else a week put ready. */
function initialDraft(state: PlannerState): Draft {
  try {
    const stored = JSON.parse(localStorage.getItem(draftKey(state.week_number, state.year)) ?? 'null') as Draft | null;
    if (stored && Array.isArray(stored.days) && stored.days.length === state.days.length
      && stored.days.every((d, i) => d.day_name === state.days[i].day_name)) {
      return { ...stored, days: stored.days.map((d, i) => ({ ...d, date: state.days[i].date })) };
    }
  } catch { /* storage blocked or malformed: start afresh */ }
  return existingDraft(state) ?? readyWeek(state);
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

/** "do" and "5 nov" for a day. */
function dayLabel(day: DraftDay): [string, string] {
  const [short, ...rest] = formatShortDay(day).split(' ');
  return [short, rest.join(' ')];
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

/** The rules apply by themselves; their details on request. */
function WeekChecks({ check }: { check: MenuCheck }) {
  return (
    <details className={`${card} group`}>
      <summary className="flex items-center justify-between gap-3 cursor-pointer list-none">
        <span className={sectionTitle}>Kaders deze week</span>
        <span className="flex items-center gap-2">
          <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${TONE[check.state]}`}>{SUMMARY[check.state]}</span>
          <ChevronDown size={16} className="text-faint transition-transform group-open:rotate-180" aria-hidden />
        </span>
      </summary>
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
    </details>
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
function Chooser({ days, index, recipes, lookup, onPick }: {
  days: DraftDay[]; index: number; recipes: PlannerRecipe[]; lookup: RecipeLookup; onPick: (id: number) => void;
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
    <div className="mt-3">
      <label className="relative block">
        <span className="sr-only">Zoek een recept voor {days[index].day_name.toLowerCase()}</span>
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Zoek op naam of ingrediënt"
          className={`${input} pl-9 bg-surface`} />
      </label>
      <div className="flex flex-wrap gap-1.5 mt-2" role="group" aria-label="Filter">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}
            className={`${chip} min-h-8 ${filter === f.key ? 'bg-brand text-on-brand' : 'bg-surface text-muted hover:text-ink'}`}>
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
      {!all && candidates.length > SHOWN && (
        <button onClick={() => setAll(true)} className="mt-2 text-xs font-bold text-brand hover:text-brand-hover">
          Toon alle {candidates.length}
        </button>
      )}
    </div>
  );
}

/** A turn as shown: what the assistant said, with why it proposed each recipe. */
type Turn = ChatTurn & { reasons?: Record<number, string>; model?: string };

/** A conversation with the assistant about one day: a wish, its proposals, pick one. */
function DayChat({ state, days, index, lookup, turns, setTurns, onPick }: {
  state: PlannerState; days: DraftDay[]; index: number; lookup: RecipeLookup;
  turns: Turn[]; setTurns: (turns: Turn[]) => void; onPick: (id: number) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { end.current?.scrollIntoView?.({ block: 'nearest' }); }, [turns, busy]);

  async function send() {
    const question = text.trim();
    if (!question || busy) return;
    const asked: Turn[] = [...turns, { role: 'user', content: question }];
    setTurns(asked);
    setText('');
    setBusy(true);
    setError(null);
    try {
      const answer = await plannerApi.chat({
        week_number: state.week_number,
        year: state.year,
        day_name: days[index].day_name,
        days: days.map(({ day_name, recipe_id, free }) => ({ day_name, recipe_id, free })),
        messages: asked.map(({ role, content, suggestions }) => ({ role, content, ...(suggestions ? { suggestions } : {}) })),
      });
      setTurns([...asked, {
        role: 'assistant', content: answer.reply || 'Deze passen bij je wens.', model: answer.model,
        suggestions: answer.suggestions.map((s) => s.recipe_id),
        reasons: Object.fromEntries(answer.suggestions.map((s) => [s.recipe_id, s.reason])),
      }]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 p-3 rounded-2xl bg-surface">
      {turns.length === 0 && (
        <p className="text-xs text-muted mb-2">
          Zeg waar je zin in hebt, bijvoorbeeld "iets met pompoen", "snel en zonder vlees" of "iets wat de kinderen lekker vinden".
          De assistent kiest uit jullie recepten.
        </p>
      )}
      <ul className="space-y-2" aria-live="polite">
        {turns.map((turn, t) => (
          <li key={t} className={turn.role === 'user' ? 'flex justify-end' : ''}>
            {turn.role === 'user' ? (
              <span className="inline-block max-w-[85%] px-3 py-2 rounded-2xl rounded-br-md bg-brand text-on-brand text-sm">{turn.content}</span>
            ) : (
              <div>
                <p className="inline-block max-w-[95%] px-3 py-2 rounded-2xl rounded-bl-md bg-sunken text-sm">{turn.content}</p>
                <ul className="mt-1.5 space-y-1">
                  {(turn.suggestions ?? []).map((id) => {
                    const recipe = lookup.get(id);
                    if (!recipe) return null;
                    return (
                      <li key={id} className="flex items-start gap-3 p-2 rounded-2xl border border-line-soft">
                        <Thumb recipe={recipe} size={40} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-bold leading-snug">{recipe.name}</span>
                          <span className="block text-[11px] text-muted">{recipeMeta(recipe)}</span>
                          {turn.reasons?.[id] && <span className="block text-[11px] italic">{turn.reasons[id]}</span>}
                          <FitLine fit={fitOf(days, index, recipe, lookup)} />
                        </span>
                        <Button size="sm" onClick={() => onPick(id)} aria-label={`Kies ${recipe.name}`}>Kies</Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </li>
        ))}
        {busy && (
          <li className="flex items-center gap-2 text-xs text-muted" role="status">
            <Loader2 size={14} className="animate-spin" aria-hidden /> Even denken…
          </li>
        )}
      </ul>
      <div ref={end} />
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      <form className="flex gap-2 mt-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} autoFocus
          aria-label={`Vraag de assistent iets voor ${days[index].day_name.toLowerCase()}`}
          placeholder={turns.length ? 'Nog iets anders?' : 'Waar heb je zin in?'} className={`${input} bg-sunken`} />
        <button type="submit" disabled={busy || !text.trim()} aria-label="Verstuur"
          className="shrink-0 w-11 h-11 rounded-2xl bg-brand text-on-brand flex items-center justify-center disabled:opacity-50">
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}

type Panel = 'zoek' | 'portie' | 'wissel' | 'chat' | null;

/** One day: its dinner, what is off, and what can be done with it. */
function DayCard({
  day, index, days, recipe, check, lookup, state, open, onToggle, onNext, onPick, onServings, onSwap, onSkip, onPlan,
  turns, setTurns, nothingElse,
}: {
  day: DraftDay; index: number; days: DraftDay[]; recipe: PlannerRecipe | undefined; check: MenuCheck['days'][number];
  lookup: RecipeLookup; state: PlannerState; open: boolean; onToggle: () => void;
  onNext: () => void; onPick: (id: number) => void; onServings: (n: number) => void; onSwap: (other: number) => void;
  onSkip: () => void; onPlan: () => void; turns: Turn[]; setTurns: (turns: Turn[]) => void; nothingElse: boolean;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const StateIcon = STATE_ICON[check.state];
  const [short, date] = dayLabel(day);
  const servings = day.servings ?? HOUSEHOLD;
  const toggle = (p: Panel) => setPanel(panel === p ? null : p);

  useEffect(() => { if (!open) setPanel(null); }, [open]);

  const action = (p: Panel | 'next' | 'skip', Icon: LucideIcon, label: string, onClick: () => void, disabled = false) => (
    <button key={label} onClick={onClick} disabled={disabled} aria-pressed={p === panel ? true : undefined}
      className={`flex items-center gap-2 min-h-11 px-3 rounded-2xl text-sm font-bold text-left transition-colors disabled:opacity-50 ${
        p === panel ? 'bg-brand/10 text-brand' : 'bg-sunken hover:bg-raised'
      }`}>
      <Icon size={16} className="shrink-0" aria-hidden /> {label}
    </button>
  );

  return (
    <li>
      <button onClick={onToggle} aria-expanded={open}
        className="w-full flex items-center gap-3 p-3 text-left rounded-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
        <span className="w-12 shrink-0">
          <span className="block text-[11px] font-bold uppercase tracking-wider text-accent">{short}</span>
          <span className="block text-[11px] text-muted">{date}</span>
        </span>
        {recipe && !day.free ? <Thumb recipe={recipe} size={44} /> : (
          <span className="w-11 h-11 shrink-0 rounded-xl border-2 border-dashed border-line" aria-hidden />
        )}
        <span className="flex-1 min-w-0">
          {day.free ? (
            <span className="block text-sm text-muted">Overgeslagen, geen avondeten</span>
          ) : recipe ? (
            <>
              <span className="block text-sm font-bold leading-snug line-clamp-2">{recipe.name}</span>
              <span className="block text-[11px] text-muted truncate">
                {servings < HOUSEHOLD && <strong className="text-ink">voor {servings} · </strong>}{recipeMeta(recipe)}
              </span>
            </>
          ) : day.recipe_id !== null ? (
            <span className="block text-sm text-muted">Recept #{day.recipe_id} staat niet meer in de bibliotheek</span>
          ) : (
            <span className="block text-sm font-bold text-brand">Kies een recept</span>
          )}
        </span>
        {recipe && !day.free && (
          <span className={TEXT[check.state]} title={STATE_WORD[check.state]}>
            <StateIcon size={18} aria-hidden />
            <span className="sr-only">{STATE_WORD[check.state]}</span>
          </span>
        )}
        <ChevronDown size={16} className={`shrink-0 text-faint transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {check.checks.length > 0 && (
        <ul className="px-3 pb-2 -mt-1 flex flex-wrap gap-1.5 pl-[4.25rem]">
          {check.checks.map((c) => (
            <li key={c.key} className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${TONE[c.state]}`}>{c.detail}</li>
          ))}
        </ul>
      )}

      {open && (
        <div className="px-3 pb-3">
          {day.free ? (
            <div className="grid grid-cols-2 gap-2">
              {action('next', Undo2, 'Toch plannen', onPlan)}
              {action('zoek', Search, 'Zoek zelf', () => toggle('zoek'))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {action('next', RotateCcw, 'Kies nieuw recept', onNext, nothingElse)}
              {action('zoek', Search, 'Zoek zelf', () => toggle('zoek'))}
              {action('portie', Minus, servings < HOUSEHOLD ? `Portie: voor ${servings}` : 'Verklein portie', () => toggle('portie'), !recipe)}
              {action('wissel', ArrowLeftRight, 'Wissel van dag', () => toggle('wissel'))}
              {action('skip', SkipForward, 'Sla deze dag over', onSkip)}
              {action('chat', MessageCircle, 'Vraag de assistent', () => toggle('chat'), !state.configured)}
            </div>
          )}
          {nothingElse && !day.free && <p className="mt-2 text-xs text-muted">Er is geen ander recept dat past; zoek zelf of vraag de assistent.</p>}
          {!state.configured && !day.free && <p className="mt-2 text-xs text-muted">De assistent is op deze server niet ingesteld.</p>}

          {panel === 'zoek' && <Chooser days={days} index={index} recipes={state.recipes} lookup={lookup} onPick={onPick} />}

          {panel === 'portie' && (
            <div className="mt-3" role="group" aria-label="Voor hoeveel personen">
              <p className="text-xs text-muted mb-2">Voor hoeveel personen koken jullie? De boodschappen en het recept rekenen mee.</p>
              <div className="flex flex-wrap gap-1.5">
                {[HOUSEHOLD, 3, 2, 1].map((n) => (
                  <button key={n} onClick={() => { onServings(n); setPanel(null); }} aria-pressed={servings === n}
                    className={`${chip} ${servings === n ? 'bg-brand text-on-brand' : 'bg-sunken text-muted hover:text-ink'}`}>
                    {n === HOUSEHOLD ? `${n} (iedereen)` : `${n} ${n === 1 ? 'persoon' : 'personen'}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {panel === 'wissel' && (
            <div className="mt-3" role="group" aria-label="Wissel met">
              <p className="text-xs text-muted mb-2">Wissel {day.day_name.toLowerCase()} met:</p>
              <div className="flex flex-wrap gap-1.5">
                {days.map((other, j) => {
                  if (j === index) return null;
                  const r = other.recipe_id !== null ? lookup.get(other.recipe_id) : undefined;
                  return (
                    <button key={other.day_name} onClick={() => { onSwap(j); setPanel(null); }}
                      className={`${chip} bg-sunken text-muted hover:text-ink max-w-full truncate`}>
                      {dayLabel(other)[0]} · {other.free ? 'overgeslagen' : r?.name ?? 'leeg'}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {panel === 'chat' && (
            <DayChat state={state} days={days} index={index} lookup={lookup} turns={turns} setTurns={setTurns} onPick={onPick} />
          )}
        </div>
      )}
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

/** Have the assistant choose the whole week (minutes); the page follows it on the server. */
function WholeWeekAssistant({ state, job, draft, onPropose, offline }: {
  state: PlannerState; job: ProposalJob; draft: Draft; onPropose: (wishes: string) => void;
  /** The last status request failed. */
  offline: boolean;
}) {
  const [wishes, setWishes] = useState('');
  const here = job.week_number === state.week_number && job.year === state.year;
  if (!state.configured) return null;
  return (
    <div className="pt-4 border-t border-line-soft">
      <span className="flex items-center gap-2 text-sm font-bold"><WandSparkles size={16} className="text-brand" aria-hidden /> De assistent kiest de hele week</span>
      <p className="text-xs text-muted mt-1">
        Vervangt de dagen die je niet zelf gekozen hebt. Neemt ook de opmerkingen van het gezin en het seizoen mee; duurt een paar minuten.
      </p>
      {job.running ? (
        <div className="mt-2 p-3 rounded-2xl bg-sunken text-sm" role="status">
          <span className="flex items-center gap-2 font-bold">
            <Loader2 size={16} className="animate-spin" aria-hidden />
            {here ? `Poging ${job.attempt} van ${job.attempts}` : `Bezig met week ${job.week_number}`}
            {job.model ? ` · ${job.model}` : ''}
          </span>
          <span className="block text-xs text-muted mt-1">Je mag de pagina sluiten; het voorstel wacht hier op je.</span>
          {offline && <span className="block text-xs text-warn mt-1">Geen verbinding met de server; ik probeer het zo opnieuw.</span>}
        </div>
      ) : (
        <div className="flex gap-2 mt-2">
          <input value={wishes} onChange={(e) => setWishes(e.target.value)} maxLength={1000}
            aria-label="Wensen voor deze week" placeholder="Wensen (mag leeg)" className={input} />
          <Button variant="secondary" onClick={() => onPropose(wishes.trim())} className="shrink-0">Kies</Button>
        </div>
      )}
      {here && !job.running && job.error && <p role="alert" className="mt-2 text-xs text-danger">{job.error}</p>}
      {draft.note && <p className="mt-2 p-3 rounded-2xl bg-sunken text-sm">{draft.note}</p>}
    </div>
  );
}

/**
 * The week, put ready by the family's rules: per day another recipe, a
 * smaller portion, another day, skipping it, or asking the assistant for
 * something specific. The rules show per day and for the week.
 */
export default function MenuPicker() {
  const [params, setParams] = useSearchParams();
  const week = Number(params.get('week')) || undefined;
  const year = Number(params.get('year')) || undefined;
  const [state, setState] = useState<PlannerState | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [job, setJob] = useState<ProposalJob | null>(null);
  /** Status requests that failed in a row; the next one waits longer. */
  const [pollFailures, setPollFailures] = useState(0);
  const [openDay, setOpenDay] = useState<number | null>(null);
  /** Per day, what "Kies nieuw recept" offered already, so asking again goes on to the next. */
  const [offered, setOffered] = useState<Record<string, number[]>>({});
  const [nothingElse, setNothingElse] = useState<string | null>(null);
  /** The conversation with the assistant per day, while the page is open. */
  const [chats, setChats] = useState<Record<string, Turn[]>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ week: number; first: string | null; last: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setState(null);
    setOpenDay(null);
    setOffered({});
    setChats({});
    plannerApi.get(week, year).then((next) => {
      if (!alive) return;
      setState(next);
      const first = initialDraft(next);
      setDraft(first);
      // A week put ready is kept straight away, so coming back shows the same week
      if (!next.existing) keep(next, first);
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

  // Follow a proposal while it runs; a failed request (the network, a restart) is tried again
  useEffect(() => {
    if (!job?.running) return;
    const timer = setTimeout(() => {
      plannerApi.proposal()
        .then(({ job: next }) => { setPollFailures(0); setJob(next); })
        .catch(() => setPollFailures((n) => n + 1));
    }, POLL_MS * Math.min(pollFailures + 1, 5));
    return () => clearTimeout(timer);
  }, [job, pollFailures]);

  // A finished proposal for this week fills the days that are still open, once
  useEffect(() => {
    const proposal = job?.proposal;
    if (!state || !draft || !job || job.running || !proposal) return;
    if (job.week_number !== state.week_number || job.year !== state.year || draft.applied === job.started_at) return;
    // The week was saved after the proposal came in: it was dealt with then. To the second, as SQLite keeps it
    if (state.existing && job.finished_at
      && Date.parse(state.existing.saved_at) >= Math.floor(Date.parse(job.finished_at) / 1000) * 1000) return;
    // Nothing open (the week was put ready on another device): the proposal is not for this draft
    if (!draft.days.some((d) => !d.free && d.recipe_id === null)) {
      update((d) => ({ ...d, applied: job.started_at }));
      return;
    }
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

  /**
   * The next best recipe for a day, going on through the ones not offered yet:
   * first those that keep to the rules, then from the best again; one that
   * breaks a rule only when nothing else fits.
   */
  function another(index: number) {
    if (!draft || !state) return;
    const name = draft.days[index].day_name;
    const current = draft.days[index].recipe_id;
    const seen = [...(offered[name] ?? []), ...(current !== null ? [current] : [])];
    const onlyCurrent = current !== null ? [current] : [];
    let round = seen;
    let next = nextRecipe(draft.days, index, state.recipes, new Set(seen), { fitting: true });
    if (next === null) {
      round = onlyCurrent;
      next = nextRecipe(draft.days, index, state.recipes, new Set(round), { fitting: true });
    }
    if (next === null) {
      round = seen;
      next = nextRecipe(draft.days, index, state.recipes, new Set(seen));
    }
    if (next === null && seen.length > onlyCurrent.length) {
      round = onlyCurrent;
      next = nextRecipe(draft.days, index, state.recipes, new Set(round));
    }
    setNothingElse(next === null ? name : null);
    if (next === null) return;
    setOffered({ ...offered, [name]: round });
    setDay(index, { recipe_id: next, free: false, chosen: false });
  }

  /** Put the open days ready again, leaving what was chosen by hand and the days skipped. */
  function refill() {
    update((d) => ({
      ...d,
      days: fillWeek(d.days.map((day) => (day.free || day.chosen ? day : { ...day, recipe_id: null })), state!.recipes),
      note: null,
    }));
    setOffered({});
  }

  function swap(a: number, b: number) {
    update((d) => {
      const days = [...d.days];
      const contents = ({ recipe_id, free, servings, chosen }: DraftDay) => ({ recipe_id, free, servings, chosen });
      days[a] = { day_name: d.days[a].day_name, date: d.days[a].date, ...contents(d.days[b]) };
      days[b] = { day_name: d.days[b].day_name, date: d.days[b].date, ...contents(d.days[a]) };
      return { ...d, days };
    });
    setOpenDay(null);
  }

  /** A skipped day planned again: the best that fits. */
  function plan(index: number) {
    if (!draft || !state) return;
    const days = draft.days.map((d, i) => (i === index ? { ...d, free: false, recipe_id: null } : d));
    const filled = fillWeek(days, state.recipes);
    setDay(index, { free: false, recipe_id: filled[index].recipe_id, chosen: false });
  }

  async function proposeWeek(wishes: string) {
    if (!state || !draft) return;
    setError(null);
    // The days not chosen by hand are open for the assistant, and wait for it
    const days = draft.days.map((d) => (d.free || d.chosen ? d : { ...d, recipe_id: null }));
    try {
      const { job: started } = await plannerApi.propose({
        week_number: state.week_number,
        year: state.year,
        days: days.map(({ day_name, recipe_id, free }) => ({ day_name, recipe_id, free })),
        breakfasts: draft.breakfasts,
        snacks: draft.snacks,
        wishes,
      });
      update((d) => ({ ...d, days, note: null }));
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
          days: chosen.map((d) => ({
            day_name: d.day_name, recipe_id: d.recipe_id, recipe_name: lookup.get(d.recipe_id!)?.name,
            ...(d.servings && d.servings < HOUSEHOLD ? { servings: d.servings } : {}),
          })),
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
  const waiting = job.running && job.week_number === state.week_number && job.year === state.year;

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

      {state.existing ? (
        <p className="flex items-start gap-2 p-3 rounded-2xl bg-warn-soft text-warn text-sm">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden />
          <span>
            Week {state.week_number} staat al {state.existing.status === 'archived' ? 'in het archief' : 'op het menu'}.
            Opslaan vervangt hem, met afvinkjes en beoordelingen.
          </span>
        </p>
      ) : (
        <p className="text-sm text-muted">De week staat klaar volgens jullie kaders. Tik op een dag om iets te veranderen.</p>
      )}

      <CountBar check={check} />
      <WeekChecks check={check} />

      <section aria-labelledby="dagen-title">
        <div className="flex items-center justify-between mb-3">
          <h2 id="dagen-title" className={sectionTitle}>Avondeten</h2>
          <button onClick={refill} disabled={waiting}
            className="flex items-center gap-1.5 min-h-9 px-2 text-xs font-bold text-brand hover:text-brand-hover disabled:opacity-50">
            <Shuffle size={13} aria-hidden /> Nieuw voorstel
          </button>
        </div>
        {waiting && (
          <p className="flex items-center gap-2 mb-3 text-sm text-muted" role="status">
            <Loader2 size={14} className="animate-spin" aria-hidden /> De assistent kiest de open dagen…
          </p>
        )}
        <ul className="bg-surface rounded-3xl divide-y divide-line-soft shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
          {draft.days.map((day, i) => (
            <DayCard key={day.day_name} day={day} index={i} days={draft.days}
              recipe={day.recipe_id !== null ? lookup.get(day.recipe_id) : undefined}
              check={check.days[i]} lookup={lookup} state={state} open={openDay === i}
              onToggle={() => { setOpenDay(openDay === i ? null : i); setNothingElse(null); }}
              onNext={() => another(i)}
              onPick={(id) => { setDay(i, { recipe_id: id, free: false, chosen: true }); setOpenDay(null); }}
              onServings={(n) => setDay(i, { servings: n < HOUSEHOLD ? n : undefined })}
              onSwap={(j) => swap(i, j)}
              onSkip={() => { setDay(i, { recipe_id: null, free: true, chosen: false }); setOpenDay(null); }}
              onPlan={() => plan(i)}
              turns={chats[day.day_name] ?? []}
              setTurns={(turns) => setChats((c) => ({ ...c, [day.day_name]: turns }))}
              nothingElse={nothingElse === day.day_name} />
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
        <Button block size="lg" onClick={save} disabled={busy || chosen.length === 0 || waiting}>
          <Check size={18} />
          {busy ? 'Bezig...' : `Zet ${chosen.length} ${chosen.length === 1 ? 'dag' : 'dagen'} op het menu`}
        </Button>
        {check.state === 'fail' && chosen.length > 0 && (
          <p className="text-xs text-muted text-center">De week valt nog buiten de kaders; opslaan kan wel.</p>
        )}
      </div>

      <details className={`${card} group`}>
        <summary className="flex items-center justify-between cursor-pointer list-none font-bold text-sm">
          Meer
          <ChevronDown size={16} className="text-faint transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm"
              onClick={() => update((d) => ({ ...d, days: blankDays(state), breakfasts: [], snacks: [], note: null }))}>
              <Eraser size={14} /> Leeg maken
            </Button>
            {fromMenu && (
              <Button variant="secondary" size="sm" onClick={() => update((d) => ({ ...fromMenu, applied: d.applied }))}>
                <RotateCcw size={14} /> Zoals op het menu
              </Button>
            )}
          </div>
          <WholeWeekAssistant state={state} job={job} draft={draft} onPropose={proposeWeek} offline={pollFailures > 0} />
        </div>
      </details>
    </div>
  );
}
