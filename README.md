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

### Credit balance — where it comes from and how to check it
* Credit = (a) the excess of a voluntary payment over the remaining obligation, plus (b) any obligated payments above what is owed, plus (c) a manual adjustment: if `app_settings.allah_share_credit` is edited directly in D1 the app notices that it no longer matches what it last wrote (`allah_share_credit_last`) and adds the difference as a manual credit.
* Dashboard and Allah's Share page show the credit row whenever the balance is above ₨0 (and the "You're ahead!" banner when it covers the whole obligation). `npm run test:allah` verifies this end to end, including the ₨5,000 database test.
* Needs migrations `0005` + `0006` and a Worker deploy so the extra settings keys sync.

## Employee onboarding

A new hire fills in their own details, bank information and signs the employment agreement on a public page — no login needed. The admin reviews, then approves to create the profile and portal account.

**Flow**

1. **Admin → Employees → profile → "Generate Onboarding Link".** Designation, Salary and Start Date must be filled in first. The link is `employee.mediabeem.com/onboarding?token=…`, valid for **7 days**. The profile shows its status (Pending / Completed / Expired), a *Copy link* button and *Regenerate* (the old link stops working immediately).
2. **Employee** opens the link: 5 steps (Personal → Emergency → Bank → Agreement → Review). Each step validates before continuing (CNIC `12345-1234567-1`, required fields, etc.). The agreement must be scrolled to the end before the signature pad unlocks; the signature (mouse or touch) and the "I agree" tick are required to submit. A link can be submitted only once.
3. **Admin → Team → Onboarding Requests** lists submissions (Pending / Approved / Rejected). *Review* shows every field (editable), the photo, the signature and the agreement exactly as signed.
   - **Approve** updates the employee profile with the submitted details (it appears in Employees immediately), creates the employee-portal login with the submitted email and shows a **temporary password once**, and the joining-month pro-rata is calculated from the start date (same helper as the Salary tab).
   - **Reject** marks it rejected with an optional reason.
4. **Admin → System → Settings → Employment Agreement Template.** Rich-text editor with placeholders `{{employee_name}}`, `{{designation}}`, `{{salary}}`, `{{start_date}}`, `{{probation_period}}`, a probation length (default 3 months) and a Preview. Edits apply to **future links only**: each link snapshots the template when generated, and each submission stores the rendered text the employee signed (`agreement_version` = template version).

**Data** (`worker/migrations/0007_onboarding.sql`): `onboarding_tokens`, `onboarding_submissions`, `agreement_template`. Apply with `npm run db:migrate`, then redeploy the Worker (`npm run deploy:api`) and the Pages site.

**Security notes**: tokens are 256-bit random values; the two public endpoints (`GET /api/onboarding/:token`, `POST /api/onboarding/:token/submit`) are the only unauthenticated routes, are origin-restricted by `ALLOWED_ORIGINS` and rate-limited per IP on bad tokens; all input is re-validated server-side, the agreement HTML is sanitised on save and placeholder values are escaped. The page sends no referrer and is `noindex`.

## Mobile

All three portals (admin, employee, client), the login page and the onboarding form are phone-ready. Breakpoints: mobile < 768px, tablet 768–1024px, desktop > 1024px (below ~900px the sidebar becomes a slide-over drawer).

- **Shared layer:** `public/mobile.css` + `public/mobile.js` (loaded by each portal). Everything phone-specific sits inside a `max-width:767px` media query, so desktop is untouched. `viewport-fit=cover` and `interactive-widget=resizes-content` are set on every page so the keyboard doesn't push content off-screen; the chat uses `visualViewport` so the input stays above the keyboard.
- **Navigation:** hamburger → drawer with ✕ and a dimmed overlay; bottom tab bar — admin *Home · Tasks · Finance · Team · More* (Finance/Team open quick sheets), employee *Home · Tasks · Chat · Profile*, client *Dashboard · Invoices · Projects · Messages*. Swipe right from the left edge goes back (closes a modal / task panel / chat, or opens the drawer).
- **Tables → cards** (`.tablewrap`): each row becomes a card showing the key columns; tap the card (or ▾) for the rest. **Modals** are full-screen with a ✕ at the top right.
- **Tasks:** board shows one column at a time (swipe or tap the column tabs, each with its count); list shows Name + Status + Due; calendar is a week view with ‹ › week navigation; task detail is a full-screen slide-up.
- **Chat:** conversation list → full-screen chat with a back arrow (employee also has a Channels / Direct Messages switch).
- **Client portal** gained a Dashboard (totals, coming up, recent invoices); invoice cards open a full-screen detail sheet.
- 44px minimum tap targets and 16px inputs (no iOS zoom on focus) on phones.

## Ad Copy Studio

✍️ **Ad Copy Studio** (sidebar → Work → 📢 Ads Manager → ✍️ Ad Copy) writes Facebook / Instagram ad copy for the Pakistani market with Claude. Admins and employees only — clients never see it and `/api/ai/*` returns 403 for them.

- **Generate:** paste the product link (the Worker fetches and extracts the page text), write a brief, pick English / Urdu / Hinglish and Market / Premium style, optionally link a client → 3 headlines, 3 primary texts, 3 descriptions. Every result has **✅ Use This** (copies to the clipboard and saves it as preferred), **❌ Not This** and **⭐ Save**; plus **🔄 Regenerate All** and **💾 Save All**. Tabs: *Generate · Saved Copies* (filter by client / type / language) *· History* (last 20 generations).
- **Preference learning:** ✅/❌ choices are stored per user in `ad_preferences`. After 5+ choices the Worker extracts patterns (short vs long, emoji-heavy vs clean, Urdu script vs Roman, price mention, emotion- vs feature-led, bullets) plus recent approved/rejected examples and injects them into the system prompt's `{PREFERENCE_CONTEXT}`.
- **Setup:** run `npm install` (adds `@anthropic-ai/sdk`), `npm run db:migrate` (`0009_ad_studio.sql`), `npm run deploy:api`. Then **Admin → Settings → AI Settings** → paste the Claude API key and pick default language / style / model (default `claude-opus-5-5`; `claude-sonnet-5-5` is cheaper). The key can alternatively be a Worker secret — `npx wrangler secret put CLAUDE_API_KEY` — which takes precedence. A key saved in Settings lives in the `ai_settings` table, is writable only by admins and is never returned to employees (admins only see a masked hint). Without a key the studio shows "Add your Claude API key in Settings to use Ad Copy Studio".
- **API:** `POST /api/ai/generate-copy`, `POST /api/ai/preference`, `GET /api/ai/preferences`, `GET /api/ai/saved-copies`, `POST /api/ai/fetch-url`, plus `GET /api/ai/config`, `PUT /api/ai/settings`, `POST /api/ai/save-copy`, `GET /api/ai/history`, `GET /api/ai/generation/:id`.
- **Safety:** product links must be public `http(s)` pages (localhost / private / link-local addresses, credentials in the URL and non-standard ports are refused, redirects are re-checked, fetch is capped at ~1.5 MB / 9 s). Fetched page text is passed to Claude as reference data only. Generation is limited to 40 per user per hour. If a page can't be read (bot-blocking, JavaScript-only), the copy is generated from the brief and the user is told.
- **Testing without a key:** set `CLAUDE_API_BASE` (e.g. in `worker/.dev.vars`) to point the Worker at a mock server.

## Ads Manager → Campaign Builder

📢 **Ads Manager** (sidebar → Work; admin + employee only) has two tabs: **✍️ Ad Copy** (the Ad Copy Studio above) and **🚀 Campaign Builder**.

- **Input:** hold the big 🎤 to speak (release to send; or tap once to start and tap again to send) or type a chat command. Voice uses the browser's Web Speech API (Chrome / Edge, free). Browsers can't auto-detect the spoken language, so pick English / اردو / Hinglish before speaking — Claude understands all three, and the live transcript is shown as you speak.
- **Claude builds the whole campaign** (objective, budget, dates, audience, interests, behaviours, headline / primary text / description, format, placements, language) with the Campaign Builder system prompt in `worker/src/ai.js` (`CAMPAIGN_PROMPT`), plus a summary and 3 suggestions. Values are validated server-side (enums, ranges, start date ≥ today in Pakistan time).
- **Edit:** ✏️ Edit makes every field editable inline, or keep talking/typing follow-ups ("Change budget to 1000", "Add Lahore", "Make copy more emotional"). Only the affected fields change and the card shows what changed ("Updated: Daily budget ₨ 500 → ₨ 1,000").
- **Save / history / reuse:** 💾 Save Draft stores it in `campaigns` (`0010_campaigns.sql`) with the original instruction (`voice_input` or `text_input`); History lists date, client, name, budget and status with Open / Duplicate / Delete. Pick a client at the top to link it — linked campaigns also appear on that client's profile in Clients.
- **🚀 Launch in Meta:** opens https://adsmanager.facebook.com/ in a new tab, copies complete step-by-step setup instructions to the clipboard and marks the campaign *Launched*. A web page cannot drive your browser, so the auto-fill step is done by **Claude in Chrome**: paste the instructions into it on the Ads Manager tab. The instructions tell it to fill objective, name, budget, dates, audience, copy and placements, stop at the final Review screen, and never click Publish. Nothing is created in Meta until you publish it yourself.
- **API:** `POST /api/ai/campaign/build`, `POST /api/ai/campaign` (create/update), `GET /api/ai/campaigns`, `GET|DELETE /api/ai/campaign/:id`, `POST /api/ai/campaign/:id/duplicate`, `POST /api/ai/campaign/:id/launch`. Employees see their own campaigns; admins see everyone's. Requires the Claude API key from *Settings → AI Settings*.
- **Deploy:** `npm run db:migrate` (0010) → `npm run deploy:api` → deploy `public/`.
