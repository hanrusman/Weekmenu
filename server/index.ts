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
app.use(express.json());

// Allow iframe embedding (for Home Assistant)
app.use((_req, res, next) => {
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors *");
  next();
});

// Simple admin PIN auth middleware
function adminAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const pin = req.headers['x-admin-pin'] || req.query.pin;
  const adminPin = process.env.ADMIN_PIN;
  if (adminPin && pin !== adminPin) {
    res.status(401).json({ error: 'Admin PIN vereist' });
    return;
  }
  next();
}

// API Routes
app.use('/api/menus', menuRoutes);
app.use('/api/menus', shoppingRoutes);
app.use('/api/menus', pantryRoutes);
app.use('/api/recipes', recipeRoutes);

// Admin-protected routes for mutations
app.post('/api/menus/generate', adminAuth);
app.patch('/api/menus/:id', adminAuth);

// GET /api/today - today's meal for HA sensor
app.get('/api/today', (_req, res) => {
  const db = getDb();
  const dayNames = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'];
  const today = dayNames[new Date().getDay()];

  const day = db.prepare(`
    SELECT md.* FROM menu_days md
    JOIN menus m ON md.menu_id = m.id
    WHERE m.status = 'active' AND md.day_name = ?
    ORDER BY m.id DESC LIMIT 1
  `).get(today) as { recipe_name: string; prep_time_minutes: number; meal_type: string; cost_index: string; recipe_data: string } | undefined;

  if (!day) {
    res.json({ recipe_name: 'Geen menu actief', prep_time_minutes: 0, meal_type: '', cost_index: '' });
    return;
  }

  res.json({
    recipe_name: day.recipe_name,
    prep_time_minutes: day.prep_time_minutes,
    meal_type: day.meal_type,
    cost_index: day.cost_index,
    recipe: JSON.parse(day.recipe_data),
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Weekmenu server running on port ${PORT}`);
});

export default app;
