import { useState, useCallback, useEffect } from 'react';
import { api, Menu, MenuDay, setAdminPin, getAdminPin, formatDayLabel } from '../lib/api';
import { useMenus } from '../hooks/useMenu';
import StatusBadge from '../components/StatusBadge';
import { Clock, Trash2 } from 'lucide-react';

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
    if (pin) { setAdminPin(pin); setPinSaved(true); }
  }, [pin]);

  useEffect(() => {
    api.getTargetWeek().then(setTargetWeek).catch(() => {});
  }, []);

  const loadMenu = useCallback(async (id: number) => {
    try {
      setSelectedMenu(await api.getMenu(id));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  async function handleImport() {
    if (!jsonInput.trim()) { setError('Plak eerst de menu JSON'); return; }
    setImporting(true);
    setError(null);
    try {
      let menuData: unknown;
      try { menuData = JSON.parse(jsonInput); } catch {
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
    if (feedbackText) await navigator.clipboard.writeText(feedbackText);
  }

  const displayWeek = weekNumber ? parseInt(weekNumber) : targetWeek?.weekNumber;
  const displayYear = yearInput ? parseInt(yearInput) : targetWeek?.year;

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pt-8 md:pt-12 pb-32">
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-8">Menu Beheer</h1>

      {/* Admin PIN */}
      <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] mb-6">
        <label className="block text-xs font-bold tracking-wide text-accent mb-2 uppercase">Admin PIN</label>
        <div className="flex gap-2">
          <input
            type="password"
            value={pin}
            onChange={(e) => { setPin(e.target.value); setPinSaved(false); }}
            onBlur={() => { setAdminPin(pin); setPinSaved(true); }}
            placeholder="PIN invoeren..."
            className="flex-1 p-3 border border-gray-200 rounded-2xl text-sm bg-cream-50 focus:outline-none focus:ring-2 focus:ring-warmth-400"
          />
          {pinSaved && pin && <span className="self-center text-xs text-green-500 font-medium">Opgeslagen</span>}
        </div>
      </div>

      {/* Import section */}
      <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-sm tracking-wide text-accent uppercase">Menu importeren</h2>
          <button onClick={() => setShowExample(!showExample)} className="text-xs text-warmth-500 hover:underline font-medium">
            {showExample ? 'Verberg voorbeeld' : 'Toon voorbeeld'}
          </button>
        </div>

        {showExample && (
          <div className="mb-4 p-4 bg-cream-50 rounded-2xl">
            <pre className="text-xs text-muted overflow-x-auto whitespace-pre-wrap break-words">{EXAMPLE_JSON}</pre>
            <button onClick={() => setJsonInput(EXAMPLE_JSON)} className="mt-2 text-xs text-warmth-500 hover:underline font-medium">
              Gebruik dit voorbeeld
            </button>
          </div>
        )}

        <div className="flex gap-3 mb-4">
          <div className="flex-1">
            <label className="block text-xs text-muted mb-1">Week</label>
            <input type="number" value={weekNumber} onChange={(e) => setWeekNumber(e.target.value)}
              placeholder={targetWeek ? String(targetWeek.weekNumber) : 'Auto'}
              className="w-full p-3 border border-gray-200 rounded-2xl text-sm bg-cream-50 focus:outline-none focus:ring-2 focus:ring-warmth-400" />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-muted mb-1">Jaar</label>
            <input type="number" value={yearInput} onChange={(e) => setYearInput(e.target.value)}
              placeholder={targetWeek ? String(targetWeek.year) : 'Auto'}
              className="w-full p-3 border border-gray-200 rounded-2xl text-sm bg-cream-50 focus:outline-none focus:ring-2 focus:ring-warmth-400" />
          </div>
        </div>

        {displayWeek && displayYear && (
          <p className="text-xs text-muted mb-3">
            Menu wordt opgeslagen als week {displayWeek}, {displayYear}. Direct actief na import.
          </p>
        )}

        <textarea value={jsonInput} onChange={(e) => setJsonInput(e.target.value)}
          placeholder="Plak hier de menu JSON uit je Claude-gesprek..."
          className="w-full p-4 border border-gray-200 rounded-2xl text-sm bg-cream-50 mb-4 resize-none font-mono focus:outline-none focus:ring-2 focus:ring-warmth-400"
          rows={8} />

        <button onClick={handleImport} disabled={importing || !jsonInput.trim()}
          className="w-full py-4 bg-warmth-500 text-white rounded-2xl font-bold text-lg shadow-[0_10px_30px_rgba(242,153,74,0.3)] hover:bg-warmth-600 transition-all disabled:opacity-50">
          {importing ? 'Importeren...' : 'Importeer weekmenu'}
        </button>
      </div>

      {/* Feedback export */}
      <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] mb-6">
        <h2 className="font-bold text-sm tracking-wide text-accent mb-3 uppercase">Feedback exporteren</h2>
        <p className="text-xs text-muted mb-3">Kopieer feedback om in je volgende Claude-gesprek te plakken.</p>
        <button onClick={handleExportFeedback} disabled={loadingFeedback}
          className="w-full py-3 bg-white border-2 border-warmth-500 text-warmth-500 rounded-2xl font-bold hover:bg-warmth-500 hover:text-white transition-all disabled:opacity-50 mb-3">
          {loadingFeedback ? 'Laden...' : 'Laad feedback'}
        </button>
        {feedbackText && (
          <div className="relative">
            <pre className="p-4 bg-cream-50 rounded-2xl text-xs text-muted overflow-x-auto whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
              {feedbackText}
            </pre>
            <button onClick={copyFeedback}
              className="absolute top-2 right-2 px-3 py-1.5 bg-warmth-500 text-white rounded-xl text-xs font-bold hover:bg-warmth-600">
              Kopieer
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-2xl mb-6 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-bold">x</button>
        </div>
      )}

      {/* Selected menu detail */}
      {selectedMenu && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold">Week {selectedMenu.week_number} — {selectedMenu.year}</h2>
              <StatusBadge status={selectedMenu.status} />
            </div>
            <button onClick={() => handleDelete(selectedMenu.id)} disabled={deleting === selectedMenu.id}
              className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors disabled:opacity-50">
              <Trash2 size={18} />
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {selectedMenu.days?.map((day: MenuDay) => (
              <div key={day.id} className="bg-white rounded-3xl p-5 text-center shadow-[0_4px_20px_rgba(0,0,0,0.03)] relative">
                <button onClick={() => handleDeleteDay(day.id)}
                  className="absolute top-3 right-4 text-gray-300 hover:text-red-400 text-sm">x</button>
                <span className="block text-[10px] font-bold tracking-[0.2em] text-accent mb-2 uppercase">
                  {formatDayLabel(day)}
                </span>
                <h3 className="font-bold text-sm mb-1">{day.recipe_name}</h3>
                <div className="flex items-center justify-center gap-1 text-xs text-muted">
                  <Clock size={12} />
                  <span>{day.prep_time_minutes}m</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Menu history */}
      {menus.length > 0 && (
        <div>
          <h2 className="font-bold text-sm tracking-wide text-accent mb-3 uppercase">Menu's</h2>
          <div className="space-y-2">
            {menus.map((menu) => (
              <div key={menu.id}
                className={`flex items-center justify-between p-4 rounded-2xl transition-colors cursor-pointer ${
                  selectedMenu?.id === menu.id
                    ? 'bg-warmth-400/20 ring-1 ring-warmth-500'
                    : 'bg-white shadow-[0_2px_10px_rgba(0,0,0,0.03)] hover:shadow-md'
                }`}
                onClick={() => loadMenu(menu.id)}>
                <span className="font-bold text-sm">Week {menu.week_number} — {menu.year}</span>
                <div className="flex items-center gap-2">
                  <StatusBadge status={menu.status} />
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(menu.id); }}
                    disabled={deleting === menu.id}
                    className="p-1 text-gray-300 hover:text-red-400 disabled:opacity-50">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
