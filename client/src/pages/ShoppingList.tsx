import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api, Menu, ShoppingItem as ShoppingItemType, PantryItem as PantryItemType } from '../lib/api';
import ShoppingItemComponent from '../components/ShoppingItem';
import PantryCheck from '../components/PantryCheck';

const groupEmoji: Record<string, string> = {
  groenten: '🥬', fruit: '🍎', vis: '🐟', vlees: '🥩',
  zuivel: '🧀', droogwaren: '📦', kruiden: '🌿', diepvries: '❄️', brood: '🍞', overig: '🛒',
};

type Tab = 'list' | 'pantry';

export default function ShoppingList() {
  const [tab, setTab] = useState<Tab>('list');
  const [menus, setMenus] = useState<Menu[]>([]);
  const [weekIndex, setWeekIndex] = useState(0);
  const [grouped, setGrouped] = useState<Record<string, ShoppingItemType[]>>({});
  const [pantryItems, setPantryItems] = useState<PantryItemType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    api.getActiveMenus()
      .then((m) => setMenus(m))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

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
    if (currentMenu) {
      loadWeekData(currentMenu);
    } else {
      setGrouped({});
      setPantryItems([]);
    }
  }, [currentMenu, loadWeekData]);

  async function handleToggleItem(itemId: number, checked: boolean) {
    if (!currentMenu) return;
    await api.toggleShoppingItem(currentMenu.id, itemId, checked);
    setGrouped((prev) => {
      const next = { ...prev };
      for (const group of Object.keys(next)) {
        next[group] = next[group].map((item) =>
          item.id === itemId ? { ...item, checked: checked ? 1 : 0 } : item,
        );
      }
      return next;
    });
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

  const pantryNeeded = pantryItems.filter((i) => !i.have_it).length;

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto pt-8 md:pt-12 pb-32">
      {/* Header */}
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            Boodschappen
          </h1>
          {currentMenu && (
            <p className="text-muted text-base mt-1">Week {currentMenu.week_number}</p>
          )}
        </div>

        {menus.length > 1 && (
          <div className="flex items-center bg-white rounded-full px-2 py-2 shadow-[0_4px_20px_rgba(0,0,0,0.04)] border border-gray-100">
            <button
              onClick={() => setWeekIndex(weekIndex - 1)}
              disabled={weekIndex <= 0}
              className="p-2 hover:bg-gray-50 rounded-full transition-colors text-gray-400 disabled:opacity-25"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="font-bold text-sm px-3">{weekIndex + 1} / {menus.length}</span>
            <button
              onClick={() => setWeekIndex(weekIndex + 1)}
              disabled={weekIndex >= menus.length - 1}
              className="p-2 hover:bg-gray-50 rounded-full transition-colors text-gray-400 disabled:opacity-25"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </header>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab('list')}
          className={`flex-1 py-2.5 px-4 rounded-full text-sm font-bold transition-colors ${
            tab === 'list'
              ? 'bg-warmth-500 text-white shadow-[0_4px_15px_rgba(242,153,74,0.3)]'
              : 'bg-white text-muted shadow-[0_2px_10px_rgba(0,0,0,0.04)]'
          }`}
        >
          Boodschappenlijst
        </button>
        <button
          onClick={() => setTab('pantry')}
          className={`flex-1 py-2.5 px-4 rounded-full text-sm font-bold transition-colors relative ${
            tab === 'pantry'
              ? 'bg-warmth-500 text-white shadow-[0_4px_15px_rgba(242,153,74,0.3)]'
              : 'bg-white text-muted shadow-[0_2px_10px_rgba(0,0,0,0.04)]'
          }`}
        >
          Voorraadcheck
          {pantryNeeded > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
              {pantryNeeded}
            </span>
          )}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded-2xl mb-4 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-bold">x</button>
        </div>
      )}

      {tab === 'list' && (
        <div className="space-y-6">
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group}>
              <h3 className="font-bold text-xs tracking-[0.2em] text-accent mb-2 uppercase">
                {groupEmoji[group.toLowerCase()] || '🛒'} {group}
              </h3>
              <div className="bg-white rounded-3xl px-5 divide-y divide-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
                {items.map((item) => (
                  <ShoppingItemComponent
                    key={item.id}
                    item={item}
                    onToggle={(checked) => handleToggleItem(item.id, checked)}
                  />
                ))}
              </div>
            </div>
          ))}
          {Object.keys(grouped).length === 0 && (
            <p className="text-center text-muted py-8">Geen boodschappen gevonden.</p>
          )}
          {Object.keys(grouped).length > 0 && currentMenu && (
            <button
              onClick={async () => {
                setClearing(true);
                try {
                  await api.clearShopping(currentMenu.id);
                  setGrouped({});
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setClearing(false);
                }
              }}
              disabled={clearing}
              className="w-full mt-6 py-4 bg-warmth-500 text-white rounded-2xl font-bold text-lg shadow-[0_10px_30px_rgba(242,153,74,0.3)] hover:bg-warmth-600 transition-all disabled:opacity-50"
            >
              {clearing ? 'Bezig...' : 'Alle boodschappen zijn gedaan'}
            </button>
          )}
        </div>
      )}

      {tab === 'pantry' && (
        <div>
          <p className="text-sm text-muted mb-4">
            Wat moet er nog in huis zijn voor de resterende dagen?
          </p>
          <div className="bg-white rounded-3xl px-5 divide-y divide-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
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
