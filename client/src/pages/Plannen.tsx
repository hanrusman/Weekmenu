import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Archive, Check, ChevronDown, ChevronRight, ClipboardCopy, ClipboardPaste, LogOut, Monitor, Moon, Sparkles, Sun,
  Trash2, WandSparkles, X,
} from 'lucide-react';
import { api, Menu, MenuDay, MenuPreview, formatDateRange, formatShortDay } from '../lib/api';
import { useMenus } from '../hooks/useMenu';
import { useAuth } from '../lib/auth';
import { ThemeChoice, useTheme } from '../lib/theme';
import { MEAL_TYPE_EMOJI, recipeImageUrl } from '../lib/mealImages';
import MealImage from '../components/MealImage';
import Button from '../components/Button';
import { extraLabel } from '../components/ExtraCard';

const EXAMPLE_JSON = `{
  "days": [
    {"day_name": "Donderdag", "recipe_id": 12, "recipe_name": "Linzensoep"},
    {
      "day_name": "Vrijdag",
      "recipe_name": "Pasta pesto met courgette",
      "meal_type": "pasta",
      "prep_time_minutes": 20,
      "cost_index": "€",
      "recipe": {
        "servings": 4,
        "ingredients": [
          {"name": "pasta", "amount": 400, "unit": "g", "product_group": "droogwaren"},
          {"name": "courgette", "amount": 2, "unit": "stuks", "product_group": "groenten"}
        ],
        "steps": ["Kook de pasta", "Bak de courgette"],
        "nutrition_per_serving": {"calories": 450, "protein_g": 18, "fiber_g": 6, "iron_mg": 2.5}
      }
    }
  ],
  "breakfasts": [
    {"recipe_id": 31, "recipe_name": "Overnight oats met appel", "day_name": "Zaterdag"}
  ],
  "snacks": [
    {"recipe_id": 41, "recipe_name": "Energy balls met dadel"}
  ]
}`;

const card = 'bg-surface rounded-3xl p-5 md:p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)]';
const sectionTitle = 'font-bold text-sm tracking-wide text-accent uppercase';
const input = 'w-full p-3 border border-line rounded-2xl text-sm bg-sunken focus:outline-none focus:ring-2 focus:ring-brand';

/** Delete in two taps: the first asks, the second deletes. */
function DeleteButton({ confirming, onAsk, onConfirm, onCancel, disabled, label }: {
  confirming: boolean; onAsk: () => void; onConfirm: () => void; onCancel: () => void; disabled?: boolean; label: string;
}) {
  if (confirming) {
    return (
      <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <Button variant="ghost" size="sm" onClick={onCancel}>Nee</Button>
        <Button variant="danger" size="sm" onClick={onConfirm} disabled={disabled}>Verwijder</Button>
      </span>
    );
  }
  return (
    <button onClick={(e) => { e.stopPropagation(); onAsk(); }} disabled={disabled} aria-label={label}
      className="flex items-center justify-center w-9 h-9 text-faint hover:text-danger hover:bg-danger-soft rounded-xl transition-colors disabled:opacity-50">
      <Trash2 size={15} />
    </button>
  );
}

function StepHeader({ n, title, state, children }: {
  n: number; title: string; state: 'done' | 'current' | 'todo'; children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span aria-hidden className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
        state === 'done' ? 'bg-success-soft text-success' : state === 'current' ? 'bg-brand text-on-brand' : 'bg-raised text-muted'
      }`}>
        {state === 'done' ? <Check size={16} /> : n}
      </span>
      <div className="flex-1 min-w-0 pt-1">
        <h3 className={`font-bold ${state === 'todo' ? 'text-muted' : ''}`}>
          <span className="sr-only">Stap {n}: </span>{title}
        </h3>
        {children}
      </div>
    </div>
  );
}

/** Copy the brief, paste Claude's answer, look at it, then put it on the menu. */
function PlanSteps({ onImported }: { onImported: () => void }) {
  const [targetWeek, setTargetWeek] = useState<{ weekNumber: number; year: number } | null>(null);
  const [brief, setBrief] = useState<{ text: string; recipe_count: number } | null>(null);
  const [briefState, setBriefState] = useState<'idle' | 'loading' | 'copied' | 'manual'>('idle');
  const [json, setJson] = useState('');
  const [weekNumber, setWeekNumber] = useState('');
  const [yearInput, setYearInput] = useState('');
  const [editWeek, setEditWeek] = useState(false);
  const [showExample, setShowExample] = useState(false);
  const [preview, setPreview] = useState<MenuPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<MenuPreview | null>(null);

  useEffect(() => {
    api.getTargetWeek().then(setTargetWeek).catch(() => {});
  }, []);

  const request = () => {
    let menu: unknown;
    try { menu = JSON.parse(json); } catch {
      throw new Error('Dit is geen geldige JSON. Kopieer het hele codeblok uit het antwoord van Claude.');
    }
    return {
      menu,
      weekNumber: weekNumber ? parseInt(weekNumber) : undefined,
      year: yearInput ? parseInt(yearInput) : undefined,
    };
  };

  async function copyBrief() {
    setBriefState('loading');
    setError(null);
    try {
      const data = await api.getPlanningBrief();
      setBrief(data);
      try {
        await navigator.clipboard.writeText(data.text);
        setBriefState('copied');
      } catch {
        setBriefState('manual');
      }
    } catch (err) {
      setError((err as Error).message);
      setBriefState('idle');
    }
  }

  async function pasteFromClipboard() {
    try {
      setJson(await navigator.clipboard.readText());
      setError(null);
    } catch {
      setError('Plakken lukte niet automatisch — houd het tekstvak ingedrukt en kies Plakken.');
    }
  }

  async function showPreview() {
    setBusy(true);
    setError(null);
    try {
      setPreview(await api.previewMenu(request()));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    setBusy(true);
    setError(null);
    try {
      await api.importMenu(request());
      setImported(preview);
      setPreview(null);
      setJson('');
      setBrief(null);
      setBriefState('idle');
      onImported();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const week = weekNumber ? parseInt(weekNumber) : targetWeek?.weekNumber;
  const year = yearInput ? parseInt(yearInput) : targetWeek?.year;
  const step = preview ? 3 : briefState === 'copied' || briefState === 'manual' || json ? 2 : 1;

  if (imported) {
    const first = imported.days[0]?.date;
    const last = imported.days[imported.days.length - 1]?.date;
    return (
      <div className={`${card} text-center`}>
        <div className="mx-auto w-12 h-12 rounded-full bg-success-soft text-success flex items-center justify-center mb-3">
          <Check size={24} />
        </div>
        <h2 className="text-xl font-bold">Week {imported.week_number} staat op het menu</h2>
        <p className="text-sm text-muted mt-1">{formatDateRange(first, last)} · de boodschappenlijst is klaar</p>
        <div className="grid grid-cols-2 gap-3 mt-5">
          <Link to="/" className="inline-flex items-center justify-center min-h-11 rounded-2xl font-bold text-sm bg-brand text-on-brand hover:bg-brand-hover">
            Bekijk menu
          </Link>
          <Link to="/boodschappen" className="inline-flex items-center justify-center min-h-11 rounded-2xl font-bold text-sm bg-surface border border-line hover:bg-raised">
            Boodschappen
          </Link>
        </div>
        <Button variant="ghost" size="sm" className="mt-3" onClick={() => setImported(null)}>Nog een week plannen</Button>
      </div>
    );
  }

  return (
    <div className={card}>
      <div className="flex items-center gap-2 mb-5">
        <Sparkles size={18} className="text-brand" />
        <h2 className="text-lg font-bold">Plannen met Claude</h2>
      </div>

      <ol className="space-y-6">
        <li>
          <StepHeader n={1} title="Kopieer de bibliotheek" state={step > 1 ? 'done' : 'current'}>
            <p className="text-sm text-muted mt-1">
              Goedgekeurde recepten, ontbijt en tussendoortjes, wat recent gepland is en de feedback. Plak het in een gesprek met Claude.
            </p>
            <Button variant={step === 1 ? 'primary' : 'secondary'} size="md" className="mt-3"
              onClick={copyBrief} disabled={briefState === 'loading'}>
              {briefState === 'copied' ? <Check size={16} /> : <ClipboardCopy size={16} />}
              {briefState === 'loading' ? 'Laden...' : briefState === 'copied' ? 'Gekopieerd' : 'Kopieer voor Claude'}
            </Button>
            {brief && (
              <p className="text-xs text-muted mt-2">
                {brief.recipe_count} goedgekeurde {brief.recipe_count === 1 ? 'recept' : 'recepten'}
                {brief.recipe_count === 0 && ' — keur eerst recepten goed onder Recepten, anders stelt Claude een volledig nieuw menu voor'}
                {briefState === 'manual' && ' — kopiëren lukte niet automatisch, selecteer de tekst hieronder'}
              </p>
            )}
            {brief && briefState === 'manual' && (
              <textarea readOnly value={brief.text} rows={6} onFocus={(e) => e.currentTarget.select()}
                className={`${input} mt-2 text-xs text-muted font-mono`} />
            )}
          </StepHeader>
        </li>

        <li>
          <StepHeader n={2} title="Plak het antwoord van Claude" state={step > 2 ? 'done' : step === 2 ? 'current' : 'todo'}>
            {!preview && (
              <>
                <textarea value={json} onChange={(e) => setJson(e.target.value)}
                  placeholder='{"days": [ … ] }'
                  aria-label="Menu JSON van Claude"
                  className={`${input} mt-3 resize-y font-mono`} rows={6} />

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2 text-xs">
                  <button onClick={pasteFromClipboard} className="inline-flex items-center gap-1 font-bold text-brand hover:text-brand-hover">
                    <ClipboardPaste size={13} /> Plak van klembord
                  </button>
                  <button onClick={() => setEditWeek(!editWeek)} className="font-bold text-muted hover:text-ink">
                    Wordt week {week ?? '…'}{year && year !== new Date().getFullYear() ? `, ${year}` : ''} · wijzigen
                  </button>
                  <button onClick={() => setShowExample(!showExample)} className="font-bold text-muted hover:text-ink">
                    {showExample ? 'Verberg voorbeeld' : 'Voorbeeld'}
                  </button>
                </div>

                {editWeek && (
                  <div className="flex gap-3 mt-3">
                    <label className="flex-1 text-xs text-muted">
                      Week
                      <input type="number" value={weekNumber} onChange={(e) => setWeekNumber(e.target.value)}
                        placeholder={targetWeek ? String(targetWeek.weekNumber) : 'Auto'} className={`${input} mt-1`} />
                    </label>
                    <label className="flex-1 text-xs text-muted">
                      Jaar
                      <input type="number" value={yearInput} onChange={(e) => setYearInput(e.target.value)}
                        placeholder={targetWeek ? String(targetWeek.year) : 'Auto'} className={`${input} mt-1`} />
                    </label>
                  </div>
                )}

                {showExample && (
                  <div className="mt-3 p-4 bg-sunken rounded-2xl">
                    <pre className="text-xs text-muted overflow-x-auto whitespace-pre-wrap break-words">{EXAMPLE_JSON}</pre>
                    <button onClick={() => setJson(EXAMPLE_JSON)} className="mt-2 text-xs text-brand hover:underline font-bold">
                      Gebruik dit voorbeeld
                    </button>
                  </div>
                )}

                <Button className="mt-4" block onClick={showPreview} disabled={busy || !json.trim()}>
                  {busy ? 'Controleren...' : 'Bekijk het voorstel'}
                </Button>
              </>
            )}
          </StepHeader>
        </li>

        <li>
          <StepHeader n={3} title="Controleer en zet op het menu" state={step === 3 ? 'current' : 'todo'}>
            {preview && (
              <div className="mt-3">
                <p className="text-sm font-bold">
                  Week {preview.week_number} · {formatDateRange(preview.days[0]?.date, preview.days[preview.days.length - 1]?.date)}
                </p>
                {preview.replaces && (
                  <p className="flex items-start gap-2 mt-2 p-3 rounded-2xl bg-warn-soft text-warn text-sm">
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                    Week {preview.week_number} staat al op het menu en wordt vervangen, met afvinkjes en feedback.
                  </p>
                )}
                <ul className="mt-3 divide-y divide-line-soft">
                  {preview.days.map((d, i) => (
                    <li key={i} className="flex items-center gap-3 py-2.5">
                      <div className="w-11 h-11 shrink-0 rounded-xl bg-sunken flex items-center justify-center overflow-hidden">
                        <MealImage ownSrc={recipeImageUrl(d.recipe_id, d.recipe_image_version)} recipeName={d.recipe_name}
                          mealType={d.meal_type ?? ''} size={44} className="w-11 h-11"
                          fallback={<span className="text-xl">{MEAL_TYPE_EMOJI[d.meal_type ?? ''] || '🍽️'}</span>} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="block text-[11px] font-bold uppercase tracking-wider text-accent">{formatShortDay(d)}</span>
                        <span className="block text-sm font-bold truncate">{d.recipe_name}</span>
                      </div>
                      {d.new_recipe && (
                        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-warn-soft text-warn"
                          title="Staat nog niet in de bibliotheek; komt erbij als concept">
                          Nieuw
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {preview.extras.length > 0 && (
                  <ul className="mt-2 pt-2 border-t border-line-soft divide-y divide-line-soft" aria-label="Ontbijt en tussendoortjes">
                    {preview.extras.map((e, i) => (
                      <li key={i} className="flex items-center gap-3 py-2">
                        <div className="w-9 h-9 shrink-0 rounded-xl bg-sunken flex items-center justify-center overflow-hidden">
                          <MealImage ownSrc={recipeImageUrl(e.recipe_id, e.recipe_image_version)} recipeName={e.recipe_name}
                            mealType={e.meal_type ?? ''} size={36} className="w-9 h-9"
                            fallback={<span className="text-lg">{e.kind === 'ontbijt' ? '🥣' : '🍎'}</span>} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="block text-[11px] font-bold uppercase tracking-wider text-accent">{extraLabel(e)}</span>
                          <span className="block text-sm truncate">{e.recipe_name}</span>
                        </div>
                        {e.new_recipe && (
                          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-warn-soft text-warn"
                            title="Staat nog niet in de bibliotheek; komt erbij als concept">
                            Nieuw
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {preview.snack_suggestions.length > 0 && (
                  <p className="text-xs text-muted mt-2">Tussendoortjes: {preview.snack_suggestions.join(', ')}</p>
                )}
                <div className="grid grid-cols-[auto_1fr] gap-3 mt-5">
                  <Button variant="secondary" onClick={() => setPreview(null)} disabled={busy}>Terug</Button>
                  <Button onClick={confirmImport} disabled={busy}>
                    <Check size={16} />
                    {busy ? 'Bezig...' : 'Zet op het menu'}
                  </Button>
                </div>
              </div>
            )}
          </StepHeader>
        </li>
      </ol>

      {error && (
        <div role="alert" className="flex items-start gap-2 bg-danger-soft text-danger p-3 rounded-2xl mt-5 text-sm">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} aria-label="Sluit melding"><X size={16} /></button>
        </div>
      )}
    </div>
  );
}

/** The way in to planning in the app itself. */
function PickerLink() {
  return (
    <Link to="/plannen/kiezen"
      className={`${card} flex items-center gap-4 hover:bg-raised transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand`}>
      <span className="shrink-0 w-11 h-11 rounded-2xl bg-brand/10 text-brand flex items-center justify-center">
        <WandSparkles size={20} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-lg font-bold">Menu kiezen</span>
        <span className="block text-sm text-muted">
          Kies per dag uit de bibliotheek of laat een week voorstellen, en zie meteen of je binnen de kaders blijft.
        </span>
      </span>
      <ChevronRight size={20} className="shrink-0 text-faint" />
    </Link>
  );
}

/** The weeks on the menu now; open one to see or take out its days. */
function ActiveMenus({ menus, refresh }: { menus: Menu[]; refresh: () => void }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [days, setDays] = useState<MenuDay[]>([]);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = menus.filter((m) => m.status === 'active');
  const archived = menus.length - active.length;

  const loadDays = useCallback(async (id: number) => {
    try {
      setDays((await api.getMenu(id)).days);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  async function run(id: number, action: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    try {
      await action();
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  function toggle(id: number) {
    setConfirm(null);
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    setDays([]);
    loadDays(id);
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className={sectionTitle}>Op het menu</h2>
        <Link to="/archief" className="flex items-center gap-1.5 min-h-9 px-2 text-xs font-bold text-brand hover:text-brand-hover">
          <Archive size={13} />
          Archief ({archived})
        </Link>
      </div>
      {active.length === 0 && (
        <p className="text-sm text-muted">Geen weken op het menu. Een week gaat vanzelf naar het archief zodra de laatste dag voorbij is.</p>
      )}
      <div className="space-y-2">
        {active.map((menu) => (
          <div key={menu.id} className="bg-surface rounded-2xl shadow-[0_2px_10px_rgba(0,0,0,0.03)]">
            <div className="flex items-center gap-2 p-2 pl-4">
              <button onClick={() => toggle(menu.id)} aria-expanded={openId === menu.id}
                className="flex-1 min-w-0 flex items-center gap-2 text-left py-1">
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-sm">Week {menu.week_number}</span>
                  <p className="text-xs text-muted">
                    {formatDateRange(menu.first_date, menu.last_date)}
                    {menu.day_count ? ` · ${menu.completed_count ?? 0} van ${menu.day_count} afgevinkt` : ''}
                  </p>
                </div>
                <ChevronDown size={16} className={`text-faint transition-transform ${openId === menu.id ? 'rotate-180' : ''}`} />
              </button>
              <button onClick={() => run(menu.id, () => api.setMenuStatus(menu.id, 'archived'))}
                disabled={busy === menu.id} aria-label={`Archiveer week ${menu.week_number}`} title="Archiveer"
                className="flex items-center justify-center w-9 h-9 text-faint hover:text-ink hover:bg-raised rounded-xl transition-colors disabled:opacity-50">
                <Archive size={15} />
              </button>
              <DeleteButton label={`Verwijder week ${menu.week_number}`}
                confirming={confirm === `menu-${menu.id}`}
                onAsk={() => setConfirm(`menu-${menu.id}`)}
                onCancel={() => setConfirm(null)}
                onConfirm={() => run(menu.id, async () => { await api.deleteMenu(menu.id); if (openId === menu.id) setOpenId(null); })}
                disabled={busy === menu.id} />
            </div>

            {openId === menu.id && (
              <ul className="px-4 pb-3 divide-y divide-line-soft">
                {days.map((day) => (
                  <li key={day.id} className="flex items-center gap-3 py-2">
                    <span className="w-20 shrink-0 text-[11px] font-bold uppercase tracking-wider text-accent">{formatShortDay(day)}</span>
                    <span className="flex-1 min-w-0 truncate text-sm">{day.recipe_name}</span>
                    <DeleteButton label={`Haal ${day.recipe_name} van het menu`}
                      confirming={confirm === `day-${day.id}`}
                      onAsk={() => setConfirm(`day-${day.id}`)}
                      onCancel={() => setConfirm(null)}
                      onConfirm={() => run(menu.id, async () => { await api.deleteDay(menu.id, day.id); await loadDays(menu.id); })}
                      disabled={busy === menu.id} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </section>
  );
}

const THEMES: Array<{ value: ThemeChoice; label: string; icon: typeof Sun }> = [
  { value: 'auto', label: 'Automatisch', icon: Monitor },
  { value: 'light', label: 'Licht', icon: Sun },
  { value: 'dark', label: 'Donker', icon: Moon },
];

function Settings() {
  const [theme, setTheme] = useTheme();
  const { user, logout } = useAuth();
  return (
    <section>
      <h2 className={`${sectionTitle} mb-3`}>Instellingen</h2>
      <div className={`${card} space-y-5`}>
        <div>
          <span id="theme-label" className="block text-sm font-bold mb-2">Weergave</span>
          <div role="radiogroup" aria-labelledby="theme-label" className="grid grid-cols-3 gap-1 p-1 bg-sunken rounded-2xl">
            {THEMES.map(({ value, label, icon: Icon }) => (
              <button key={value} role="radio" aria-checked={theme === value} onClick={() => setTheme(value)}
                className={`flex items-center justify-center gap-1.5 min-h-10 rounded-xl text-xs font-bold transition-colors
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                  theme === value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'
                }`}>
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 pt-4 border-t border-line-soft">
          <span className="text-sm text-muted truncate">{user?.email}</span>
          <Button variant="secondary" size="sm" onClick={logout}>
            <LogOut size={14} /> Uitloggen
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Older feedback per week, for a conversation outside the planning brief. */
function FeedbackExport() {
  const [text, setText] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'copied'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setState('loading');
    try {
      const data = await api.exportFeedback();
      setText(data.text);
      try {
        await navigator.clipboard.writeText(data.text);
        setState('copied');
      } catch {
        setState('idle');
      }
    } catch (err) {
      setError((err as Error).message);
      setState('idle');
    }
  }

  return (
    <details className={`${card} group`}>
      <summary className="flex items-center justify-between cursor-pointer list-none font-bold text-sm">
        Feedback per week kopiëren
        <ChevronDown size={16} className="text-faint transition-transform group-open:rotate-180" />
      </summary>
      <p className="text-xs text-muted mt-3 mb-3">
        De bibliotheek hierboven bevat de feedback al. Dit is het volledige overzicht per week, voor een los gesprek.
      </p>
      <Button variant="secondary" size="sm" onClick={load} disabled={state === 'loading'}>
        {state === 'copied' ? <Check size={14} /> : <ClipboardCopy size={14} />}
        {state === 'loading' ? 'Laden...' : state === 'copied' ? 'Gekopieerd' : 'Kopieer feedback'}
      </Button>
      {text && (
        <pre className="mt-3 p-4 bg-sunken rounded-2xl text-xs text-muted whitespace-pre-wrap break-words max-h-48 overflow-y-auto">{text}</pre>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </details>
  );
}

export default function Plannen() {
  const { menus, refresh } = useMenus();

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto pt-8 md:pt-12 pb-32 space-y-8">
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Plannen</h1>
      <PickerLink />
      <PlanSteps onImported={refresh} />
      <ActiveMenus menus={menus} refresh={refresh} />
      <Settings />
      <FeedbackExport />
    </div>
  );
}
