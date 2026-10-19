import { Link } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { CheckCheck, RefreshCw, ShoppingCart, Undo2 } from 'lucide-react';
import { api, Menu, ShoppingItem as ShoppingItemType, PantryItem as PantryItemType, todayStr } from '../lib/api';
import ShoppingItemComponent from '../components/ShoppingItem';
import PantryCheck from '../components/PantryCheck';
import WeekSwitcher from '../components/WeekSwitcher';
import Button from '../components/Button';

const groupEmoji: Record<string, string> = {
  groenten: '🥬', fruit: '🍎', vis: '🐟', vlees: '🥩',
  zuivel: '🧀', droogwaren: '📦', kruiden: '🌿', diepvries: '❄️', brood: '🍞', overig: '🛒',
};

type Tab = 'list' | 'pantry';
type Grouped = Record<string, ShoppingItemType[]>;

function whenOf(menu: Menu, today: string): 'past' | 'current' | 'future' {
  if (!menu.first_date || !menu.last_date) return 'current';
  if (menu.last_date < today) return 'past';
  return menu.first_date > today ? 'future' : 'current';
}

export default function ShoppingList() {
  const [tab, setTab] = useState<Tab>('list');
  const [menus, setMenus] = useState<Menu[]>([]);
  const [weekIndex, setWeekIndex] = useState(0);
  const [homeIndex, setHomeIndex] = useState(0);
  const [grouped, setGrouped] = useState<Grouped>({});
  const [pantryItems, setPantryItems] = useState<PantryItemType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkingAll, setCheckingAll] = useState(false);
  // Items "Alles afvinken" just ticked, so it can be undone
  const [undoIds, setUndoIds] = useState<number[] | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const today = todayStr();

  useEffect(() => {
    api.getActiveMenus()
      .then((m) => {
        setMenus(m);
        // Start at the week that is running or coming up, not at the oldest
        const current = m.findIndex((menu) => (menu.last_date ?? today) >= today);
        const home = current >= 0 ? current : Math.max(0, m.length - 1);
        setHomeIndex(home);
        setWeekIndex(home);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [today]);

  const currentMenu = menus[weekIndex];

  const loadWeekData = useCallback(async (menu: Menu) => {
    try {
      const [shopping, pantry] = await Promise.all([
        api.getShopping(menu.id),
        api.getPantry(menu.id),
      ]);
      setGrouped(shopping.grouped);
      setPantryItems(pantry);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    setUndoIds(null);
    if (currentMenu) {
      loadWeekData(currentMenu);
    } else {
      setGrouped({});
      setPantryItems([]);
    }
  }, [currentMenu, loadWeekData]);

  function setChecked(ids: number[], checked: boolean) {
    setGrouped((prev) => {
      const next: Grouped = {};
      for (const [group, items] of Object.entries(prev)) {
        next[group] = items.map((item) => (ids.includes(item.id) ? { ...item, checked: checked ? 1 : 0 } : item));
      }
      return next;
    });
  }

  async function handleToggleItem(itemId: number, checked: boolean) {
    if (!currentMenu) return;
    setUndoIds(null);
    setChecked([itemId], checked);
    try {
      await api.toggleShoppingItem(currentMenu.id, itemId, checked);
    } catch (err) {
      setChecked([itemId], !checked);
      setError((err as Error).message);
    }
  }

  async function handleCheckAll() {
    if (!currentMenu) return;
    const open = Object.values(grouped).flat().filter((i) => !i.checked).map((i) => i.id);
    setCheckingAll(true);
    setError(null);
    try {
      const shopping = await api.checkAllShopping(currentMenu.id, true);
      setGrouped(shopping.grouped);
      setUndoIds(open);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCheckingAll(false);
    }
  }

  async function handleUndo() {
    if (!currentMenu || !undoIds) return;
    const ids = undoIds;
    setUndoIds(null);
    setChecked(ids, false);
    try {
      await Promise.all(ids.map((id) => api.toggleShoppingItem(currentMenu.id, id, false)));
    } catch (err) {
      setError((err as Error).message);
      loadWeekData(currentMenu);
    }
  }

  async function handleRegenerate() {
    if (!currentMenu) return;
    setRegenerating(true);
    setError(null);
    setUndoIds(null);
    try {
      const shopping = await api.regenerateShopping(currentMenu.id);
      setGrouped(shopping.grouped);
      setPantryItems(await api.getPantry(currentMenu.id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRegenerating(false);
    }
  }

  async function handleTogglePantry(itemId: number, have_it: boolean) {
    if (!currentMenu) return;
    await api.togglePantryItem(currentMenu.id, itemId, have_it);
    setPantryItems((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, have_it: have_it ? 1 : 0 } : item)),
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-4xl animate-cook">🛒</div>
      </div>
    );
  }

  if (menus.length === 0) {
    return (
      <div className="p-6 max-w-2xl mx-auto pt-16 text-center">
        <div className="text-5xl mb-4">🛒</div>
        <p className="text-muted">Geen actief menu — geen boodschappenlijst.</p>
      </div>
    );
  }

  const allItems = Object.values(grouped).flat();
  const checkedCount = allItems.filter((i) => i.checked).length;
  const allChecked = allItems.length > 0 && checkedCount === allItems.length;
  const pantryNeeded = pantryItems.filter((i) => !i.have_it).length;

  const tabClass = (active: boolean) => `flex-1 min-h-11 px-4 rounded-full text-sm font-bold transition-colors relative
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
    active ? 'bg-brand text-on-brand shadow-[0_4px_15px_rgba(179,87,15,0.25)]' : 'bg-surface text-muted hover:text-ink border border-line-soft'
  }`;

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto pt-8 md:pt-12 pb-32">
      <header className="mb-6">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">Boodschappen</h1>
        {currentMenu && (
          <WeekSwitcher
            weekNumber={currentMenu.week_number}
            firstDate={currentMenu.first_date}
            lastDate={currentMenu.last_date}
            when={whenOf(currentMenu, today)}
            canPrev={weekIndex > 0}
            canNext={weekIndex < menus.length - 1}
            onPrev={() => setWeekIndex(weekIndex - 1)}
            onNext={() => setWeekIndex(weekIndex + 1)}
            onToday={weekIndex !== homeIndex ? () => setWeekIndex(homeIndex) : undefined}
          />
        )}
      </header>

      <div className="flex gap-2 mb-6" role="tablist">
        <button role="tab" aria-selected={tab === 'list'} onClick={() => setTab('list')} className={tabClass(tab === 'list')}>
          Boodschappenlijst
        </button>
        <button role="tab" aria-selected={tab === 'pantry'} onClick={() => setTab('pantry')} className={tabClass(tab === 'pantry')}>
          Voorraadcheck
          {pantryNeeded > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
              {pantryNeeded}
            </span>
          )}
        </button>
      </div>

      {error && (
        <div className="bg-danger-soft text-danger p-3 rounded-2xl mb-4 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-bold">x</button>
        </div>
      )}

      {tab === 'list' && (
        <div className="space-y-6">
          {allItems.length > 0 && (
            <div>
              <div className="flex justify-between items-baseline text-sm mb-2">
                <span className="font-bold">{checkedCount} van {allItems.length} in de kar</span>
                {allChecked && <span className="text-success font-bold text-xs">Klaar!</span>}
              </div>
              <div className="h-2 rounded-full bg-line overflow-hidden" role="progressbar"
                aria-valuemin={0} aria-valuemax={allItems.length} aria-valuenow={checkedCount}>
                <div className="h-full bg-brand transition-all duration-300"
                  style={{ width: `${(checkedCount / allItems.length) * 100}%` }} />
              </div>
            </div>
          )}

          {Object.entries(grouped).map(([group, items]) => (
            <div key={group}>
              <h3 className="font-bold text-xs tracking-[0.2em] text-accent mb-2 uppercase">
                {groupEmoji[group.toLowerCase()] || '🛒'} {group}
              </h3>
              <div className="bg-surface rounded-3xl px-5 divide-y divide-line-soft shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
                {/* Still to get first; ticked off sinks to the bottom */}
                {[...items].sort((a, b) => a.checked - b.checked).map((item) => (
                  <ShoppingItemComponent
                    key={item.id}
                    item={item}
                    onToggle={(checked) => handleToggleItem(item.id, checked)}
                  />
                ))}
              </div>
            </div>
          ))}
          {allItems.length === 0 && (
            <p className="text-center text-muted py-8">Geen boodschappen gevonden.</p>
          )}

          {currentMenu && allItems.length > 0 && !allChecked && (
            <div className="space-y-3" aria-label="Boodschappen naar de supermarkt">
            <Link to={`/boodschappen/picnic/${currentMenu.id}`}
              className="flex items-center justify-center gap-2 min-h-14 px-6 rounded-2xl font-bold bg-brand text-on-brand
                shadow-[0_8px_24px_rgba(179,87,15,0.25)] hover:bg-brand-hover transition-all active:scale-[0.98]
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-canvas">
              <ShoppingCart size={18} /> Voeg toe aan boodschappenmand bij Picnic
            </Link>
            <Link to={`/boodschappen/albert-heijn/${currentMenu.id}`}
              className="flex items-center justify-center gap-2 min-h-14 px-6 py-3 rounded-2xl font-bold text-center bg-surface text-brand border border-line
                hover:bg-raised transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-canvas">
              <ShoppingCart size={18} className="shrink-0" /> Voeg toe aan boodschappenlijst bij Albert Heijn
            </Link>
            </div>
          )}

          {undoIds ? (
            <div className="flex items-center justify-between gap-3 bg-surface border border-line-soft rounded-2xl p-3 pl-5">
              <span className="text-sm font-medium">{undoIds.length} {undoIds.length === 1 ? 'item' : 'items'} afgevinkt</span>
              <Button variant="ghost" size="sm" onClick={handleUndo}>
                <Undo2 size={14} /> Ongedaan maken
              </Button>
            </div>
          ) : allItems.length > 0 && !allChecked && (
            <Button variant="secondary" block size="lg" onClick={handleCheckAll} disabled={checkingAll || !currentMenu}>
              <CheckCheck size={18} />
              {checkingAll ? 'Bezig...' : 'Alles afvinken'}
            </Button>
          )}

          <div className="flex justify-between items-center gap-4 pt-2">
            <Link to="/ingredienten" className="text-xs font-bold text-muted hover:text-ink transition-colors">
              Klopt er iets niet? Ingrediënten beheren
            </Link>
            <button
              onClick={handleRegenerate}
              disabled={regenerating || !currentMenu}
              className="flex items-center gap-1.5 text-xs font-bold text-brand hover:text-brand-hover disabled:opacity-50 transition-colors"
            >
              <RefreshCw size={13} className={regenerating ? 'animate-spin' : ''} />
              {regenerating ? 'Berekenen...' : 'Vernieuw lijst uit recepten'}
            </button>
          </div>
        </div>
      )}

      {tab === 'pantry' && (
        <div>
          <p className="text-sm text-muted mb-4">
            Wat moet er nog in huis zijn voor de resterende dagen?
          </p>
          <div className="bg-surface rounded-3xl px-5 divide-y divide-line-soft shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            {pantryItems.map((item) => (
              <PantryCheck
                key={item.id}
                item={item}
                onToggle={(have_it) => handleTogglePantry(item.id, have_it)}
              />
            ))}
          </div>
          {pantryItems.length === 0 && (
            <p className="text-center text-muted py-8">Geen voorraadcheck items.</p>
          )}
          {pantryItems.length > 0 && (
            <p className="text-sm text-muted mt-4 text-center">
              {pantryNeeded} van {pantryItems.length} items nog nodig
            </p>
          )}
        </div>
      )}
    </div>
  );
}
