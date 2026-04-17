import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Sun, Moon, LogOut } from 'lucide-react';
import FamilyView from './pages/FamilyView';
import RecipeDetail from './pages/RecipeDetail';
import AdminMenu from './pages/AdminMenu';
import ShoppingList from './pages/ShoppingList';
import RecipeLibrary from './pages/RecipeLibrary';
import Login from './pages/Login';
import ErrorBoundary from './components/ErrorBoundary';
import { AuthProvider, useAuth } from './lib/auth';

const navItems = [
  { path: '/', emoji: '🍽️', label: 'Menu' },
  { path: '/boodschappen', emoji: '🛒', label: 'Boodschappen' },
  { path: '/recepten', emoji: '📖', label: 'Recepten' },
  { path: '/admin', emoji: '⚙️', label: 'Admin' },
];

function NavBar() {
  const location = useLocation();
  const { logout } = useAuth();
  const isActive = (path: string) =>
    path === '/'
      ? location.pathname === '/'
      : location.pathname.startsWith(path);

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
    <div className="fixed bottom-6 left-0 right-0 flex justify-center px-4 z-50">
      <nav className="bg-white/90 dark:bg-[#1E2130]/90 backdrop-blur-xl rounded-full px-3 py-2 shadow-[0_20px_50px_rgba(0,0,0,0.1)] border border-white/50 dark:border-white/10 flex items-center gap-1 md:gap-4">
        {navItems.map(({ path, emoji, label }) => (
          <Link
            key={path}
            to={path}
            className={`flex items-center justify-center w-12 h-12 rounded-full transition-all duration-300 ${
              isActive(path)
                ? 'bg-cream-200 dark:bg-[#252838] shadow-inner'
                : 'hover:bg-gray-50 dark:hover:bg-[#252838]'
            }`}
            aria-label={label}
          >
            <span className={`text-xl ${isActive(path) ? 'scale-110' : 'grayscale opacity-60'} transition-all`}>
              {emoji}
            </span>
          </Link>
        ))}

        <div className="w-px h-8 bg-gray-200 dark:bg-gray-700 mx-1" />

        <button
          onClick={() => setDark(!dark)}
          className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-gray-50 dark:hover:bg-[#252838] transition-all text-muted"
          aria-label="Toggle dark mode"
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        <button
          onClick={logout}
          className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-gray-50 dark:hover:bg-[#252838] transition-all text-muted"
          aria-label="Uitloggen"
        >
          <LogOut size={18} />
        </button>
      </nav>
    </div>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted text-sm">Laden...</div>
    );
  }
  if (!user) return <Login />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AuthGate>
          <BrowserRouter>
            <div className="min-h-screen pb-28">
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
        </AuthGate>
      </AuthProvider>
    </ErrorBoundary>
  );
}
