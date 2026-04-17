import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './db.js';
import menuRoutes from './routes/menus.js';
import shoppingRoutes from './routes/shopping.js';
import pantryRoutes from './routes/pantry.js';
import recipeRoutes from './routes/recipes.js';
import authRoutes from './routes/auth.js';
import { requireAuth, requireHaToken, csrfGuard } from './middleware/auth.js';
import { pruneExpiredSessions } from './services/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.set('trust proxy', 1);

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Allow iframe embedding (for Home Assistant)
app.use((_req, res, next) => {
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors *");
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/auth', csrfGuard, authRoutes);

// HA sensor endpoint — protected by bearer token, not session
app.get('/api/today', requireHaToken, (_req, res) => {
  const db = getDb();
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const day = db.prepare(`
    SELECT md.* FROM menu_days md
    JOIN menus m ON md.menu_id = m.id
    WHERE m.status = 'active' AND md.date = ?
    ORDER BY m.id DESC LIMIT 1
  `).get(todayStr) as { recipe_name: string; prep_time_minutes: number; meal_type: string; cost_index: string; recipe_data: string } | undefined;

  if (!day) {
    res.json({ recipe_name: 'Geen gerecht vandaag', prep_time_minutes: 0, meal_type: '', cost_index: '' });
    return;
  }

  let recipe = {};
  try { recipe = JSON.parse(day.recipe_data); } catch { /* malformed data */ }

  res.json({
    recipe_name: day.recipe_name,
    prep_time_minutes: day.prep_time_minutes,
    meal_type: day.meal_type,
    cost_index: day.cost_index,
    recipe,
  });
});

// Everything below requires an authenticated session
app.use('/api', csrfGuard, requireAuth);

app.use('/api/menus', menuRoutes);
app.use('/api/menus', shoppingRoutes);
app.use('/api/menus', pantryRoutes);
app.use('/api/recipes', recipeRoutes);

app.get('/api/days/:dayId', (req, res) => {
  const db = getDb();
  const dayId = Number(req.params.dayId);
  if (!Number.isInteger(dayId) || dayId <= 0) {
    res.status(400).json({ error: 'Ongeldig dag ID' });
    return;
  }
  const day = db.prepare('SELECT * FROM menu_days WHERE id = ?').get(dayId);
  if (!day) {
    res.status(404).json({ error: 'Dag niet gevonden' });
    return;
  }
  res.json(day);
});

const clientPath = path.join(__dirname, '..', 'client');

app.use('/icons/meals', express.static(path.join(clientPath, 'icons/meals'), {
  maxAge: '30d',
  immutable: true,
}));

app.use(express.static(clientPath, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(clientPath, 'index.html'));
});

getDb();
pruneExpiredSessions();
setInterval(pruneExpiredSessions, 24 * 60 * 60 * 1000).unref();

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Weekmenu server running on port ${PORT}`);
  });
}

export default app;
