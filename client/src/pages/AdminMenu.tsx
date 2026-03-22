import { useState, useCallback, useEffect } from 'react';
import { api, Menu, MenuDay, setAdminPin, getAdminPin } from '../lib/api';
import { useMenus } from '../hooks/useMenu';
import DayCard from '../components/DayCard';
import StatusBadge from '../components/StatusBadge';

const EXAMPLE_JSON = `{
  "days": [
    {
      "day_name": "Donderdag",
      "recipe_name": "Pasta pesto met courgette",
      "meal_type": "pasta",
      "prep_time_minutes": 20,
      "cost_index": "€",
      "recipe": {
        "ingredients": [
          {"name": "pasta", "amount": "400", "unit": "g", "product_group": "droogwaren"},
          {"name": "courgette", "amount": "2", "unit": "stuks", "product_group": "groenten"}
        ],
        "steps": ["Kook de pasta", "Bak de courgette"],
        "nutrition_per_serving": {"calories": 450, "protein_g": 18, "fiber_g": 6, "iron_mg": 2.5}
      }
    }
  ],
  "shopping_list": [
    {
      "product_group": "groenten",
      "items": [
        {"name": "courgette", "quantity": "2 stuks", "for_days": ["Donderdag"], "is_perishable": true, "storage_tip": "In de koelkast"}
      ]
    }
  ],
  "snack_suggestions": ["Appel met pindakaas"]
}`;

export default function AdminMenu() {
  const { menus, refresh: refreshMenus } = useMenus();
  const [selectedMenu, setSelectedMenu] = useState<(Menu & { days: MenuDay[] }) | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jsonInput, setJsonInput] = useState('');
  const [weekNumber, setWeekNumber] = useState('');
  const [yearInput, setYearInput] = useState('');
  const [pin, setPin] = useState(() => getAdminPin() || '');
  const [pinSaved, setPinSaved] = useState(!!getAdminPin());
  const [showExample, setShowExample] = useState(false);
  const [feedbackText, setFeedbackText] = useState<string | null>(null);
  const [loadingFeedback, setLoadingFeedback] = useState(false);
  const [targetWeek, setTargetWeek] = useState<{ weekNumber: number; year: number } | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  useEffect(() => {
    if (pin) {
      setAdminPin(pin);
      setPinSaved(true);
    }
  }, [pin]);

  // Load target week on mount
  useEffect(() => {
    api.getTargetWeek().then(setTargetWeek).catch(() => {});
  }, []);

  const loadMenu = useCallback(async (id: number) => {
    try {
      const data = await api.getMenu(id);
      setSelectedMenu(data);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  async function handleImport() {
    if (!jsonInput.trim()) {
      setError('Plak eerst de menu JSON');
      return;
    }

    setImporting(true);
    setError(null);
    try {
      let menuData: unknown;
      try {
        menuData = JSON.parse(jsonInput);
      } catch {
        setError('Ongeldige JSON — controleer het format');
        setImporting(false);
        return;
      }

      const data = await api.importMenu({
        menu: menuData,
        weekNumber: weekNumber ? parseInt(weekNumber) : undefined,
        year: yearInput ? parseInt(yearInput) : undefined,
      });
      setSelectedMenu(data);
      setJsonInput('');
      refreshMenus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  async function handleDelete(id: number) {
    setDeleting(id);
    try {
      await api.deleteMenu(id);
      if (selectedMenu?.id === id) setSelectedMenu(null);
      refreshMenus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(null);
    }
  }

  async function handleDeleteDay(dayId: number) {
    if (!selectedMenu) return;
    try {
      await api.deleteDay(selectedMenu.id, dayId);
      await loadMenu(selectedMenu.id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleExportFeedback() {
    setLoadingFeedback(true);
    try {
      const data = await api.exportFeedback();
      setFeedbackText(data.text);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingFeedback(false);
    }
  }

  async function copyFeedback() {
    if (feedbackText) {
      await navigator.clipboard.writeText(feedbackText);
    }
  }

  const displayWeek = weekNumber ? parseInt(weekNumber) : targetWeek?.weekNumber;
  const displayYear = yearInput ? parseInt(yearInput) : targetWeek?.year;

  return (
    <div className="p-4 max-w-2xl mx-auto pt-12">
      <h1 className="text-2xl font-bold text-forest-700 dark:text-forest-500 mb-6">
        Menu Beheer
      </h1>

      {/* Admin PIN */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm mb-4">
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
          Admin PIN
        </label>
        <div className="flex gap-2">
          <input
            type="password"
            value={pin}
            onChange={(e) => { setPin(e.target.value); setPinSaved(false); }}
            onBlur={() => { setAdminPin(pin); setPinSaved(true); }}
            placeholder="PIN invoeren..."
            className="flex-1 p-2 border rounded-lg text-sm bg-cream-50 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200"
          />
          {pinSaved && pin && (
            <span className="self-center text-xs text-green-600 dark:text-green-400">Opgeslagen</span>
          )}
        </div>
      </div>

      {/* Import section */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-700 dark:text-gray-300">Menu importeren</h2>
          <button
            onClick={() => setShowExample(!showExample)}
            className="text-xs text-forest-600 dark:text-forest-400 hover:underline"
          >
            {showExample ? 'Verberg voorbeeld' : 'Toon voorbeeld'}
          </button>
        </div>

        {showExample && (
          <div className="mb-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <pre className="text-xs text-gray-600 dark:text-gray-300 overflow-x-auto whitespace-pre-wrap break-words">{EXAMPLE_JSON}</pre>
            <button
              onClick={() => setJsonInput(EXAMPLE_JSON)}
              className="mt-2 text-xs text-forest-600 dark:text-forest-400 hover:underline"
            >
              Gebruik dit voorbeeld
            </button>
          </div>
        )}

        <div className="flex gap-2 mb-3">
          <div className="flex-1">
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Week</label>
            <input
              type="number"
              value={weekNumber}
              onChange={(e) => setWeekNumber(e.target.value)}
              placeholder={targetWeek ? String(targetWeek.weekNumber) : 'Auto'}
              min={1} max={53}
              className="w-full p-2 border rounded-lg text-sm bg-cream-50 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Jaar</label>
            <input
              type="number"
              value={yearInput}
              onChange={(e) => setYearInput(e.target.value)}
              placeholder={targetWeek ? String(targetWeek.year) : 'Auto'}
              min={2020} max={2100}
              className="w-full p-2 border rounded-lg text-sm bg-cream-50 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200"
            />
          </div>
        </div>

        {displayWeek && displayYear && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Menu wordt opgeslagen als week {displayWeek}, {displayYear}. Direct actief na import.
          </p>
        )}

        <textarea
          value={jsonInput}
          onChange={(e) => setJsonInput(e.target.value)}
          placeholder="Plak hier de menu JSON uit je Claude-gesprek..."
          className="w-full p-3 border rounded-lg text-sm bg-cream-50 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 mb-3 resize-none font-mono"
          rows={8}
        />
        <button
          onClick={handleImport}
          disabled={importing || !jsonInput.trim()}
          className="w-full py-3 bg-forest-500 text-white rounded-xl font-semibold hover:bg-forest-600 transition-colors disabled:opacity-50"
        >
          {importing ? 'Importeren...' : 'Importeer weekmenu'}
        </button>
      </div>

      {/* Feedback export */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm mb-6">
        <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-3">Feedback exporteren</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Kopieer feedback om in je volgende Claude-gesprek te plakken.
        </p>
        <button
          onClick={handleExportFeedback}
          disabled={loadingFeedback}
          className="w-full py-2 bg-warmth-500 text-white rounded-lg font-medium hover:bg-warmth-600 transition-colors disabled:opacity-50 mb-3"
        >
          {loadingFeedback ? 'Laden...' : 'Laad feedback'}
        </button>

        {feedbackText && (
          <div className="relative">
            <pre className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg text-xs text-gray-600 dark:text-gray-300 overflow-x-auto whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
              {feedbackText}
            </pre>
            <button
              onClick={copyFeedback}
              className="absolute top-2 right-2 px-2 py-1 bg-forest-500 text-white rounded text-xs hover:bg-forest-600"
            >
              Kopieer
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 p-3 rounded-xl mb-4 text-sm">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 text-red-500 hover:text-red-700 font-bold"
            aria-label="Sluit foutmelding"
          >
            x
          </button>
        </div>
      )}

      {/* Selected menu detail */}
      {selectedMenu && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">
                Week {selectedMenu.week_number} — {selectedMenu.year}
              </h2>
              <StatusBadge status={selectedMenu.status} />
            </div>
            <button
              onClick={() => handleDelete(selectedMenu.id)}
              disabled={deleting === selectedMenu.id}
              className="py-2 px-4 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
            >
              {deleting === selectedMenu.id ? 'Verwijderen...' : 'Verwijder'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {selectedMenu.days?.map((day: MenuDay) => (
              <DayCard
                key={day.id}
                day={day}
                onDelete={() => handleDeleteDay(day.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Menu history */}
      {menus.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3 text-gray-700 dark:text-gray-300">
            Menu's
          </h2>
          <div className="space-y-2">
            {menus.map((menu) => (
              <div
                key={menu.id}
                className={`w-full p-3 rounded-lg transition-colors ${
                  selectedMenu?.id === menu.id
                    ? 'bg-forest-100 dark:bg-forest-800 ring-1 ring-forest-500'
                    : 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                <div className="flex justify-between items-center">
                  <button
                    onClick={() => loadMenu(menu.id)}
                    className="flex-1 text-left"
                  >
                    <span className="font-medium">
                      Week {menu.week_number} — {menu.year}
                    </span>
                  </button>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={menu.status} />
                    <button
                      onClick={() => handleDelete(menu.id)}
                      disabled={deleting === menu.id}
                      className="text-red-400 hover:text-red-600 text-sm px-1 disabled:opacity-50"
                      aria-label="Verwijder menu"
                    >
                      {deleting === menu.id ? '...' : 'x'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
