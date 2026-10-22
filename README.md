# Media Beem — Agency Manager (3 portals)

| Portal | URL | Who |
|---|---|---|
| Admin | `/admin` | the owner — everything (finance, clients, tasks, employees, personal finance) |
| Employee | `/employee` | my tasks, team channels they're added to, DMs, own salary history |
| Client | `/client` | own invoices & payment status, own project tasks (view + comment), own `#general-<client>` channel |

Everyone signs in at `/login` (email + password); the role in the JWT sends them to their portal.
Accounts are never self-service: the admin creates employee / client logins from the **Create Portal Access** button on each employee / client profile.

```
public/            frontend (Cloudflare Pages)   login, admin, employee, client + config.js
worker/src/        API (Cloudflare Worker)       auth, admin sync, employee, client, messaging
worker/migrations/ D1 schema
worker/seed-admin.mjs   creates the first admin
worker/wrangler.toml   Worker + D1 config (Workers only; kept out of the repo root so Pages ignores it)
finance-app.html   the old single-file localStorage app (kept for reference)
```

## First-time deploy

```bash
npm install
npx wrangler login

# 1. database
npm run db:create                    # copy the printed database_id into worker/wrangler.toml
npm run db:migrate                   # applies worker/migrations to the remote D1

# 2. secrets + API
npx wrangler secret put JWT_SECRET -c worker/wrangler.toml   # paste a long random string:  openssl rand -base64 48
npm run deploy:api                   # prints https://mediabeem-api.<you>.workers.dev

# 3. first admin
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-long-password' npm run db:seed

# 4. frontend
#    edit public/config.js → set the production API_BASE to the Worker URL from step 2
#    edit worker/wrangler.toml → ALLOWED_ORIGINS must contain your Pages origin (https://mediabeem-pages.pages.dev)
npm run deploy:api && npm run deploy:pages
```

In the Cloudflare Pages dashboard, set the project's **build output directory to `public`** (no build command) if you deploy via Git instead of `npm run deploy:pages`.

### Automatic redeploys
`.github/workflows/deploy.yml` migrates D1, deploys the Worker and the Pages site on every push to `main`.
Add the repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## Moving your old browser data
Open `/admin` in the **same browser** that has the old app's data. On first login you'll be offered a one-time import into D1; after it succeeds the local copy is cleared. (Files attached to chats / resource folders were stored per-device in IndexedDB and can't be moved — chat file sharing is turned off for DMs/channels until file storage such as R2 is added.)

## Local development
```bash
npm install
cp worker/.dev.vars.example worker/.dev.vars     # JWT_SECRET for local dev
npm run db:migrate:local
ADMIN_EMAIL=admin@mediabeem.test ADMIN_PASSWORD='TestPassw0rd!x' npm run db:seed:local
npm run dev                               # API on :8787
npm run dev:web                           # frontend on :8080 (clean URLs: /admin, /employee, /client)
```

## Security notes
* Passwords: PBKDF2-SHA256 (100k iterations). JWT HS256, 7-day expiry; every request re-checks the account is still active, so **Deactivate** takes effect immediately.
* Login is rate-limited (8 failures / 15 min per email). CORS only allows the origins in `ALLOWED_ORIGINS`.
* Employee and client endpoints only query the caller's own rows (tasks assigned to them, their own salary rows, invoices of their client); clients only see task comments flagged *Visible to client*.
* The token lives in `localStorage` (as specified) — it is exposed to any XSS, so keep third-party scripts to a minimum.

## Attendance & time tracking
* **Employees** check in / out from *Attendance* in their portal (extra check-ins during the day = breaks), write a daily note and tick the tasks they worked on.
* **Admin** → *Attendance*: daily report, per-employee calendar + monthly summary (CSV export), and *Work hours* settings (start/end time, working days, alert delay, half-day hours, timezone, "count attendance from" date). The dashboard shows today's report card and red alerts (nobody checked in an hour after start, or still clocked in after the end time).
* Only employees with an active portal account are tracked. Days before the "count attendance from" date are never marked absent.
* Needs migration `0002_attendance.sql` (`npm run db:migrate`) and a Worker deploy.
