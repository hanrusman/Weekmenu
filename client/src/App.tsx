import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import FamilyView from './pages/FamilyView';
import RecipeDetail from './pages/RecipeDetail';
import AdminMenu from './pages/AdminMenu';
import ShoppingList from './pages/ShoppingList';
import RecipeLibrary from './pages/RecipeLibrary';
import ErrorBoundary from './components/ErrorBoundary';

function NavBar() {
  const location = useLocation();
  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + '/');

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 z-50 safe-area-bottom">
      <div className="flex justify-around items-center h-16 max-w-lg mx-auto">
        <Link
          to="/"
          className={`flex flex-col items-center gap-0.5 text-xs ${
            isActive('/') && !isActive('/admin') && !isActive('/boodschappen') && !isActive('/recepten')
              ? 'text-forest-600 dark:text-forest-500'
              : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          <span className="text-xl">🍽️</span>
          <span>Menu</span>
        </Link>
        <Link
          to="/boodschappen"
          className={`flex flex-col items-center gap-0.5 text-xs ${
            isActive('/boodschappen')
              ? 'text-forest-600 dark:text-forest-500'
              : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          <span className="text-xl">🛒</span>
          <span>Boodschappen</span>
        </Link>
        <Link
          to="/recepten"
          className={`flex flex-col items-center gap-0.5 text-xs ${
            isActive('/recepten')
              ? 'text-forest-600 dark:text-forest-500'
              : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          <span className="text-xl">📖</span>
          <span>Recepten</span>
        </Link>
        <Link
          to="/admin"
          className={`flex flex-col items-center gap-0.5 text-xs ${
            isActive('/admin')
              ? 'text-forest-600 dark:text-forest-500'
              : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          <span className="text-xl">⚙️</span>
          <span>Admin</span>
        </Link>
      </div>
    </nav>
  );
}

function DarkModeToggle() {
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('darkMode') === 'true' ||
      (!localStorage.getItem('darkMode') && window.matchMedia('(prefers-color-scheme: dark)').matches);
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('darkMode', String(dark));
  }, [dark]);

  return (
    <button
      onClick={() => setDark(!dark)}
      className="fixed top-3 right-3 z-50 p-2 rounded-full bg-white dark:bg-gray-700 shadow-md text-sm"
      aria-label="Toggle dark mode"
    >
      {dark ? '☀️' : '🌙'}
    </button>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <div className="min-h-screen pb-20">
          <DarkModeToggle />
          <Routes>
            <Route path="/" element={<FamilyView />} />
            <Route path="/dag/:dayId" element={<RecipeDetail />} />
            <Route path="/admin" element={<AdminMenu />} />
            <Route path="/boodschappen" element={<ShoppingList />} />
            <Route path="/recepten" element={<RecipeLibrary />} />
          </Routes>
          <NavBar />
        </div>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
