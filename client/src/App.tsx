import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import FamilyView from './pages/FamilyView';
import RecipeDetail from './pages/RecipeDetail';
import AdminMenu from './pages/AdminMenu';
import ShoppingList from './pages/ShoppingList';
import RecipeLibrary from './pages/RecipeLibrary';
import ErrorBoundary from './components/ErrorBoundary';

const navItems = [
  { path: '/', emoji: '🍽️', label: 'Menu' },
  { path: '/boodschappen', emoji: '🛒', label: 'Boodschappen' },
  { path: '/recepten', emoji: '📖', label: 'Recepten' },
  { path: '/admin', emoji: '⚙️', label: 'Admin' },
];

function NavBar() {
  const location = useLocation();
  const isActive = (path: string) =>
    path === '/'
      ? location.pathname === '/'
      : location.pathname.startsWith(path);

  return (
    <div className="fixed bottom-6 left-0 right-0 flex justify-center px-4 z-50">
      <nav className="bg-white/90 backdrop-blur-xl rounded-full px-3 py-2 shadow-[0_20px_50px_rgba(0,0,0,0.1)] border border-white/50 flex items-center gap-1 md:gap-4">
        {navItems.map(({ path, emoji, label }) => (
          <Link
            key={path}
            to={path}
            className={`flex items-center justify-center w-12 h-12 rounded-full transition-all duration-300 ${
              isActive(path)
                ? 'bg-cream-200 shadow-inner'
                : 'hover:bg-gray-50'
            }`}
            aria-label={label}
          >
            <span className={`text-xl ${isActive(path) ? 'scale-110' : 'grayscale opacity-60'} transition-all`}>
              {emoji}
            </span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
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
    </ErrorBoundary>
  );
}
