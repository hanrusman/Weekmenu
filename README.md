# Weekmenu

Weekmenu planner met AI-gestuurde boodschappenlijst generatie. Gebouwd met React, Express, SQLite en de Claude API.

## Vereisten

- Node.js 20+
- Anthropic API key

## Lokaal draaien

```bash
npm install
cp .env.example .env   # vul je ANTHROPIC_API_KEY en ADMIN_PIN in
npm run dev
```

De app draait op `http://localhost:3000`.

## Docker

### Environment variabelen

| Variabele | Verplicht | Default | Omschrijving |
|-----------|-----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Ja | — | Anthropic API key voor boodschappenlijst generatie |
| `ADMIN_PIN` | Ja | — | Pincode voor admin toegang |
| `PORT` | Nee | `3000` | Server poort |
| `DATABASE_PATH` | Nee | `./data/weekmenu.db` | Pad naar SQLite database |
| `CLAUDE_MODEL` | Nee | `claude-sonnet-4-20250514` | Claude model voor AI calls |

### Docker Compose

De `.env` file heeft minimaal nodig:

```env
ANTHROPIC_API_KEY=sk-ant-...
ADMIN_PIN=<jouw-pincode>
```

```bash
docker compose up -d
```

## Scripts

| Script | Omschrijving |
|--------|-------------|
| `npm run dev` | Start dev server (client + server) |
| `npm run build` | Build voor productie |
| `npm start` | Start productie server |
| `npm test` | Draai tests |
