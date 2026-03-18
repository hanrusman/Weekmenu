import { useState, useCallback } from 'react';
import { api, Menu, MenuDay } from '../lib/api';
import { useMenus } from '../hooks/useMenu';
import DayCard from '../components/DayCard';
import StatusBadge from '../components/StatusBadge';

export default function AdminMenu() {
  const { menus, refresh: refreshMenus } = useMenus();
  const [activeMenu, setActiveMenu] = useState<(Menu & { days: MenuDay[] }) | null>(null);
  const [generating, setGenerating] = useState(false);
  const [regeneratingDay, setRegeneratingDay] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState('');

  const loadMenu = useCallback(async (id: number) => {
    const data = await api.getMenu(id);
    setActiveMenu(data);
  }, []);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const data = await api.generateMenu(
        preferences ? { preferences } : undefined,
      );
      setActiveMenu(data);
      refreshMenus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleApprove(dayId: number) {
    if (!activeMenu) return;
    await api.approveDay(activeMenu.id, dayId);
    await loadMenu(activeMenu.id);
  }

  async function handleRegenerate(dayId: number) {
    if (!activeMenu) return;
    setRegeneratingDay(dayId);
    try {
      await api.regenerateDay(activeMenu.id, dayId);
      await loadMenu(activeMenu.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRegeneratingDay(null);
    }
  }

  async function handleActivate() {
    if (!activeMenu) return;
    await api.updateMenuStatus(activeMenu.id, 'active');
    await loadMenu(activeMenu.id);
    refreshMenus();
  }

  const allApproved = activeMenu?.days?.every(
    (d: MenuDay) => d.status === 'approved' || d.status === 'completed'
  );

  return (
    <div className="p-4 max-w-2xl mx-auto pt-12">
      <h1 className="text-2xl font-bold text-forest-700 dark:text-forest-500 mb-6">
        Menu Planner
      </h1>

      {/* Generate section */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm mb-6">
        <textarea
          value={preferences}
          onChange={(e) => setPreferences(e.target.value)}
          placeholder="Voorkeuren deze week? (optioneel, bijv. 'geen vis', 'Mexicaans thema')"
          className="w-full p-3 border rounded-lg text-sm bg-cream-50 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 mb-3 resize-none"
          rows={2}
        />
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="w-full py-3 bg-forest-500 text-white rounded-xl font-semibold hover:bg-forest-600 transition-colors disabled:opacity-50"
        >
          {generating ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-cook inline-block">🧑‍🍳</span>
              Claude is aan het koken...
            </span>
          ) : (
            '↻ Genereer weekmenu'
          )}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 p-3 rounded-xl mb-4 text-sm">
          {error}
        </div>
      )}

      {/* Current menu */}
      {activeMenu && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">
                Week {activeMenu.week_number} — {activeMenu.year}
              </h2>
              <StatusBadge status={activeMenu.status} />
            </div>
            {activeMenu.status === 'draft' && allApproved && (
              <button
                onClick={handleActivate}
                className="py-2 px-4 bg-warmth-500 text-white rounded-lg font-medium hover:bg-warmth-600 transition-colors"
              >
                Activeer menu
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {activeMenu.days?.map((day: MenuDay) => (
              <DayCard
                key={day.id}
                day={day}
                showActions={activeMenu.status === 'draft'}
                onApprove={() => handleApprove(day.id)}
                onRegenerate={() => handleRegenerate(day.id)}
                regenerating={regeneratingDay === day.id}
              />
            ))}
          </div>
        </div>
      )}

      {/* Menu history */}
      {menus.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3 text-gray-700 dark:text-gray-300">
            Eerdere menu's
          </h2>
          <div className="space-y-2">
            {menus.map((menu) => (
              <button
                key={menu.id}
                onClick={() => loadMenu(menu.id)}
                className={`w-full text-left p-3 rounded-lg transition-colors ${
                  activeMenu?.id === menu.id
                    ? 'bg-forest-100 dark:bg-forest-800 ring-1 ring-forest-500'
                    : 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                <div className="flex justify-between items-center">
                  <span className="font-medium">
                    Week {menu.week_number} — {menu.year}
                  </span>
                  <StatusBadge status={menu.status} />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
