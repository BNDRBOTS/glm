# GLM Power Platform — Setup Guide

This is the dummy-proof version. Follow it top to bottom. You will not touch code.

---

## What you're getting

A cloud-deployed chat platform that:

- Looks like the clean interface you already know
- Talks to GLM 5.2 (peak reasoning, full token limits, no kick-down)
- Has a quick-model switcher (GLM 5.1, GLM 5.1 Flash — no 4.x models)
- Two fully separate accounts with their own logins
- Groups that link ONLY those accounts, nothing else
- Code canvas: HTML preview + React preview + back button
- Turn-by-turn JSON logging (context never drops mid-session)
- End-of-chat deep aggregate export (facts, entities, decisions)
- **6 connectors** (CourtListener, Midpage, Courtroom5, Notion, GitHub, Local FS) — drop-in API key pattern, all REAL implementations
- **5 backends** (Supabase, Neon, MongoDB, Firebase, Turso) — drop-in connection string, all REAL implementations (no stubs)
- **3 permissions modes** per chat (auto / plan / accept-edits)
- **Full-build-only toggle** — silent AI checker rejects placeholders, partials, diversions
- **Real-time intent distillation** — freezes your original ask, flags drift, never silently re-summarizes
- **Voice input** — real STT via Z.ai ASR (same key as GLM) + OpenAI Whisper fallback. Mic button in composer.
- **Skill system** — maker creates skills, accepter imports from JSON, reader applies to chat
- **Unified audit log** — every system event (chat, voice, connectors, backends, quality, distillation, billing, skills, auth, system) in one filterable panel
- **5 premade themes** (Obsidian, Graphite, Slate+Sage, Slate+Crimson, Slate+Cyan) — all WCAG AA contrast verified
- **Command palette** (Cmd+K) — every action one keystroke away
- **Token usage dashboard** — live stats from your GLM calls
- **REAL Stripe billing** (feature-flagged) — checkout + webhook + portal all wired. Set 4 env vars to go live.
- Dark mode = ultradeep #000000 with layered glassmorphism
- Light mode = Apple-clean white
- Custom SVG icons only — no emojis anywhere
- PWA — installs on your computer like a native app
- Mobile-first responsive throughout (including canvas + settings)
- Pinecone memory mesh slot ready (not built — by design)

---

## Step 1 — Get your GLM API key (5 minutes)

1. Go to https://z.ai (or https://open.bigmodel.cn if you're in China)
2. Sign in with your existing Z.ai account
3. Open the API / developer console
4. Create an API key
5. Pick the tier that gives you the rate limit you want
   (higher tier = no kick-down during peak hours)
6. Copy the key. You'll paste it in Step 3.

That key works for BOTH GLM chat AND voice input (Z.ai ASR). One key, two capabilities.

If you want OpenAI Whisper as a voice fallback (optional), get a separate key at https://platform.openai.com/api-keys.

---

## Step 2 — Push the code to GitHub (3 minutes)

1. Create a new repo on GitHub (private is fine).
2. Drag the contents of the `glm-power-platform/` folder into the repo.
   (Or use `git init && git add . && git commit -m "init" && git push`.)
3. Done.

---

## Step 3 — Deploy to Railway (5 minutes)

1. Go to https://railway.app and sign in with GitHub.
2. Click **New Project** → **Deploy from GitHub repo**.
3. Pick the repo you just created.
4. Railway auto-detects Next.js. Don't change anything in the build settings.
5. Click **Settings** → **Variables** and add these:

   | Variable | Value |
   |---|---|
   | `ZAI_API_KEY` | (paste your key from Step 1) |
   | `NEXTAUTH_SECRET` | (any long random string — use https://1password.com/password-generator) |
   | `NEXTAUTH_URL` | `https://YOUR-APP-NAME.up.railway.app` (Railway gives you this URL after first deploy) |
   | `INTEGRATION_ENCRYPTION_KEY` | (any long random string — `openssl rand -hex 32`) |
   | `ENABLE_DEMO_MODE` | (leave unset in production — unauthenticated requests get 401) |

6. Click **Settings** → **Add service** → **Database** → **PostgreSQL**.
   Railway creates it and sets `DATABASE_URL` automatically.
7. Open `prisma/schema.prisma` in your GitHub repo. Change line 27 from
   `provider = "sqlite"` to `provider = "postgresql"`. Save.
8. In Railway, click your app service → **Settings** → **Build** →
   set the build command to: `bun install && bun run db:push`
9. Click **Deploy**. Wait ~3 minutes.
10. Visit the URL Railway gives you. The app loads.

---

## Step 4 — Create your two accounts (1 minute)

The app starts with no users. To create the two starting accounts,
open Terminal on your computer and run these (replace with your
real emails and passwords):

```bash
curl -X POST https://YOUR-APP-NAME.up.railway.app/api/auth/seed \
  -H "Content-Type: application/json" \
  -d '{"email":"you@yourdomain.com","password":"your-password","name":"You","role":"OWNER"}'

curl -X POST https://YOUR-APP-NAME.up.railway.app/api/auth/seed \
  -H "Content-Type: application/json" \
  -d '{"email":"buddy@yourdomain.com","password":"buddy-password","name":"Buddy","role":"BUDDY"}'
```

That's it. Both accounts exist. Both are fully separate.

Once that's done, set `DISABLE_SEED=1` in Railway variables so nobody
else can create accounts via that endpoint.

---

## Step 5 — Drop in your connectors (whenever you want)

Open the app → click the **Connectors** button in the sidebar.
You'll see 6 connectors grouped by category:

**Legal Research:**
- **CourtListener** — free case law search. Token optional (raises rate limits).
- **Midpage** — legal citation analysis. Paste your API key.
- **Courtroom5** — casework management. Paste your API key.

**Productivity:**
- **Notion** — workspace integration.

**Dev:**
- **GitHub** — repos, files, search.
- **Local FS** — direct computer access (set `LOCAL_FS_ROOT`).

For each: click → paste key/token → click **Connect**. Done.

---

## Step 6 — (Optional) Drop in a data backend

Open `POST /api/backends` from any HTTP client (or build a UI panel later).
All 5 backends have REAL implementations — actual query/push/list working.

```bash
# Example: connect Supabase
curl -X POST https://YOUR-APP.up.railway.app/api/backends \
  -H "Content-Type: application/json" \
  -d '{
    "backendId": "supabase",
    "credentials": {
      "url": "https://xxxx.supabase.co",
      "anonKey": "eyJhbGciOi..."
    }
  }'

# Example: connect Neon
curl -X POST https://YOUR-APP.up.railway.app/api/backends \
  -H "Content-Type: application/json" \
  -d '{
    "backendId": "neon",
    "credentials": {
      "connectionString": "postgresql://user:pass@host/db?sslmode=require"
    }
  }'
```

The 5 backends and their required fields:
- **Supabase**: `url`, `anonKey`
- **Neon**: `connectionString` (postgresql://...)
- **MongoDB**: `connectionString` (mongodb+srv://...)
- **Firebase**: `serviceAccount` (full JSON)
- **Turso**: `url`, `authToken`

All free tiers. All drop-in. All REAL — no stubs.

---

## Step 7 — (Optional) Enable Stripe billing

Set these 4 env vars in Railway:

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_TEAM=price_...    # from Stripe Dashboard
STRIPE_PRICE_PRO=price_...     # from Stripe Dashboard
```

Then:
1. In Stripe Dashboard, create products for Team ($29/mo) and Pro ($49/mo)
2. Copy the price IDs into the env vars above
3. Create a webhook endpoint pointing to `https://YOUR-APP/api/billing/webhook`
4. Subscribe to events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
5. Copy the webhook signing secret into `STRIPE_WEBHOOK_SECRET`

Done. Checkout, subscription management, and webhook handling all work.

Without these env vars, billing routes return `{ notConfigured: true }` gracefully. App still works fine.

---

## Step 8 — Install it as a native app (optional, recommended)

On your computer:

1. Open the app URL in Chrome / Edge / Safari
2. Click the install icon in the address bar (or menu → Install app)
3. It now lives in your dock / start menu like a real Mac/PC app
4. No browser chrome. No address bar. Apple-grade feel.

---

## Using the new features

### Voice input (mic button in composer)
Click the mic button (or tap "Voice"). Browser asks for mic permission. Speak. Click stop. Audio is sent to Z.ai ASR (same key as GLM) and transcribed text appears in the composer.

If Z.ai ASR fails, automatically falls back to OpenAI Whisper (if `OPENAI_API_KEY` is set).

### Skills (sidebar → Skills)
Three tabs:
- **Library** — list of your skills. Apply / Export / Delete each.
- **Maker** — create a skill: name, description, system prompt, default mode, full-build-only, triggers (comma-separated phrases)
- **Accepter** — paste a skill JSON to import

When you apply a skill, its system prompt is prepended to every GLM call, and its mode + full-build-only settings become the chat defaults.

Export a skill to share it. Anyone can import it via the Accepter tab.

### Audit log (sidebar → Audit log)
Unified log of every system event:
- chat completions, errors
- voice transcriptions (success + failure)
- connector + backend calls
- quality checker (slop detections, retries, warnings)
- skill events (created, imported, applied, deleted)
- billing events (Stripe webhooks)
- auth events
- system events

Filter by source (10 categories) + level (info/warn/error/debug). Click any entry to expand the JSON payload. Export all logs as JSON. Prune old entries (keeps last 10K per user).

### Theme switcher (sidebar → Theme)
5 premade themes. All black/gray/charcoal base + 2-4 accent colors. All pass WCAG AA contrast. Click any theme to apply instantly — persisted to localStorage.

### Mode picker (top bar)
Click "Auto" to switch between:
- **Auto** — AI does everything. Slop checker still gates.
- **Plan** — AI plans first. You approve before execution.
- **Accept Edits** — AI proposes diffs. You accept each.

### Full-build-only toggle
In the mode picker dropdown. When on, the silent AI checker rejects any output containing:
- TODO/FIXME markers
- Placeholder tags (`<placeholder>`)
- Empty function bodies
- "throw new Error('not implemented')"
- Ellipsis truncation
- Fake imports (made-up package names)
- Meta-heavy-no-substance output (mostly "I would…" with no actual doing)

If the AI's first attempt fails, it gets retried with specific feedback. Up to 2 retries. If still failing, output is delivered with a warning toast.

### Intent drift badge (top bar, next to chat title)
Shows live % alignment between the conversation and your original ask. Turns amber < 70%, red < 40%, and shows "drift" tag if recent turns dropped below 30%.

Click it to expand — see entity/fact/decision counts being tracked in real-time.

### Command palette (Cmd+K)
Press Cmd+K (or click the ⌘K button) to open. Search and run:
- New chat
- Toggle light/dark
- Open theme switcher
- Open canvas / connectors / skills / audit log / dashboard / exports
- Switch modes
- Toggle full-build-only

### Token dashboard (sidebar)
Click "Token dashboard" to see:
- Total tokens used
- Request count
- By-model breakdown
- Recent calls with chat titles

---

## Running tests

```bash
bun run tests/index.ts
```

56 tests cover:
- Models catalog (no 4.6, has 5.1 + flash)
- Connectors registry (6 connectors, CourtListener + Midpage manifests)
- Backends registry (5 backends, Supabase required fields)
- Permissions modes (auto/plan/accept-edits, full-build-only rejects slop)
- Slop detector (TODO markers, empty bodies, placeholders, meta-heavy output, clean code passes)
- Distillation (intent freezing, entity extraction, alignment scoring, drift detection, fact accumulation)
- Quality checker (clean passes, sloppy retries, budget exhaustion)
- Themes (5 premade, default obsidian, 4 accents per theme, valid hex)
- WCAG contrast (black/white 21:1, gray fails AA, all required pairs pass)
- Voice (module loads, throws without key)
- Skills (trigger matching, disabled skills skipped)
- Audit log (writes without throwing, swallows errors)
- Stripe (not configured returns structured response, 3 plans, power is free)

---

## If something breaks

- **"Preview mode" banner won't go away**: your `ZAI_API_KEY` is missing or wrong. Recheck Step 3.
- **Login fails**: you didn't run Step 4, or `DISABLE_SEED` is set to 1.
- **401 on chat**: you didn't set `ENABLE_DEMO_MODE=1` in dev. In production, sign in first.
- **Voice button does nothing**: browser blocked mic permission. Allow mic access in browser settings. Or set `OPENAI_API_KEY` for Whisper fallback.
- **Dark mode looks wrong**: clear your browser cache; the theme is stored in localStorage.
- **Streaming stalls**: Railway free tier has cold starts. Upgrade or use the Railway hobby plan.
- **CourtListener 403**: their API rate-limits anonymous requests. Set `COURTLISTENER_API_TOKEN` for higher limits.
- **Backend testConnection fails**: check the connection string format. Neon needs `postgresql://`, MongoDB needs `mongodb+srv://`, Turso needs `libsql://`.
- **Stripe checkout returns notConfigured**: set `STRIPE_SECRET_KEY` + `STRIPE_PRICE_*` env vars.
- **Tests fail locally**: run `bun run tests/index.ts` directly.

---

That's the whole setup. You're now running a power-user GLM platform
on Railway, with your API key, peak model, full tokens, voice input,
connectors, backends (real implementations), permissions, quality
checker, distillation, skills, audit log, themes, command palette,
dashboard, real Stripe billing, and every future expansion already
stubbed in.

---

## RAG document intelligence (merged from ragdb)

Chat with your documents. Upload PDFs, Word docs, spreadsheets, or plain
text — the platform chunks, embeds, and indexes them, and every
RAG-enabled turn performs a live similarity search and answers with
numbered, cited sources.

### Zero-setup mode (works right now)

Do nothing. With no keys at all, RAG runs on deterministic **local hash
embeddings** (256-dim, lexical-overlap grade — honest dev quality,
labeled as `local` in the Documents panel and `/api/session`). Upload a
file in the **Documents** panel (sidebar or ⌘K → "Open documents"), ask
a question, watch the source chips appear.

### Production mode (one key)

Set `OPENAI_API_KEY` in the environment — RAG upgrades to
`text-embedding-3-small` (1536-dim semantic vectors) automatically.
No OpenAI key? Your existing `ZAI_API_KEY` also works
(`RAG_EMBEDDINGS_PROVIDER=zai` or just leave it on `auto`).

**Important**: documents remember which provider embedded them. If you
add a key later, re-upload documents you want on the better provider
(mixed-provider libraries still work — each group is searched in its
own vector space).

### DeepSeek models (optional)

Set `DEEPSEEK_API_KEY` (https://platform.deepseek.com) and the model
picker gains **DeepSeek Reasoner** (visible thinking trace, great on
documents + math) and **DeepSeek Chat**. Reasoning tokens stream into a
collapsible "View reasoning" panel on each answer.

### pgvector accelerator (optional, large corpora)

For tens of thousands of chunks, mirror vectors into a Supabase
pgvector HNSW index:

1. Run `supabase/rag/101_rag_pgvector.sql` in the Supabase SQL editor.
2. Set `RAG_DRIVER=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
3. Use the `openai` or `zai` embedding provider (1536-dim).

If the accelerator ever fails, retrieval silently falls back to the
local driver (audited) — chat never breaks.

### Attach-and-ask (no Documents panel needed)

Attaching a PDF/DOCX/XLSX/TXT/MD to a chat message auto-indexes it
before the model answers — the same turn can already cite it. The file
also appears in the Documents panel afterward. Re-sending the same
file is deduped. Chat attachments cap at 10 MB; the Documents panel
accepts up to 50 MB.

### Verifying your install

```bash
bun run test   # 95 unit tests — no server, no keys
bun run e2e    # 57 live checks — boots the dev server itself, no keys
```

The e2e run covers ingestion of all four formats, cited retrieval,
attachment auto-ingest, real signup/sign-in, two-user isolation, and a
server restart that proves persistence + pgvector fallback.

### RAG troubleshooting

- **"Docs" toggle seems to do nothing**: you have no documents in
  `ready` status. Open Documents and check for `error` states — the
  failure reason is shown inline.
- **Upload returns 422**: unsupported type. Allowed: PDF, DOCX, XLSX,
  TXT, MD (50 MB max).
- **Answers don't cite sources**: no chunk cleared the 0.3 similarity
  threshold for that question. On `local` embeddings this is common
  for paraphrased questions — add `OPENAI_API_KEY` for semantic
  retrieval.
- **pgvector mode not activating**: `RAG_DRIVER=supabase` requires BOTH
  `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; otherwise the
  platform stays on `local` (check `/api/session` → `rag.driver`).
