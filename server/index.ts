import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './db.js';
import menuRoutes from './routes/menus.js';
import shoppingRoutes from './routes/shopping.js';
import pantryRoutes from './routes/pantry.js';
import recipeRoutes from './routes/recipes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Allow iframe embedding (for Home Assistant)
app.use((_req, res, next) => {
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors *");
  next();
});

// API Routes — admin auth applied at router level in route files
app.use('/api/menus', menuRoutes);
app.use('/api/menus', shoppingRoutes);
app.use('/api/menus', pantryRoutes);
app.use('/api/recipes', recipeRoutes);

// GET /api/days/:dayId - get a single day by ID (avoids N+1 in frontend)
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

// GET /api/today - today's meal for HA sensor
app.get('/api/today', (_req, res) => {
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

// Serve static frontend in production
const clientPath = path.join(__dirname, '..', 'client');
app.use(express.static(clientPath));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientPath, 'index.html'));
});

// Initialize DB and start server
getDb();

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Weekmenu server running on port ${PORT}`);
  });
}

export default app;
