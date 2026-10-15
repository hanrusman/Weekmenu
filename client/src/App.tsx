import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { BookOpen, CalendarPlus, ShoppingBasket, UtensilsCrossed, LucideIcon } from 'lucide-react';
import FamilyView from './pages/FamilyView';
import RecipeDetail from './pages/RecipeDetail';
import Plannen from './pages/Plannen';
import ShoppingList from './pages/ShoppingList';
import PicnicCart from './pages/PicnicCart';
import RecipeLibrary from './pages/RecipeLibrary';
import IngredientManager from './pages/IngredientManager';
import RecipeImport from './pages/RecipeImport';
import RecipeBulkImport from './pages/RecipeBulkImport';
import VegetableTopUp from './pages/VegetableTopUp';
import LibraryRecipe from './pages/LibraryRecipe';
import RecipeEdit from './pages/RecipeEdit';
import MenuArchive from './pages/MenuArchive';
import Login from './pages/Login';
import ErrorBoundary from './components/ErrorBoundary';
import { AuthProvider, useAuth } from './lib/auth';
import { ThemeProvider } from './lib/theme';

const navItems: Array<{ path: string; icon: LucideIcon; label: string; also?: string[] }> = [
  { path: '/', icon: UtensilsCrossed, label: 'Menu', also: ['/dag/', '/archief'] },
  { path: '/boodschappen', icon: ShoppingBasket, label: 'Boodschappen' },
  { path: '/recepten', icon: BookOpen, label: 'Recepten', also: ['/ingredienten'] },
  { path: '/plannen', icon: CalendarPlus, label: 'Plannen' },
];

function NavBar() {
  const location = useLocation();
  const isActive = (item: typeof navItems[number]) =>
    (item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path))
    || !!item.also?.some((p) => location.pathname.startsWith(p));

  return (
    <div className="fixed left-0 right-0 flex justify-center px-4 z-50 pointer-events-none"
      style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
      <nav aria-label="Hoofdmenu"
        className="pointer-events-auto bg-surface/90 backdrop-blur-xl rounded-[1.75rem] p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.12)] border border-line-soft flex items-stretch gap-1">
        {navItems.map((item) => {
          const active = isActive(item);
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-col items-center justify-center gap-0.5 min-w-[4.25rem] px-2 py-2 rounded-[1.25rem] transition-colors
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                active ? 'bg-brand/10 text-brand' : 'text-muted hover:text-ink hover:bg-raised'
              }`}
            >
              <Icon size={22} strokeWidth={active ? 2.4 : 1.9} />
              <span className={`text-[11px] leading-tight ${active ? 'font-bold' : 'font-medium'}`}>{item.label}</span>
            </NavLink>
          );
        })}
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
      <ThemeProvider>
      <AuthProvider>
        <AuthGate>
          <BrowserRouter>
            <div className="min-h-screen pb-32">
              <Routes>
                <Route path="/" element={<FamilyView />} />
                <Route path="/dag/:dayId" element={<RecipeDetail />} />
                <Route path="/archief" element={<MenuArchive />} />
                <Route path="/plannen" element={<Plannen />} />
                <Route path="/admin" element={<Navigate to="/plannen" replace />} />
                <Route path="/boodschappen" element={<ShoppingList />} />
                <Route path="/boodschappen/picnic/:menuId" element={<PicnicCart />} />
                <Route path="/recepten" element={<RecipeLibrary />} />
                <Route path="/recepten/nieuw" element={<RecipeImport />} />
                <Route path="/recepten/bulk" element={<RecipeBulkImport />} />
                <Route path="/recepten/groente" element={<VegetableTopUp />} />
                <Route path="/recepten/:id" element={<LibraryRecipe />} />
                <Route path="/recepten/:id/bewerken" element={<RecipeEdit />} />
                <Route path="/ingredienten" element={<IngredientManager />} />
              </Routes>
              <NavBar />
            </div>
          </BrowserRouter>
        </AuthGate>
      </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
