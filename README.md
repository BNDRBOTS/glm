# GLM Power Platform

A power-user chat platform for GLM 5.2 — full token limits, maximum reasoning, no kick-down. Built for someone who works with AI 48 hours at a time and needs the real thing.

## What this is

A cloud-deployed chat platform with: GLM 5.2 streaming, two isolated accounts, code canvas, turn-by-turn JSON logging, 6 connectors, 5 backends (all REAL implementations), 3-mode permissions, silent AI slop checker, real-time intent distillation, voice input (Z.ai ASR + Whisper fallback), skill system (maker/accepter/reader), unified audit log, 5 premade themes (WCAG-tested), command palette, token dashboard, and REAL Stripe billing (feature-flagged).

## Stack (the correct way, not the basic way)

- **Next.js 16** (App Router, Turbopack)
- **TypeScript 5** strict throughout
- **Tailwind CSS 4** with custom design tokens
- **shadcn/ui** components (New York style)
- **Prisma 6** with SQLite (dev) / PostgreSQL (Railway prod)
- **NextAuth.js** credentials provider — two isolated accounts
- **Zustand** for client state
- **react-markdown** + **react-syntax-highlighter** for chat rendering
- **Lucide icons + custom SVGs** — NO emojis anywhere
- **PWA** manifest — installs like a native app
- **Bun** as runtime + test runner
- **Real SDKs**: pg, mongodb, @libsql/client, firebase-admin, stripe, @stripe/stripe-js, openai (all lazy-loaded)

## What works right now (browser-verified)

### Chat core
- Chat with GLM 5.2 streaming (mock stream until you add an API key)
- Quick-model switcher — GLM 5.1, GLM 5.1 Flash (no 4.x models)
- File upload UI
- Turn-by-turn JSON logging — every turn persisted to DB
- **Voice input** — real STT via Z.ai ASR (same key as GLM) + OpenAI Whisper fallback. Mic button in composer with live recording state.

### Connectors (6 adapters, REAL implementations)
- **CourtListener** — free case law search (Free Law Project)
- **Midpage** — legal citation analysis
- **Courtroom5** — casework management
- **Notion** — workspace + pages (REST API, real search/fetch/list)
- **GitHub** — repos, files, search (real REST API)
- **Local FS** — direct computer access (path-traversal protected)
- Drop-in: paste API key → click Connect → done

### Backends (5 adapters, REAL implementations — no stubs)
- **Supabase** — Postgres + Auth + Storage (REST API)
- **Neon** — serverless Postgres (real `pg` driver, lazy-loaded)
- **MongoDB Atlas** — document DB (real `mongodb` driver, lazy-loaded)
- **Firebase** — Firestore (real `firebase-admin` SDK, lazy-loaded)
- **Turso** — libSQL at the edge (real `@libsql/client`, lazy-loaded)
- All implement real `testConnection`, `query`, `push`, `list`
- Same drop-in pattern. Stored encrypted at rest.
- Heavy SDKs lazy-loaded inside function bodies — fast cold starts, test-runner-friendly

### Permissions (3 modes per chat)
- **Auto** — AI executes end-to-end. Slop checker still gates delivery.
- **Plan** — AI must produce a plan first. You approve before execution.
- **Accept Edits** — AI proposes edits as diffs. You accept each one.
- **Full-build-only** toggle — silent checker rejects placeholders, partials, diversions regardless of mode

### Silent AI quality checker
- Runs after every assistant turn (when full-build-only is on)
- Detects: TODO markers, placeholders, empty function bodies, "not implemented" throws, ellipsis truncation, fake imports, meta-heavy-no-substance output
- Retries AI with specific feedback (up to 2 retries by default)
- If budget exhausted, delivers with warning + logs to AuditLog
- Intent drift detection: re-runs AI if output drifts from original ask

### Real-time distillation
- Freezes intent from your first message — never abstracted away
- Extracts entities, facts, decisions, action items, open questions in real-time
- Per-turn intent alignment score
- Flags drift when recent turns drop below 0.3 alignment
- Intent Drift Badge in header shows live alignment %

### Skills (maker + accepter + reader)
- **Maker** — create skills via form (name, system prompt, mode, full-build-only, triggers, allowed connectors/backends)
- **Accepter** — import skills from JSON (paste or upload). Validates structure.
- **Reader** — apply skills to current chat. Applies system prompt + mode + FBO settings.
- **Export** — share skills as JSON
- Stored in `Skill` table, owned per user
- Trigger matching: UI suggests skills when trigger phrases appear in user input

### Voice input
- **Z.ai ASR** (primary) — uses same `ZAI_API_KEY` as GLM. No extra setup.
- **OpenAI Whisper** (fallback) — set `OPENAI_API_KEY` to enable
- Records via MediaRecorder API (webm/opus — best quality per byte)
- Live recording state with seconds counter
- Graceful fallback: if Z.ai ASR fails, automatically tries Whisper
- Clear error toasts for: mic denied, no mic, no API key
- All transcriptions logged to AuditLog

### Unified audit log
- Single `AuditLog` table — every system event writes here
- Sources: chat, voice, connector, backend, quality, distillation, billing, skill, auth, system
- Levels: info, warn, error, debug
- Filterable by source + level
- Click any entry to expand JSON payload
- Export all logs as JSON
- Auto-prune keeps last 10K per user

### Command palette (Cmd+K)
- 13 actions across 3 groups: Chat, View, Tools, Mode
- New chat, toggle theme, open theme switcher, open canvas/connectors/skills/audit/dashboard/exports
- Switch modes (auto/plan/accept-edits)
- Toggle full-build-only

### Token usage dashboard
- Total tokens, requests, prompt/completion breakdown
- By-model bar chart
- Recent calls list with chat titles
- Reads from `UsageLog` table — same data Stripe billing will consume

### Theme system (5 premade, WCAG-tested)
- **Obsidian** — pure black + neutral white (default, no accent)
- **Graphite** — charcoal + warm amber (Sony-bold)
- **Slate + Sage** — deep slate + muted sage (calm)
- **Slate + Crimson** — deep slate + crimson (premium)
- **Slate + Cyan** — deep slate + electric cyan (technical)
- All: black/gray/charcoal base + 2-4 accent colors only
- All pass WCAG AA contrast (verified by automated test, 8 color pairs)
- Persisted to localStorage, applied via CSS variables
- Switch instantly via Theme panel in sidebar

### Canvas
- HTML editor + live preview (sandboxed iframe)
- React tab with esm.sh React 19 import
- Snapshot history with back button
- Mobile-responsive (was desktop-only — fixed)

### Exports
- Raw chat export — every message verbatim as JSON
- Deep aggregate export — facts, entities, decisions, action items, open questions

### Stripe billing (REAL implementation, feature-flagged)
- `stripe` SDK installed and wired
- Real `createCheckoutSession`, `createPortalSession`, `constructWebhookEvent`, `handleWebhookEvent`
- 3 plans: Power (free), Team ($29/mo), Pro ($49/mo)
- Webhook route at `/api/billing/webhook` with real signature verification
- Checkout route at `/api/billing/checkout`
- Portal route at `/api/billing/portal`
- Feature-flagged: if `STRIPE_SECRET_KEY` unset, all routes return `{ notConfigured: true }` gracefully — app still works
- To go live: set 4 env vars, create products in Stripe Dashboard, done

### Design
- Theme toggle: dark `#000000` glassmorphism + Apple-clean light
- Custom SVGs everywhere — zero emojis
- PWA — installs to dock/start menu
- Mobile-first responsive throughout

## AI weak points fixed (cumulative across iterations)

1. **Security hole**: `/api/chat` had `userId ?? "demo-user"` fallback. Now gated behind `ENABLE_DEMO_MODE=1` env var.
2. **CORS / allowedDevOrigins**: dev log warning fixed via `next.config.ts`.
3. **Stream abort handling**: client navigating away cancels server stream via `AbortController`.
4. **`server-only` package**: replaced with testing-friendly `lib/server-guard.ts`.
5. **Slop in backends**: 4 files had "install X then uncomment" stubs. All rewritten with REAL implementations using lazy-loaded SDKs.
6. **Slop in Stripe**: 2 stub functions. Rewritten with REAL SDK calls, feature-flagged.
7. **Distillation field name mismatch**: `overallAlignment` vs `alignment` caused NaN badge. Fixed.
8. **UsageLog missing Chat relation**: dashboard query crashed. Schema fixed.
9. **firebase-admin transitively needs @opentelemetry/api**: installed.
10. **Missing skills + distillation API routes**: the UI called `/api/skills`, `/api/skills/[id]`, `/api/skills/[id]/export` and the README promised `/api/distillation` — none existed. All four restored; the intent-drift badge now also survives reloads by refetching server-side state.
11. **Chat context truncation**: history loaded the *oldest* 40 messages, so chats past 40 turns never showed the model recent context — including the message just sent. Now loads the most recent 40.
12. **Password reset token stored raw in DB**: defeated the hash-at-rest design; a DB leak was an account-takeover kit. Only the SHA-256 hash is stored now (raw token exists only in the email).
13. **Sign-in brute force unprotected**: the rate-limit bucket covered `/api/auth/signin`, but NextAuth credentials sign-in actually POSTs to `/api/auth/callback/credentials`. Bucket added for the real path (verified live: 429 after 5 attempts/min).
14. **Per-user rate limiting silently broken**: middleware tried to decode the session cookie as a 3-part JWT, but NextAuth v4 issues a 5-part encrypted JWE — the parse always failed and every "user"-scoped limit degraded to per-IP. Now keys by a SHA-256 fingerprint of the session cookie.
15. **Attachments stored under `.next/`**: every rebuild deleted all user uploads. Moved to `data/attachments` (set `ATTACHMENTS_DIR` to a mounted volume in prod). Files are also cleaned up when a chat or account is deleted — previously they leaked forever.
16. **Path-boundary checks used `startsWith`**: `/data/attachments-evil` passed the check for root `/data/attachments`. Both attachment storage and the Local FS connector now use proper `path.relative` containment.
17. **Aborted/errored streams lost data**: client disconnect or stream error left an empty assistant row in the transcript and dropped every streamed token. Partial output is now persisted with a `truncated` turnLog marker; rows that never received content are removed.
18. **Memory journal hardening**: assistant turns were misattributed to the user in MemoryLog payloads, a null author would have violated the User foreign key, and a journal failure crashed the whole turn. Owner/author are now recorded separately and journal failures degrade to an audit-log entry.
19. **Audit auto-prune actually wired**: the 10K-per-user cap was only enforced if someone manually hit DELETE /api/audit. ~1 in 500 writes now triggers a background per-user prune.
20. **Group privilege boundary**: any MEMBER could add members and even grant ADMIN. Adding members now requires OWNER/ADMIN; granting ADMIN requires OWNER. Deleting your account no longer strands memberless orphan groups.
21. **Build required production secrets**: `next build` evaluated the NextAuth config and threw without `NEXTAUTH_SECRET`, breaking CI builds. The fail-fast now happens at server boot instead (`NEXT_PHASE` aware).
22. **`/api/chat` input hardening**: malformed JSON 500'd; unbounded text/base64 could exhaust memory before size checks ran. Now validated and capped up front. Client aborts also propagate to the upstream GLM request instead of burning tokens on a response nobody sees.

## Slots ready for later (not built — by design)

- **Pinecone memory mesh** — `extractDeep()` in `lib/memory/index.ts` is the single swap point.
- **Behavioral wrappers** — `applyWrappers()` in `lib/ai/client.ts` is the hook. (Skills already use this via `systemPrefix`.)
- **More group members** — `GroupMember` already supports unlimited members.
- **Redis for distillation state** — current in-memory Map works for single-instance Railway.
- **Skill marketplace** — Skills can already be exported/imported as JSON. Marketplace UI is the only missing piece.

## Project structure

```
app/
  api/
    attachments/[id]/     — download an uploaded attachment (access-checked)
    audit/                — unified audit log query + prune
    auth/
      [...nextauth]/      — NextAuth credentials sign-in
      change-password/    — verify current + set new password
      delete-account/     — irreversible account deletion (email-confirmed)
      forgot-password/    — reset link (hash-at-rest tokens)
      reset-password/     — consume reset token
      seed/               — dev-only account bootstrap (404s in production)
      signup/             — self-service account creation
    backends/             — backend integration save/list
    billing/
      checkout/           — Stripe checkout session
      portal/             — Stripe customer portal
      webhook/            — Stripe webhook (real signature verification)
    canvas/[chatId]/      — canvas snapshot list/save
    chat/                 — streaming chat (quality checker + distillation + skills + audit)
    chats/                — list chats (paginated); [id]/ — load/rename/pin/delete
    connectors/           — connector save/list/test
    dashboard/            — token usage stats
    distillation/         — live distillation state (badge restore)
    exports/              — raw + aggregated export
    groups/               — groups CRUD; [id]/members — role-gated membership
    health/               — Railway healthcheck + dependency status
    session/              — session truth for the UI
    skills/               — list/create/import; [id]/ — CRUD; [id]/export — JSON export
    voice/transcribe/     — STT (Z.ai ASR + Whisper)
  layout.tsx              — root with ThemeProvider + PWA
  page.tsx                — the chat interface (everything wired)
  globals.css             — ultra-deep #000 dark + glassmorphism + Apple-clean light
components/
  chat/                   — message, composer (with mic), sidebar, container, mode-picker, command-palette, intent-drift-badge, theme-toggle
  chat/dashboard/         — token usage dashboard
  canvas/                 — code canvas panel
  integrations/           — connectors panel
  logs/                   — audit log panel
  skills/                 — skills panel (maker/accepter/reader)
  themes/                 — theme switcher
  theme-provider.tsx      — next-themes wrapper
  ui/                     — shadcn/ui components
hooks/
  use-voice-recorder.ts   — MediaRecorder hook
lib/
  ai/                     — GLM client + model catalog
  audit/                  — unified audit log (write/query/prune)
  auth/                   — NextAuth + password hashing + crypto
  backends/               — Supabase/Neon/MongoDB/Firebase/Turso REAL adapters
  billing/                — Stripe REAL implementation
  canvas/                 — canvas state + sandbox doc builder
  connectors/             — CourtListener/Midpage/Courtroom5/Notion/GitHub/LocalFS adapters
  distillation/           — real-time intent + entity/fact/decision extraction
  memory/                 — turn-by-turn JSON logging + deep aggregator
  permissions/            — auto/plan/accept-edits modes + slop detector
  quality/                — silent AI checker with retry orchestrator
  server-guard.ts         — testing-friendly server-only replacement
  skills/                 — skill maker/accepter/reader + trigger matching
  themes/                 — 5 premade themes + apply/load
  voice/                  — Z.ai ASR + OpenAI Whisper
  wcag.ts                 — WCAG 2.1 contrast calculator + audit
stores/
  chat-store.ts           — Zustand client state
tests/
  index.ts                — 71 smoke + sanity + WCAG + regression tests
  preload.ts              — Bun plugin for test environment
prisma/
  schema.prisma             — User, Chat, Message, Group, Integration, MemoryLog, UsageLog, CanvasState, Skill, AuditLog
public/
  icon.svg, manifest.webmanifest
.env.example                — every env var you need
railway.json                — Railway deploy config
next.config.ts              — allowedDevOrigins + security headers
bunfig.toml                 — Bun test config
SETUP-GUIDE.md              — dummy-proof step-by-step
```

## Running tests

```bash
bun run tests/index.ts
```

Runs 71 smoke + sanity + WCAG + regression tests covering:
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

## Quick start

1. Read `SETUP-GUIDE.md` top to bottom.
2. Short version: get a Z.ai API key → put it in `.env` → push to Railway → log in.

## Design principles enforced

- No emojis anywhere — every icon is a custom SVG or Lucide
- Dark mode = `#000000` background with layered glassmorphism
- Light mode = pure white canvas, refined neutrals
- Nike-smooth transitions on every interactive element
- PWA — installs to dock/start menu, no browser chrome
- Mobile-first responsive throughout (including canvas + settings)
- Server-only secrets (`lib/server-guard.ts`)
- Intent is never abstracted away — frozen from first user message
- Slop is never silently delivered — checker retries or warns
- Black/gray/charcoal base + 2-4 accent colors only — no rainbow palettes
- All themes pass WCAG AA contrast — verified by automated test
- Heavy SDKs lazy-loaded — fast cold starts, test-friendly
- Stripe is feature-flagged — app works without it, ready when you are
- Every system event logged to unified AuditLog
