# Weekmenu

Weekmenu planner voor het gezin. Genereer een weekmenu in een Claude-gesprek, importeer de JSON, en gebruik de app om recepten te bekijken, boodschappen af te vinken en feedback te geven.

## Hoe het werkt

1. **Menu genereren** — Open een gesprek met Claude en plak de prompt uit `PROMPT_TEMPLATE.md`. Voeg eventueel feedback uit de app toe.
2. **Importeren** — Plak de JSON in de Admin pagina. Het menu wordt direct actief.
3. **Gebruiken** — Bekijk recepten, vink boodschappen af, geef feedback na elke maaltijd.
4. **Herhalen** — Volgende week importeer je een nieuw menu. Oude dagen blijven staan tot ze afgevinkt zijn (rolling kalender).

## Vereisten

- Node.js 20+

## Installatie

### 1. Dependencies & env

```bash
npm install
cp .env.example .env
```

Bewerk `.env` en zet minimaal:

```bash
# Bearer token voor de Home Assistant sensor op /api/today
HA_API_TOKEN=$(openssl rand -base64 48)
```

### 2. Maak je login-account aan

De app is afgeschermd — er is geen open registratie. Gebruik het seed-script om jezelf aan te maken:

```bash
npm run seed-user
```

Je wordt gevraagd om e-mail en wachtwoord (min. 12 tekens). Bestaande users kun je met hetzelfde commando een nieuw wachtwoord geven.

### 3. Starten

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- API: `http://localhost:3000`

Bij eerste bezoek krijg je een loginscherm. De sessie is een `httpOnly` cookie, 30 dagen geldig.

## Docker

```bash
docker compose up -d --build weekmenu
```

Na de eerste deploy één keer de user seeden in de container:

```bash
docker exec -it weekmenu npm run seed-user:prod
```

### Environment variabelen

| Variabele | Verplicht | Default | Omschrijving |
|-----------|-----------|---------|-------------|
| `HA_API_TOKEN` | Ja | — | Bearer token voor `/api/today`, gebruikt door de HA-sensor |
| `PORT` | Nee | `3000` | Server poort |
| `DATABASE_PATH` | Nee | `./data/weekmenu.db` | Pad naar SQLite database |
| `NODE_ENV` | Nee | — | Op `production` zetten zodat cookies alleen over HTTPS gaan |
| `FRAME_ANCESTORS` | Nee | `'self'` | CSP frame-ancestors. Zet op `"'self' https://ha.example.com"` om HA embedding toe te staan |

## Authenticatie

- **PWA / browser**: e-mail + wachtwoord → `httpOnly` session cookie (`SameSite=Lax`, 30 dagen)
- **Home Assistant sensor**: `GET /api/today` met header `Authorization: Bearer <HA_API_TOKEN>`
- **Wachtwoorden**: scrypt-gehasht met salt, constant-time compare
- **Login rate limit**: 5 pogingen per 15 min per IP
- **CSRF**: `SameSite=Lax` + Origin-check op mutaties

Publieke endpoints (geen auth): `/api/health`, `/api/auth/login`.

## Genereren menu
- Gebruik PROMPT_TEMPLATE_SIMPLE of _UITGEBREID en genereer menu met LLM. Het werkt het best in een project waar je je favoriete gerechten upload als .MD.

### HA-sensor voorbeeld

```yaml
# configuration.yaml
rest:
  - resource: https://weekmenu.example.com/api/today
    headers:
      Authorization: !secret weekmenu_api_token
    sensor:
      - name: "Weekmenu vandaag"
        value_template: "{{ value_json.recipe_name }}"
```

## Scripts

| Script | Omschrijving |
|--------|-------------|
| `npm run dev` | Start dev server (client + server) |
| `npm run build` | Build voor productie |
| `npm start` | Start productie server |
| `npm test` | Draai tests |
| `npm run seed-user` | Maak een user aan (dev, via tsx) |
| `npm run seed-user:prod` | Zelfde, maar in de production image (via compiled JS) |

## Technologie

- **Frontend**: React 19, Vite, TailwindCSS, React Router
- **Backend**: Express, TypeScript, better-sqlite3
- **Validatie**: Zod (voor menu JSON import)
- **Tests**: Vitest, Testing Library
