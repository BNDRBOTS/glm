# GLM Power Platform × RAG

A power-user chat platform for GLM 5.2 — full token limits, maximum reasoning, no kick-down — **merged with the RAG Chat document-intelligence platform (ragdb)**. Upload PDFs, Word docs, spreadsheets, or plain text; the platform chunks, embeds, and indexes them, and every RAG-enabled turn performs a live similarity search and answers with numbered, cited sources. Built for someone who works with AI 48 hours at a time and needs the real thing.

## What this is

A cloud-deployed chat platform with: GLM 5.2 + DeepSeek streaming (visible reasoning traces), **RAG document intelligence** (PDF/DOCX/XLSX/TXT/MD ingest → chunk → embed → cited retrieval), two isolated accounts, code canvas, turn-by-turn JSON logging, 6 connectors, 5 backends (all REAL implementations), 3-mode permissions, silent AI slop checker, real-time intent distillation, voice input (Z.ai ASR + Whisper fallback), skill system (maker/accepter/reader), unified audit log, 5 premade themes (WCAG-tested), command palette, token dashboard, and REAL Stripe billing (feature-flagged).

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
- **RAG parsers**: unpdf (serverless pdfjs), mammoth (docx), xlsx — all lazy-loaded
- **DeepSeek**: OpenAI-compatible streaming with `reasoning_content` thinking traces

## What works right now (browser-verified)

### Chat core
- Chat with GLM 5.2 streaming (mock stream until you add an API key)
- Quick-model switcher — GLM 5.1, GLM 5.1 Flash (no 4.x models) **+ DeepSeek Reasoner / DeepSeek Chat** (provider-grouped picker; each model routes to its own API)
- **Reasoning traces** — `reasoning_content` tokens (DeepSeek Reasoner and thinking-enabled GLM) stream as separate `thinking` events into a collapsible panel, persisted per message, never mixed into content
- File upload UI
- Turn-by-turn JSON logging — every turn persisted to DB
- **Voice input** — real STT via Z.ai ASR (same key as GLM) + OpenAI Whisper fallback. Mic button in composer with live recording state.

### RAG document intelligence (merged from ragdb)
- Upload PDF / DOCX / XLSX / TXT / MD (max 50 MB) via the Documents panel — drag & drop or browse
- Ingest pipeline: parse (unpdf / mammoth / xlsx / direct) → sentence-boundary chunking (512 tokens, 64 overlap) → batched embeddings (256/call) → per-user index
- **Embedding provider chain**: OpenAI `text-embedding-3-small` (primary, 1536-dim) → Z.ai `embedding-3` (same key as GLM, 1536-dim) → deterministic local hash embeddings (256-dim, zero keys — dev/preview grade, honestly labeled)
- **Dual retrieval drivers**: `local` (default — exact cosine over Prisma-stored vectors, SQLite + Postgres, zero infra) and `supabase` (optional pgvector HNSW accelerator, `m=16/ef_construction=64/ef_search=100`, auto-fallback to local on any failure)
- Every RAG turn injects matched chunks as numbered `[Source N]` excerpts with a citation instruction; the answer cites them and the UI renders source chips (title + similarity % + snippet on hover)
- **Docs toggle** in the composer — RAG on by default, no-ops instantly at zero documents
- **Attachment → RAG bridge**: attach a PDF/DOCX/XLSX/TXT/MD to a chat message and it auto-ingests BEFORE retrieval — the very turn it arrives on can cite it (ragdb's upload-then-ask flow collapsed into one step). Deduped by filename + size, gated by the Docs toggle, never fatal to the turn
- Document lifecycle: `processing → ready | error` with the failure reason surfaced in the library; deletes cascade chunks + stored file + pgvector mirror
- Multi-tenant isolation: every query scoped by the authenticated user id; no unscoped retrieval path exists; ragdb's original RLS/auth.uid() schema preserved under `supabase/migrations/`
- RAG works with the quality checker, mode gates, skills, and tool calls — retrieval context rides in the same system-prefix stack

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
4. **`server-only` package**: replaced with testing-friendly `src/lib/server-guard.ts`.
5. **Slop in backends**: 4 files had "install X then uncomment" stubs. All rewritten with REAL implementations using lazy-loaded SDKs.
6. **Slop in Stripe**: 2 stub functions. Rewritten with REAL SDK calls, feature-flagged.
7. **Distillation field name mismatch**: `overallAlignment` vs `alignment` caused NaN badge. Fixed.
8. **UsageLog missing Chat relation**: dashboard query crashed. Schema fixed.
9. **firebase-admin transitively needs @opentelemetry/api**: installed.

## Merge provenance — where every ragdb capability lives now

Nothing from either platform was dropped. Feature-by-feature mapping from the ragdb repository into this codebase:

| ragdb capability | Merged location | Notes |
|---|---|---|
| Sentence-boundary chunker (512/64) | `lib/rag/chunker.ts` | Ported intact, incl. verbatim-rebuild fallback for punctuation-light text |
| Parsers: unpdf / mammoth / xlsx / txt+md | `lib/rag/parsers/` | All lazy-loaded; extension fallback added for browsers that omit `.md` MIME |
| OpenAI `text-embedding-3-small` (batched) | `lib/rag/embeddings.ts` | Still primary; Z.ai + local fallbacks added so RAG never hard-fails |
| `match_chunks` pgvector/HNSW retrieval | `supabase/rag/101_rag_pgvector.sql` + `lib/rag/retriever.ts` | Same index geometry; adapted to NextAuth trust model; auto-fallback to local |
| Original RLS / `auth.uid()` schema + storage bucket | `supabase/migrations/` | Preserved byte-for-byte for the standalone Supabase-Auth flavor |
| `[Source N]` prompt assembly + citation instruction | `lib/rag/pipeline.ts` | Same wording; numbered excerpts, honest no-answer instruction |
| Upload → parse → chunk → embed → status lifecycle | `lib/rag/ingest.ts` + `/api/documents` | Same statuses (`processing/ready/error`), 50 MB cap, 256-batch embedding |
| DeepSeek streaming client (`deepseek-reasoner`) | `lib/ai/client.ts` + `lib/ai/models.ts` | Now a first-class provider next to GLM; + `deepseek-chat` |
| Strict-alternation message builder | `buildProviderMessages()` in `lib/ai/client.ts` | Same merge semantics; also folds tool/system turns |
| Thinking-trace streaming + panel | `thinking` SSE events + `ThinkingPanel` in `components/chat/message.tsx` | Restyled to glass design; also surfaces GLM's own reasoning |
| Source chips on answers | `SourcesRow` in `components/chat/message.tsx` | Title + similarity % + snippet on hover, persisted per message |
| Documents library UI (upload zone + list) | `components/documents/documents-panel.tsx` | Drag & drop, status dots, chunk counts, delete |
| `X-Accel-Buffering: no`, `maxDuration = 300` | `/api/chat`, `/api/documents` | SSE + long-ingest hardening ported |
| Multi-tenant isolation | userId-scoped Prisma queries + server-only pgvector RPC | No unscoped retrieval path exists (tested); two-user isolation proven live by `bun run e2e` |
| Tuning constants co-located with code | `lib/rag/*` (see RAG tuning table) | ragdb convention kept |
| Upload-then-ask UX | Attachment → RAG bridge in `/api/chat` | Collapsed into ONE step: attaching a supported file makes it citable on the same turn |

### The ragdb login defect — root cause and resolution

ragdb's README promised "Supabase Auth (email/password)", but both auth pages
implemented **magic-link OTP only** (`signInWithOtp`) — no password path
existed. Sign-in therefore depended on (1) email delivery, which Supabase's
built-in sender rate-limits severely without custom SMTP, and (2) same-browser
PKCE state: opening the emailed link on another device/browser makes
`exchangeCodeForSession` fail. The error page mapped `reason` codes the
callback never set, so every failure surfaced as "an unexpected authentication
error". Net effect: users frequently could not log in, with no diagnosable
cause.

The merged platform resolves the defect **structurally**: NextAuth credentials
auth (bcrypt-style hashed passwords, JWT sessions) — zero email dependency,
zero cross-device state, plus per-IP signup/sign-in rate limiting and explicit
error surfaces. Proven live by `bun run e2e` phase B: signup → CSRF →
credentials callback → session cookie → per-user data access, wrong-password
rejection, and two-user isolation — with no email infrastructure configured at
all. (Magic-link support can still be added later as an additional NextAuth
provider; it is not a load-bearing dependency anywhere.)

## Slots ready for later (not built — by design)

- **Pinecone memory mesh** — `extractDeep()` in `src/lib/memory/index.ts` is the single swap point.
- **Behavioral wrappers** — `applyWrappers()` in `src/lib/ai/client.ts` is the hook. (Skills already use this via `systemPrefix`.)
- **More group members** — `GroupMember` already supports unlimited members.
- **Redis for distillation state** — current in-memory Map works for single-instance Railway.
- **Skill marketplace** — Skills can already be exported/imported as JSON. Marketplace UI is the only missing piece.

## Project structure

```
src/
  app/
    api/
      auth/seed/            — create the two starting accounts
      audit/                — unified audit log query + prune
      backends/             — backend integration save/list
      billing/
        checkout/           — Stripe checkout session
        portal/             — Stripe customer portal
        webhook/            — Stripe webhook (real signature verification)
      chat/                 — streaming chat (quality checker + distillation + skills + audit)
      connectors/           — connector save/list/test
      dashboard/            — token usage stats
      distillation/         — live distillation state
      documents/            — RAG library: list + upload (multipart)
        [id]/               — RAG document detail + delete
      exports/              — raw + aggregated export
      health/               — Railway healthcheck
      integrations/         — legacy (routes to connectors)
      skills/
        [id]/               — skill CRUD
          export/           — skill JSON export
      voice/transcribe/     — STT (Z.ai ASR + Whisper)
    layout.tsx              — root with ThemeProvider + PWA
    page.tsx                — the chat interface (everything wired)
    globals.css             — ultra-deep #000 dark + glassmorphism + Apple-clean light
  components/
    chat/                   — message, composer (with mic), sidebar, container, mode-picker, command-palette, intent-drift-badge, theme-toggle
    chat/dashboard/         — token usage dashboard
    canvas/                 — code canvas panel
    documents/              — RAG library panel (upload zone + list)
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
    rag/                    — merged RAG engine (chunker, parsers, embeddings,
                              similarity, retriever, pipeline, ingest)
    server-guard.ts         — testing-friendly server-only replacement
    skills/                 — skill maker/accepter/reader + trigger matching
    themes/                 — 5 premade themes + apply/load
    voice/                  — Z.ai ASR + OpenAI Whisper
    wcag.ts                 — WCAG 2.1 contrast calculator + audit
  stores/
    chat-store.ts           — Zustand client state
  tests/
    index.ts                — 56 smoke + sanity + WCAG tests
    preload.ts              — Bun plugin for test environment
prisma/
  schema.prisma             — User, Chat, Message, Group, Integration, MemoryLog, UsageLog, CanvasState, Skill, AuditLog, Document, DocumentChunk
supabase/
  rag/101_rag_pgvector.sql  — optional pgvector HNSW accelerator (merged platform)
  migrations/               — ragdb's original Supabase-Auth schema, preserved verbatim
  README.md                 — both RAG deployment flavors explained
public/
  icon.svg, manifest.webmanifest
.env.example                — every env var you need
railway.json                — Railway deploy config
next.config.ts              — allowedDevOrigins + security headers
bunfig.toml                 — Bun test config
SETUP-GUIDE.md              — dummy-proof step-by-step
```

## RAG tuning

All tunable constants are co-located with the code that uses them (ragdb convention):

| Constant | Location | Default | Effect |
|---|---|---|---|
| `MAX_FILE_SIZE` | `lib/rag/ingest.ts` | 50 MB | Hard cap on upload size |
| `maxTokens` | `lib/rag/ingest.ts` → `chunkText()` | 512 | Max tokens per chunk |
| `overlapTokens` | `lib/rag/ingest.ts` → `chunkText()` | 64 | Context overlap between chunks |
| `DEFAULT_TOP_K` | `lib/rag/similarity.ts` | 8 | Chunks retrieved per query |
| `DEFAULT_MATCH_THRESHOLD` | `lib/rag/similarity.ts` | 0.3 | Min cosine similarity (0–1) |
| `EMBED_BATCH_SIZE` | `lib/rag/ingest.ts` | 256 | Chunks per embedding API call |
| `hnsw.ef_search` | `supabase/rag/101_rag_pgvector.sql` | 100 | HNSW recall depth (pgvector mode) |

Env switches: `RAG_EMBEDDINGS_PROVIDER` (auto/openai/zai/local), `RAG_DRIVER` (local/supabase), `DEEPSEEK_API_KEY`. See `.env.example`.

## Running tests

```bash
bun run test   # 95 unit tests (~seconds, no server, no keys)
bun run e2e    # 57 live end-to-end checks (boots the dev server itself, no keys)
```

`bun run e2e` is fully self-orchestrating: it pushes a fresh SQLite schema,
boots the dev server, exercises every merged path (all 4 document formats,
failure paths, RAG-grounded SSE with cited sources, attachment auto-ingest
with same-turn citation + dedupe, multi-turn history, multi-chunk recall,
raw-export integrity, real signup/sign-in, two-user isolation, the signup
rate limiter, wrong-password rejection), then RESTARTS the server with a
deliberately broken pgvector config to prove persistence, JWT session
survival, and automatic degradation to the local retrieval driver.

The unit suite (95 tests) covers:
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
- RAG chunker (empty/short/long/overlap/verbatim/oversized-sentence cases)
- RAG embeddings (provider chain fallback, deterministic local vectors, batch ordering, loud key errors)
- RAG similarity + ranking (cosine edge cases, threshold/topK, end-to-end lexical retrieval)
- RAG pipeline (numbered sources, citation prompt, snippet truncation)
- RAG parsers (txt/md/xlsx round-trip, REAL handcrafted-PDF extraction via unpdf, corrupt-PDF failure path, MIME/extension resolution)
- AI providers (5-model catalog, provider routing, DeepSeek strict-alternation message builder, per-provider key detection)
- RAG security (no unscoped retrieval, ingest input validation, driver config gating)
- pgvector driver against a mock PostgREST server (RPC request shape + service-key auth, snake_case→camelCase mapping, 500→fallback error path, mirror upsert with merge-duplicates, delete-by-document filter)

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
- Server-only secrets (`src/lib/server-guard.ts`)
- Intent is never abstracted away — frozen from first user message
- Slop is never silently delivered — checker retries or warns
- Black/gray/charcoal base + 2-4 accent colors only — no rainbow palettes
- All themes pass WCAG AA contrast — verified by automated test
- Heavy SDKs lazy-loaded — fast cold starts, test-friendly
- Stripe is feature-flagged — app works without it, ready when you are
- Every system event logged to unified AuditLog
