# Butterfly Club

This package contains the public application experience plus a private human-review dashboard.

## Files

- `index.html` — public Butterfly Club site for GitHub Pages.
- `admin/index.html` — private review dashboard at `butterflyclub.ir/admin/`.
- `admin.html` — duplicate direct-file version, if you prefer `/admin.html`.
- `CNAME` — custom domain (`butterflyclub.ir`).
- `worker/worker.js` — Cloudflare Worker API.
- `worker/schema.sql` — fresh D1 schema.
- `worker/migrate_existing.sql` — migration if you already created the older D1 table.
- `worker/wrangler.toml` — Worker configuration.

## Flow

1. Visitor answers three questions.
2. OpenAI evaluates curiosity, originality, contribution, and specificity.
3. AI-rejected applications stop there.
4. AI-accepted applications are **shortlisted**, not finally accepted.
5. Shortlisted applicants provide name + phone.
6. You open `admin.html`, review their full answers and AI note, then click **Final Accept** or **Reject**.

## 1. Create D1

From the `worker` directory:

```bash
npx wrangler d1 create butterfly-club
```

Copy the returned database ID into `wrangler.toml`, replacing:

`REPLACE_WITH_YOUR_D1_DATABASE_ID`

For a fresh database:

```bash
npx wrangler d1 execute butterfly-club --remote --file=./schema.sql
```

If you already created the previous version of the database, do **not** recreate it. Run:

```bash
npx wrangler d1 execute butterfly-club --remote --file=./migrate_existing.sql
```

## 2. Add secrets

Never put these in GitHub or HTML.

```bash
npx wrangler secret put OPENAI_API_KEY
```

Paste your OpenAI API key when asked.

Then create a strong private access key for the admin dashboard:

```bash
npx wrangler secret put ADMIN_TOKEN
```

Paste a long random password/token that only you know.

For local development only, you can use `worker/.dev.vars`:

```text
OPENAI_API_KEY="YOUR_OPENAI_KEY"
ADMIN_TOKEN="YOUR_LONG_PRIVATE_ADMIN_TOKEN"
```

`.dev.vars` is ignored by git.

## 3. Deploy Worker

```bash
cd worker
npx wrangler deploy
```

Copy the resulting Worker URL, for example:

`https://butterfly-club-api.YOUR-SUBDOMAIN.workers.dev`

## 4. Connect the public site

In `index.html`, replace:

```js
const API_BASE_URL = "https://YOUR-WORKER.workers.dev";
```

with your real Worker URL.

Until you replace it, the public page runs in demo mode.

## 5. Connect the admin dashboard

You do not need to put the admin password inside the file.

Open `admin.html` in the browser and enter:

- your deployed Worker URL
- the same secret value you used for `ADMIN_TOKEN`

The dashboard stores the Worker URL in local storage and keeps the admin token only in session storage. Closing the browser session clears the token.

You can also replace this line in `admin.html` if you want your Worker URL pre-filled:

```js
const DEFAULT_WORKER_URL = "https://YOUR-WORKER.workers.dev";
```

## 6. GitHub Pages

Upload these to the root of the GitHub repository:

- `index.html`
- `admin/`
- `admin.html`
- `CNAME`

Then enable GitHub Pages and configure the DNS for `butterflyclub.ir`.

Your pages will be:

- Public application: `https://butterflyclub.ir/`
- Admin review: `https://butterflyclub.ir/admin/`

The admin page being publicly reachable is fine because its data endpoints require the private `ADMIN_TOKEN`. For stronger production protection later, you can additionally put Cloudflare Access in front of the admin page.

## Admin dashboard

The dashboard shows only AI-shortlisted applications by default and includes:

- applicant name
- phone number
- AI score
- AI internal note
- all three answers
- review status
- Final Accept / Reject buttons
- filters for Needs review / Approved / Rejected / All shortlisted

The public applicant never sees the AI reason or score.
