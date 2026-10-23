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

## Employee workspace
* The employee top bar always shows a **Check In / Check Out** button (status, "since" time, today's hours, active task). Checking out asks for an optional note and the tasks worked on.
* **Tasks** is a full ClickUp-style workspace: Spaces sidebar, *My Tasks* / *All Tasks* tabs, List / Board (drag to change status) / Calendar views and a slide-in task panel. Employees can create and delete tasks, reassign, change status, comment, tick subtasks and log time on any task, and link a task to today's attendance ("Work on this task"). They cannot create/delete Spaces or Lists, and the workspace API never returns finance, client money or salaries.
* Needs migration `0003_workspace.sql` (`npm run db:migrate`) and a Worker deploy.

## Real-time chat (Durable Objects)
* Every channel, DM pair and task is a `ChatRoom` Durable Object (`worker/src/chat.js`): `channel:{id}`, `dm:{userA}:{userB}`, `task:{id}`. WebSocket routes: `GET /api/ws/channel/:id`, `/api/ws/dm/:user_id`, `/api/ws/task/:id?token=<JWT>` — the Worker verifies the JWT, the origin and the caller's access before upgrading.
* Messages are saved to D1 and broadcast instantly; presence, typing, edit (15 min), delete, 4 emoji reactions, DM ✓ / ✓✓, unread badges and 50-message paging are built in. If the socket drops the UI reconnects (1 → 8 s backoff) and polls every 5 s meanwhile.
* Needs migration `0004_realtime.sql` and the `[[durable_objects]]` / `[[migrations]]` blocks in `worker/wrangler.toml` (SQLite-backed class, works on Free and Paid). Deploy with `npm run db:migrate && npm run deploy:api`.

## Light / dark theme
* Every portal has a 🌙 / ☀️ button (top bar, far right; in the admin Tasks view, where the top bar is hidden, use the one next to *Log out*). The choice is saved per portal in `localStorage` (`mb_theme_admin`, `mb_theme_employee`, `mb_theme_client`) and applied before first paint. Defaults: admin + employee dark, client light. The login page is always dark.
* Tokens live in `public/theme.css` (dark: `#0d0d0d / #1a1a1a / #1e1e1e / #fff`, light: `#f8f9fa / #fff / #fff / #111827`). The admin app's hard-coded colours are mapped to the light palette by `scripts/gen-light-theme.py`, which writes `public/admin-light.css` — **re-run it after editing the admin CSS**.
* Chart.js axis/grid colours follow the theme and charts are rebuilt on switch.

## Allah's Share — overpayment credit
* A **Voluntary** payment first settles the remaining obligation (all-time); anything above that becomes **credit** (`credit_added`). The form previews "₨X applied to obligation, ₨Y added to credit balance".
* When later income raises the obligation, credit is used automatically (first, before anything shows as owed) and each use appears in the history as a golden **Credit Applied** row (`credit_applied`) with the income period it covered. Remaining = Owed − Paid − Credit applied; the credit rows hide when there is no credit.
* Stored in D1: `allah_share_payments` gains `kind`, `obligated_part`, `credit_added`, `credit_applied`; the running balance is `app_settings.allah_share_credit`. Needs migration `0005_allah_credit.sql` and a Worker deploy (`npm run db:migrate && npm run deploy:api`). Old voluntary payments keep their original meaning (pure extra giving).
