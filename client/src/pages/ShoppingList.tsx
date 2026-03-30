import { useState, useEffect, useCallback } from 'react';
import { api, Menu, ShoppingItem as ShoppingItemType, PantryItem as PantryItemType } from '../lib/api';
import ShoppingItemComponent from '../components/ShoppingItem';
import PantryCheck from '../components/PantryCheck';

const groupEmoji: Record<string, string> = {
  groenten: '🥬',
  fruit: '🍎',
  vis: '🐟',
  vlees: '🥩',
  zuivel: '🧀',
  droogwaren: '📦',
  kruiden: '🌿',
  diepvries: '❄️',
  brood: '🍞',
  overig: '🛒',
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

  if (error) {
    return (
      <div className="p-6 pt-12 text-center">
        <div className="text-4xl mb-4">🛒</div>
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  if (menus.length === 0) {
    return (
      <div className="p-6 pt-12 text-center">
        <div className="text-4xl mb-4">🛒</div>
        <p className="text-gray-500 dark:text-gray-400">Geen actief menu — geen boodschappenlijst.</p>
      </div>
    );
  }

  const pantryNeeded = pantryItems.filter((i) => !i.have_it).length;

  return (
    <div className="p-4 max-w-lg mx-auto pt-12">
      {/* Week navigation */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setWeekIndex(weekIndex - 1)}
          disabled={weekIndex <= 0}
          className="p-2 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-25 disabled:cursor-default"
          aria-label="Vorige week"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="text-center">
          <h1 className="text-xl font-bold text-forest-700 dark:text-forest-500">
            Boodschappen week {currentMenu?.week_number}
          </h1>
          {menus.length > 1 && (
            <p className="text-xs text-gray-400 mt-0.5">
              {weekIndex + 1} / {menus.length}
            </p>
          )}
        </div>
        <button
          onClick={() => setWeekIndex(weekIndex + 1)}
          disabled={weekIndex >= menus.length - 1}
          className="p-2 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-25 disabled:cursor-default"
          aria-label="Volgende week"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab('list')}
          className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
            tab === 'list'
              ? 'bg-forest-500 text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
          }`}
        >
          Boodschappenlijst
        </button>
        <button
          onClick={() => setTab('pantry')}
          className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors relative ${
            tab === 'pantry'
              ? 'bg-forest-500 text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
          }`}
        >
          Voorraadcheck
          {pantryNeeded > 0 && (
            <span className="absolute -top-1 -right-1 bg-warmth-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">
              {pantryNeeded}
            </span>
          )}
        </button>
      </div>

      {tab === 'list' && (
        <div className="space-y-6">
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group}>
              <h3 className="font-semibold text-sm text-gray-600 dark:text-gray-400 mb-2 uppercase tracking-wider">
                {groupEmoji[group.toLowerCase()] || '🛒'} {group}
              </h3>
              <div className="bg-white dark:bg-gray-800 rounded-xl px-4 divide-y divide-gray-100 dark:divide-gray-700">
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
            <p className="text-center text-gray-500 py-8">Geen boodschappen gevonden.</p>
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
              className="w-full mt-6 py-3 bg-forest-500 text-white rounded-xl font-semibold hover:bg-forest-600 transition-colors disabled:opacity-50"
            >
              {clearing ? 'Bezig...' : 'Alle boodschappen zijn gedaan'}
            </button>
          )}
        </div>
      )}

      {tab === 'pantry' && (
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Wat moet er nog in huis zijn voor de resterende dagen?
          </p>
          <div className="bg-white dark:bg-gray-800 rounded-xl px-4 divide-y divide-gray-100 dark:divide-gray-700">
            {pantryItems.map((item) => (
              <PantryCheck
                key={item.id}
                item={item}
                onToggle={(have_it) => handleTogglePantry(item.id, have_it)}
              />
            ))}
          </div>
          {pantryItems.length === 0 && (
            <p className="text-center text-gray-500 py-8">Geen voorraadcheck items.</p>
          )}
          {pantryItems.length > 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-4 text-center">
              {pantryNeeded} van {pantryItems.length} items nog nodig
            </p>
          )}
        </div>
      )}
    </div>
  );
}
