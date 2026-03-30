# Weekmenu

Weekmenu planner voor het gezin. Genereer een weekmenu in een Claude-gesprek, importeer de JSON, en gebruik de app om recepten te bekijken, boodschappen af te vinken en feedback te geven.

## Hoe het werkt

1. **Menu genereren** — Open een gesprek met Claude en plak de prompt uit `PROMPT_TEMPLATE.md`. Voeg eventueel feedback uit de app toe.
2. **Importeren** — Plak de JSON in de Admin pagina. Het menu wordt direct actief.
3. **Gebruiken** — Bekijk recepten, vink boodschappen af, geef feedback na elke maaltijd.
4. **Herhalen** — Volgende week importeer je een nieuw menu. Oude dagen blijven staan tot ze afgevinkt zijn (rolling kalender).

## Vereisten

- Node.js 20+

## Lokaal draaien

```bash
npm install
cp .env.example .env   # vul je ADMIN_PIN in
npm run dev
```

De app draait op `http://localhost:3000`.

## Docker

```bash
docker compose up -d --build weekmenu
```

### Environment variabelen

| Variabele | Verplicht | Default | Omschrijving |
|-----------|-----------|---------|-------------|
| `ADMIN_PIN` | Ja | — | Pincode voor admin toegang |
| `PORT` | Nee | `3000` | Server poort |
| `DATABASE_PATH` | Nee | `./data/weekmenu.db` | Pad naar SQLite database |

## Scripts

| Script | Omschrijving |
|--------|-------------|
| `npm run dev` | Start dev server (client + server) |
| `npm run build` | Build voor productie |
| `npm start` | Start productie server |
| `npm test` | Draai tests |

## Technologie

- **Frontend**: React 19, Vite, TailwindCSS, React Router
- **Backend**: Express, TypeScript, better-sqlite3
- **Validatie**: Zod (voor menu JSON import)
- **Tests**: Vitest, Testing Library
