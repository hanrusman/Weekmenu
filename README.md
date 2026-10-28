# Weekmenu

Weekmenu planner voor het gezin. Kies het weekmenu in de app zelf (met hulp van een taalmodel via LiteLLM als je wilt), of plan het in een Claude-gesprek en importeer de JSON. Gebruik de app daarna om recepten te bekijken, boodschappen af te vinken en maaltijden te beoordelen.

## Hoe het werkt

1. **Plannen** — Op *Plannen → Menu kiezen* kies je per dag een recept uit de bibliotheek, of laat je een taalmodel de open dagen voorstellen (zie [Menu kiezen](#menu-kiezen)). Of je kopieert de bibliotheek (goedgekeurde recepten, wat recent gepland is, de feedback) en plakt die in een gesprek met Claude.
2. **Controleren** — Bij *Menu kiezen* zie je per dag en per week of je binnen de kaders blijft, en zet je de week direct op het menu. Via Claude plak je de JSON die Claude teruggeeft. Je ziet eerst het voorstel: welke dagen, welke recepten nieuw zijn in de bibliotheek, en of een bestaande week wordt vervangen. Pas na *Zet op het menu* wordt het menu actief, met boodschappenlijst.
3. **Gebruiken** — Het menu toont vanavond groot: vink het af met *Gegeten* en geef direct 1 tot 5 sterren. Een opmerking zet je op de receptpagina. Boodschappen vink je af; *Alles afvinken* kun je ongedaan maken.
4. **Herhalen** — Volgende week plan je een nieuw menu. Meerdere weken kunnen tegelijk actief zijn (rolling kalender); de wisselaar toont weeknummer en data.
5. **Archief** — Een week gaat vanzelf naar het archief zodra de laatste dag voorbij is, ook als niet alles is afgevinkt (of eerder, als alle dagen zijn afgevinkt). Op *Archief* (vanaf het menu of Plannen) zoek je terug wanneer je iets at, zie je de sterren per week, en zet je een week terug op het menu of verwijder je hem. Een teruggezette week blijft actief tot je hem zelf weer archiveert.

Beoordelingen gaan van 1 tot 5 sterren. Oude beoordelingen zijn bij de update omgezet: lekker = 5, ok = 3, minder = 1. De planningsbrief geeft Claude per recept het gemiddelde aantal sterren.

Weergave (automatisch, licht of donker) en uitloggen staan onder *Plannen → Instellingen*.

## Boodschappen naar Albert Heijn

Naast Picnic kun je producten uit de boodschappenlijst aan je AH-winkelmandje toevoegen, met productkeuze, aantallen en onthouden voorkeuren. Zie de [koppelhandleiding en werking](docs/albert-heijn.md). Bestellen doe je daarna bij AH.

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
| `LITELLM_URL` | Nee | — | OpenAI-compatibel endpoint (bijv. `http://litellm:4000`) voor recepten inlezen, groente aanvullen en menuvoorstellen. Zonder `LITELLM_URL` + `LITELLM_API_KEY` voer je recepten met de hand in en kies je het menu zelf |
| `LITELLM_API_KEY` | Nee | — | Bearer-key voor `LITELLM_URL` |
| `RECIPE_PARSE_MODEL` | Nee | `cloud-gemma` | Model-alias waarmee recepten worden ingelezen |
| `VEGETABLE_MODEL` | Nee | `cloud-glm` | Model-alias waarmee recepten groente bijkrijgen (via `LITELLM_URL`) |
| `VEGETABLE_FALLBACK_MODEL` | Nee | `cloud-mistral` | Reserve als het eerste model twee keer niets bruikbaars geeft |
| `MENU_MODEL` | Nee | `cloud-glm` | Model-alias dat bij *Menu kiezen* een week voorstelt |
| `MENU_FALLBACK_MODEL` | Nee | `cloud-kimi` | Derde poging als het eerste model twee keer geen week binnen de kaders geeft |
| `MENU_CHAT_MODEL` | Nee | `cloud-gemma` | Model-alias voor *Vraag de assistent* bij een dag; liefst een snel model |
| `MENU_CHAT_FALLBACK_MODEL` | Nee | `cloud-mistral` | Tweede poging als de assistent geen bruikbaar antwoord geeft |
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

## Menu kiezen

Op *Plannen → Menu kiezen* staat de volgende week (donderdag tot en met woensdag) meteen klaar: de app kiest per dag een goedgekeurd hoofdgerecht dat binnen de kaders past, met voorrang voor wat het gezin hoog waardeert en wat een tijd niet op tafel stond. Ontbijt en tussendoortjes kiest hij er ook bij. Dat gaat zonder taalmodel en is dus direct klaar (`shared/menu-fill.ts`); *Nieuw voorstel* zet de week opnieuw klaar, behalve wat je zelf gekozen hebt.

Tik op een dag voor:

- **Kies nieuw recept**: meteen het volgende recept dat het best past; nog eens tikken geeft weer een ander. Eerst alles wat binnen de kaders past, daarna weer van voren af aan.
- **Zoek zelf**: de hele bibliotheek, bovenaan wat past, met per recept wat het met de week doet ("telt mee voor vis", "vlees 3×", "weer pasta, net als maandag").
- **Verklein portie**: voor 3, 2 of 1 persoon. De boodschappenlijst rekent mee, en het recept van die dag staat op die portie.
- **Wissel van dag**: ruilt het gerecht (met portie) met een andere dag.
- **Sla deze dag over**: geen avondeten die dag; *Toch plannen* zet er weer iets op.
- **Vraag de assistent**: een gesprek over die dag. Zeg waar je zin in hebt ("iets met pompoen", "snel en zonder vlees"); een taalmodel kiest er één tot drie uit de bibliotheek, met waarom, en jij kiest. Het kent de rest van de week en de kaders, en mag alleen recepten uit de bibliotheek noemen. Het gebruikt een snel model (`MENU_CHAT_MODEL`), zodat het antwoord binnen een paar seconden komt.

Met de pijltjes ga je naar een andere week; staat die al op het menu, dan begin je daarvan (een dag die er niet in staat is overgeslagen) en vervangt opslaan hem.

De kaders, voor de app, de assistent en het taalmodel dezelfde (`shared/menu-rules.ts`):

| Kader | Per | Regel |
|-------|-----|-------|
| Groente | dag | ≥ 350 g per volwassene; een *uitzondering* (pizza) ≥ 250 g. Tussen 250 en 350 g is een waarschuwing |
| Hele maaltijd | dag | Geen recept dat koolhydraten of eiwit mist |
| Tijd | dag | Doordeweeks (ma–vr) liefst hooguit 30 minuten (waarschuwing) |
| Herhaling | dag | Niet hetzelfde recept twee keer in de week; liefst niets uit de 3 weken ervoor (waarschuwing) |
| Vis | week | Minstens 2× |
| Peulvruchten | week | Minstens 2× |
| Vlees | week | Hooguit 3×, liefst 2× |
| Uitzondering | week | Hooguit 1× |
| Afwisseling | week | Niet twee dagen achter elkaar dezelfde soort, en elke soort hooguit 2× (waarschuwing) |

De kaders staan bovenaan als tellingen; *Kaders deze week* klapt de details open. Groen is binnen de kaders, grijs *nog open* (nog haalbaar met de dagen die over zijn), oranje een waarschuwing en rood buiten de kaders. Buiten de kaders opslaan kan wel: de kaders adviseren, ze blokkeren niet. Wat je kiest blijft in de browser bewaard tot je het op het menu zet.

**De assistent kiest de hele week** (onder *Meer*): een taalmodel (via `LITELLM_URL`, model `MENU_MODEL`) kiest de dagen die je niet zelf gekozen hebt, met je wensen voor de week. Het krijgt de goedgekeurde hoofdgerechten met per recept eiwit, groente, tijd, sterren en of het recent gepland is, plus de opmerkingen van het gezin. De app controleert het voorstel op de kaders en geeft het met de fouten terug aan het model, tot drie pogingen; daarna komt het beste voorstel in de kiezer, met wat er nog aan schort. Dagen die je al gekozen hebt blijven staan. Het voorstel draait op de server en kan een paar minuten duren; je mag de pagina sluiten. Het model kiest alleen uit de bibliotheek; een nieuw recept laten bedenken gaat nog via Claude.

## Genereren menu via Claude
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
| `npm run icons` | Zet nieuwe of gewijzigde illustraties in `client/public/icons/meals/` om naar webp (256 px, wordt meegecommit) |
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
