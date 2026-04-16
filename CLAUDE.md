# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # concurrent: Vite (client:5173) + tsx watch (server:3000, proxied via Vite)
npm run build        # Vite build → dist/client, tsc -p tsconfig.server.json → dist/server
npm start            # run dist/server/index.js (expects prior build)
npm test             # vitest run (all 10 files in tests/)
npm run test:watch   # vitest in watch mode

# Single test file / single test
npx vitest run tests/daycard.test.tsx
npx vitest run -t "should render day name"   # grep by test name
```

Tests use `happy-dom` + Testing Library and always run against a real SQLite DB. Each test file that touches the DB sets a temp path via `DATABASE_PATH` env and closes the connection in teardown — see `tests/setup.ts` and `tests/api.test.ts` for the pattern.

## Architecture

**Monorepo layout**: `client/` is a Vite+React 19 SPA; `server/` is an Express API that also serves the built client from `dist/client` in production. Both compile to `dist/`. In dev, Vite proxies `/api` → `localhost:3000`.

**Data flow — the "rolling calendar"**: Multiple `menus` can be `status='active'` simultaneously. `GET /api/menus/active` merges days from all active menus into a single date-sorted list. The UI (`FamilyView`) shows this combined view, so the week of Apr 10 and the week of Apr 17 both render their days until each one is individually marked complete. Don't assume "active menu" means "single menu".

**Menu week logic (`server/services/menu-generator.ts`)**: Weeks run Thursday→Wednesday, not Mon→Sun. `getTargetWeek(now)` returns the upcoming Thursday's ISO week when today is Sat–Wed, else the current week. `computeDate` walks forward from the week's Monday, wrapping days before the menu's first day into the next calendar week. If you touch date math, run `tests/import.test.ts` — it locks down the Thu–Wed behavior.

**Menu import validation**: `importMenu()` parses JSON through `MenuImportSchema` (Zod). Re-importing the same (week, year) wipes the old menu via cascading FK delete. The same recipe upserts into the `recipes` table (unique index on `name`) with `times_used++` — that's how the recipe library grows.

**Admin auth**: `server/middleware/auth.ts` — header `x-admin-pin` must match env `ADMIN_PIN`. Applied per-route in route files, **not globally**, because some mutations (marking a day complete, saving feedback) are intentionally unauthenticated so the family can use them without the PIN. When adding write endpoints, explicitly decide whether to attach `adminAuth`.

**Client API layer (`client/src/lib/api.ts`)**: Single `request()` wraps `fetch`, auto-adds `x-admin-pin` for non-GET methods. PIN is kept in module-level state (not localStorage for the value — only `setAdminPin` persists it via closure). If a request fails, `err.error` from the server response becomes the thrown `Error.message`.

**Service worker gotcha (`client/public/sw.js`)**: The SW catches **every** failed `/api/` fetch and returns `{error: 'Offline'}` with status 503, which surfaces in the UI as "Offline". That message is misleading — the actual cause could be 413 payload-too-large, Traefik body limit, TLS reset, CORS, etc. When debugging "Offline" errors, check DevTools Network tab and server logs first; the SW swallows the real status.

**Meal image matching (`client/src/lib/mealImages.ts`)**: Icons live in `client/public/icons/meals/*.png`. `findMealImage(recipeName, mealType)` scores each entry's keywords against the recipe name (`5 + keyword.length` per hit). `mealTypes` on an entry is a **hard filter** (returns 0, excludes the entry), not a bonus — this prevents e.g. a pasta icon from matching a rijst dish that shares a keyword. Score must be > 0 to return an image; otherwise the emoji fallback from `mealTypeEmoji` is used.

**Production build (`Dockerfile`)**: Multi-stage. Builder stage runs `npm run build`, then uses imagemagick to convert every `dist/client/icons/meals/*.png` to `.webp` at quality 85. Both `DayCard.tsx` and `RecipeView.tsx` use `<picture>` with WebP source + PNG fallback, so browsers without WebP support still work. If you add new icons, they only need PNGs — the Docker build generates the WebPs.

**Express static caching (`server/index.ts`)**: `/icons/meals` is served with `maxAge: 30d, immutable` (filenames are stable, not content-hashed, but the content doesn't change). Everything else under `clientPath` uses default caching, except `index.html` which is explicitly `no-cache` so a new app shell is always picked up after deploy.

**SQLite migrations (`server/db.ts`)**: Schema lives in one `CREATE TABLE IF NOT EXISTS` block. For non-destructive schema evolution, use the `addColumnIfMissing` / `addUniqueIndexIfMissing` helpers — they inspect `PRAGMA table_info` / `sqlite_master` before applying. WAL mode + `foreign_keys = ON` are enabled.

## Workflow conventions

**Feedback loop for menu generation**: `PROMPT_TEMPLATE.md` is the canonical prompt used to generate menus via Claude outside the app. The admin page has "Feedback exporteren" which produces text to paste back into the next prompt, so past ratings inform future menus. Don't change the JSON schema in `menu-generator.ts` without updating the template.

**Dutch-language codebase**: User-facing strings, commit messages, and comments are mixed NL/EN. Keep new user-facing text in Dutch to match (`Importeer weekmenu`, `Geen gerecht vandaag`, etc.).

## Docker Compose Service Template

Wanneer er een nieuwe service toegevoegd moet worden aan de docker-compose.yml van de infra repo, gebruik dan deze stijl. Het volgende nummer is **14**.

```yaml
  # --- {NUMMER}. {NAAM_UPPERCASE} ---
  {naam_lowercase}:
    build: https://github.com/hanrusman/{Repo}.git#main
    container_name: {naam_lowercase}
    restart: unless-stopped
    read_only: true
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    user: "1000:1000"
    tmpfs:
      - /tmp:rw,noexec,nosuid
    volumes:
      - ./{naam_lowercase}/data:/app/data:rw
    env_file:
      - ./{naam_lowercase}/.env
    environment:
      - TZ=Europe/Amsterdam
      - NODE_ENV=production
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:{PORT}/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 5m
      timeout: 10s
      retries: 3
      start_period: 30s
    deploy:
      resources:
        limits:
          memory: 256M
          cpus: '0.5'
          pids: 100
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    networks:
      - personal_net
      - traefik
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.{naam_lowercase}.rule=Host(`{naam_lowercase}.c4w.nl`)"
      - "traefik.http.routers.{naam_lowercase}.entrypoints=websecure"
      - "traefik.http.routers.{naam_lowercase}.tls.certresolver=letsencrypt"
      - "traefik.http.services.{naam_lowercase}.loadbalancer.server.port={PORT}"
```

### Stijlregels
- Nummering: oplopend (volgende is 14)
- Comment header: `# --- {NR}. {NAAM} ---`
- Altijd: `read_only: true`, `no-new-privileges`, `cap_drop: ALL`, `user: "1000:1000"`
- Altijd: tmpfs voor /tmp, json-file logging met max 10m/3 files
- Netwerken: `personal_net` + `traefik`
- Traefik labels met subdomain op `c4w.nl`
- Resource limits: 256M memory, 0.5 CPU, 100 pids
- Timezone: Europe/Amsterdam
