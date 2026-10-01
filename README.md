# Weekmenu

Weekmenu planner voor het gezin. Genereer een weekmenu in een Claude-gesprek, importeer de JSON, en gebruik de app om recepten te bekijken, boodschappen af te vinken en feedback te geven.

## Hoe het werkt

1. **Menu genereren** — Open een gesprek met Claude en plak de prompt uit `PROMPT_TEMPLATE.md`. Voeg eventueel feedback uit de app toe.
2. **Importeren** — Plak de JSON in de Admin pagina. Het menu wordt direct actief.
3. **Gebruiken** — Bekijk recepten, vink boodschappen af, geef feedback na elke maaltijd.
4. **Herhalen** — Volgende week importeer je een nieuw menu. Oude dagen blijven staan tot ze afgevinkt zijn (rolling kalender).

## Vereisten

- Node.js 22+

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
| `COOKIE_SAMESITE` | Nee | `lax` | SameSite van de sessiecookie (`lax`, `strict`, `none`). Zet op `none` zodat inloggen in een cross-site iframe (HA) werkt; forceert dan ook `Secure` (HTTPS vereist) |
| `COOKIE_SECURE` | Nee | — | Zet op `false` om de `Secure`-flag uit te zetten in productie (alleen voor HTTP-only setups; genegeerd bij `COOKIE_SAMESITE=none`) |
| `LITELLM_URL` | Nee | — | OpenAI-compatibel endpoint voor het inlezen van recepten uit vrije tekst (bijv. `http://litellm:4000`). Zonder `LITELLM_URL` + `LITELLM_API_KEY` kun je recepten alleen met de hand invoeren |
| `LITELLM_API_KEY` | Nee | — | Bearer-key voor `LITELLM_URL` |
| `RECIPE_PARSE_MODEL` | Nee | `cloud-gemma` | Model-alias waarmee recepten worden ingelezen |
| `VEGETABLE_MODEL` | Nee | `cloud-glm` | Model-alias waarmee recepten groente bijkrijgen (via `LITELLM_URL`) |
| `VEGETABLE_FALLBACK_MODEL` | Nee | `cloud-mistral` | Reserve als het eerste model twee keer niets bruikbaars geeft |
| `IMAGE_WORKER_TOKEN` | Nee | — | Bearer token voor `/api/image-worker/*`, gebruikt door het script dat receptplaatjes maakt. Zonder token staat die API uit (503) |

## Authenticatie

- **PWA / browser**: e-mail + wachtwoord → `httpOnly` session cookie (`SameSite=Lax`, 30 dagen; SameSite instelbaar via `COOKIE_SAMESITE`)
- **Home Assistant sensor**: `GET /api/today` met header `Authorization: Bearer <HA_API_TOKEN>`
- **Plaatjes-script**: `/api/image-worker/*` met header `Authorization: Bearer <IMAGE_WORKER_TOKEN>`
- **Wachtwoorden**: scrypt-gehasht met salt, constant-time compare
- **Login rate limit**: 5 pogingen per 15 min per IP
- **CSRF**: Origin-check op alle mutaties (cross-origin POST/PUT/DELETE → 403). Met de default `SameSite=Lax` is dat een tweede laag; met `COOKIE_SAMESITE=none` is het de primaire bescherming

Publieke endpoints (geen auth): `/api/health`, `/api/auth/login`.

### Embedden in Home Assistant (iframe)

Om de volledige app als iframe-panel in HA te draaien zijn twee env-vars nodig:

```bash
FRAME_ANCESTORS="'self' http://192.168.2.52:8123"   # HA-origin mag embedden
COOKIE_SAMESITE=none                                 # cookie werkt in third-party context
```

In een cross-site iframe behandelt de browser de sessiecookie als third-party; zonder `SameSite=None; Secure` wordt hij geweigerd en kom je na inloggen terug op het loginscherm. Direct gebruik (gewone tab) blijft gewoon werken. Let op: Safari/iOS WebKit blokkeert third-party cookies altijd, ongeacht SameSite — gebruik daar de app direct of via de HA companion app op Android/desktop-browsers.

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
| `npm run images` | Maak plaatjes voor recepten in de wachtrij (op een Mac, zie hieronder) |

### Groente

Het gezin wil 350 g groente per volwassene per avond (de Schijf van Vijf vraagt minimaal 250 g). De app telt per recept de groente per persoon uit de ingrediënten: aardappelen, peulvruchten, olijven, citroen, knoflook en kruiden tellen niet mee; tomaten uit blik, passata en diepvriesgroente wel. Het label staat op elk recept, met een filter *Alleen te weinig groente* in de bibliotheek.

Twee labels per recept, in de editor te zetten: *hoofdgerecht* (taart, toetjes, brood en hapjes worden niet gepland en hoeven de norm niet te halen) en *uitzondering* (zoals pizza: minstens 250 g met een bijgerecht, hooguit één keer per week). De planningsbrief voor Claude geeft beide en de groente per recept mee.

Op *Recepten → Groente aanvullen* vult een taalmodel alle hoofdgerechten onder de norm in één ronde aan: eerst met meer van de groente die erin zit, anders met een bijgerecht. De app telt het voorstel zelf na en weigert het als er een ingrediënt is weggevallen; dan probeert het model het opnieuw. De ronde draait op de server en gaat door als je de pagina sluit. Het origineel blijft bewaard: op het recept staat wat er is aangevuld, met *Terugzetten*.

### Receptplaatjes

Elk recept kan een eigen plaatje hebben: een foto van bovenaf op een wit bord, met transparante achtergrond, in de stijl van `client/public/icons/meals/`. Zonder eigen plaatje toont de app een passende illustratie uit die map, anders een emoji.

De plaatjes worden niet op de server gemaakt maar door `scripts/generate-recipe-images.ts`, op een Mac met de ChatGPT-app. Het script gebruikt de ingebouwde beeldgeneratie van Codex (valt onder het ChatGPT-abonnement, geen API-key) en stuurt het plaatje als webp van 512 px naar Weekmenu. Het data-volume bewaart ze in `images/recipes/`.

```bash
IMAGE_WORKER_TOKEN=… npm run images -- --limit 10          # tegen https://weekmenu.c4w.nl
IMAGE_WORKER_TOKEN=… npm run images -- --dry-run          # alleen wachtrij + prompt tonen
```

In de wachtrij staan recepten zonder plaatje, archief uitgezonderd. Met *Nieuw plaatje* op een recept zet je het vooraan. Is een gemaakt plaatje onbruikbaar (geen transparante achtergrond), dan zie je de reden bij het recept en wacht het tot je *Opnieuw proberen* kiest. Een plaatje dat Codex niet aflevert blijft gewoon in de wachtrij voor de volgende run. Stopt Codex zelf, bijvoorbeeld omdat het gebruikstegoed op is ("You've hit your usage limit … try again at 10:10 PM"), dan uploadt het script eerst de plaatjes die al klaar waren en stopt daarna met de reden van Codex; de rest blijft in de wachtrij. Maakt een sessie helemaal niets, dan stopt het script ook. Weekmenu weigert een resultaat voor een recept waarvan het plaatje intussen is veranderd of opnieuw aangevraagd (409); het script slaat dat over. Andere Codex-locatie: zet `CODEX_BIN`.

## Technologie

- **Frontend**: React 19, Vite, TailwindCSS, React Router
- **Backend**: Express, TypeScript, better-sqlite3
- **Validatie**: Zod (voor menu JSON import)
- **Tests**: Vitest, Testing Library
