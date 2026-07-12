#!/usr/bin/env node
/**
 * End-to-end verification of the merged platform (GLM Power Platform × RAG).
 * ---------------------------------------------------------------------
 * Self-orchestrating: pushes a fresh SQLite schema, boots the dev
 * server, exercises every merged path live, restarts the server to
 * prove persistence + pgvector-fallback resilience, then reports.
 *
 * Run:  bun run e2e          (or: node scripts/e2e.mjs)
 * Env:  E2E_PORT (default 3123)
 *
 * Zero API keys required — the local embedding provider and the
 * deterministic mock stream carry the full loop.
 *
 * Phases:
 *   A  demo-mode RAG: ingest all 4 formats, validation failures,
 *      RAG-grounded SSE with cited sources, persistence, RAG-off,
 *      attachment auto-ingest (same-turn citation + dedupe),
 *      multi-turn history, multi-chunk recall, raw-export integrity,
 *      audit trail, delete + cascade + index consistency
 *   B  real auth (NextAuth credentials): signup → CSRF → sign-in →
 *      session; two-user isolation parity (documents, retrieval,
 *      chats); wrong-password rejection. This is the structural
 *      resolution of ragdb's login defect (magic-link-only auth that
 *      depended on email delivery + same-browser PKCE state).
 *   C  restart with RAG_DRIVER=supabase pointed at a dead endpoint:
 *      data survives, sessions survive, retrieval degrades to the
 *      local driver automatically — chat never breaks.
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.E2E_PORT ?? 3123);
const BASE = `http://127.0.0.1:${PORT}`;
// Prisma resolves relative SQLite URLs against prisma/, not the repo root.
const DB_PATH = path.join(ROOT, "prisma", "db", "e2e.db");
const DATABASE_URL = "file:./db/e2e.db";
const NEXTAUTH_SECRET = "e2e-secret-0123456789abcdef0123456789abcdef";
const ATTACH_DIR = path.join(ROOT, ".next", "e2e-attachments");

let passed = 0;
let failed = 0;
const failures = [];
let server = null;

function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`  ✗ ${name} ${detail}`);
  }
}

// ----- server lifecycle ------------------------------------------------

function baseEnv(extra = {}) {
  return {
    ...process.env,
    DATABASE_URL,
    NEXTAUTH_SECRET,
    NEXTAUTH_URL: BASE,
    ENABLE_DEMO_MODE: "1",
    ATTACHMENTS_DIR: ATTACH_DIR,
    // Keys deliberately unset: local embeddings + mock stream.
    ZAI_API_KEY: "",
    OPENAI_API_KEY: "",
    DEEPSEEK_API_KEY: "",
    RAG_DRIVER: "",
    RAG_EMBEDDINGS_PROVIDER: "",
    SUPABASE_URL: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
    ...extra,
  };
}

async function startServer(extraEnv = {}) {
  server = spawn("bunx", ["next", "dev", "-p", String(PORT)], {
    cwd: ROOT,
    env: baseEnv(extraEnv),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (d) => { log += d; });
  server.stderr.on("data", (d) => { log += d; });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    if (server.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 1200));
  }
  console.error("server failed to start; last output:\n" + log.slice(-2000));
  return false;
}

async function stopServer() {
  if (!server) return;
  const proc = server;
  server = null;
  proc.kill("SIGTERM");
  await new Promise((resolve) => {
    const t = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve();
    }, 8000);
    proc.on("exit", () => {
      clearTimeout(t);
      resolve();
    });
  });
  // Give the port a beat to free up before a restart.
  await new Promise((r) => setTimeout(r, 1500));
}

// ----- helpers -----------------------------------------------------------

function buildMinimalPdf(text) {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
  ];
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  objects.push(`4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);
  objects.push("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

/** Minimal cookie jar for the NextAuth flows. */
class Jar {
  constructor() { this.cookies = new Map(); }
  absorb(res) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const idx = pair.indexOf("=");
      if (idx > 0) this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }
  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function upload(name, type, buffer, jar = null) {
  const form = new FormData();
  form.append("file", new File([buffer], name, { type }));
  const r = await fetch(`${BASE}/api/documents`, {
    method: "POST",
    body: form,
    headers: jar ? { cookie: jar.header() } : {},
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function listDocs(jar = null) {
  const r = await fetch(`${BASE}/api/documents`, { headers: jar ? { cookie: jar.header() } : {} });
  return (await r.json().catch(() => ({}))).documents ?? [];
}

async function chatSSE(payload, jar = null) {
  const r = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(jar ? { cookie: jar.header() } : {}) },
    body: JSON.stringify(payload),
  });
  const events = [];
  if (!r.ok || !r.body) return { status: r.status, events, headers: r.headers };
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try { events.push(JSON.parse(line.slice(6))); } catch { /* keepalive */ }
    }
  }
  return { status: r.status, events, headers: r.headers };
}

/**
 * NextAuth credentials sign-in: CSRF → callback → session cookie.
 * Returns true when a session token landed in the jar.
 */
async function signIn(jar, email, password) {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie: jar.header() } });
  jar.absorb(csrfRes);
  const { csrfToken } = await csrfRes.json();
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      cookie: jar.header(),
    },
    body: new URLSearchParams({
      csrfToken,
      email,
      password,
      callbackUrl: `${BASE}/`,
      json: "true",
    }),
  });
  jar.absorb(res);
  return [...jar.cookies.keys()].some((k) => k.includes("session-token"));
}

async function getSession(jar) {
  const r = await fetch(`${BASE}/api/session`, { headers: { cookie: jar.header() } });
  return r.json();
}

// =========================================================================

console.log("═".repeat(64));
console.log("Merged-platform E2E — setup");
console.log("═".repeat(64));

rmSync(DB_PATH, { force: true });
rmSync(ATTACH_DIR, { recursive: true, force: true });
mkdirSync(path.dirname(DB_PATH), { recursive: true });
const push = spawnSync("bunx", ["prisma", "db", "push", "--skip-generate"], {
  cwd: ROOT,
  env: { ...process.env, DATABASE_URL },
  stdio: "pipe",
});
if (push.status !== 0) {
  console.error("prisma db push failed:\n" + push.stdout + push.stderr);
  process.exit(1);
}
console.log("  schema pushed to fresh SQLite DB");

if (!(await startServer())) process.exit(1);
console.log("  dev server up\n");

try {
  // =======================================================================
  console.log("[A1] Session + health (demo mode, zero keys)");
  const session = await (await fetch(`${BASE}/api/session`)).json();
  check("demo mode active", session.demoMode === true, JSON.stringify(session));
  check("rag: local embeddings + local driver reported", session.rag?.embeddingsProvider === "local" && session.rag?.driver === "local");
  check("provider flags present (glm/deepseek/voice/billing)",
    typeof session.glmConfigured === "boolean" && typeof session.deepseekConfigured === "boolean" &&
    typeof session.voiceConfigured === "boolean" && typeof session.billingConfigured === "boolean");

  console.log("\n[A2] Document ingest — all 4 formats");
  const txtContent =
    "The Zephyr Protocol refund policy allows customers to return any widget within 45 days of purchase. " +
    "Refunds are processed to the original payment method within 5 business days. " +
    "Digital goods purchased under the Zephyr Protocol are refundable only if unused.";
  const txtUp = await upload("policy.txt", "text/plain", Buffer.from(txtContent));
  check("txt → ready with chunks", txtUp.status === 200 && txtUp.body.status === "ready" && txtUp.body.chunkCount >= 1, JSON.stringify(txtUp.body));
  const mdUp = await upload("notes.md", "", Buffer.from("# Meeting Notes\n\nThe quarterly launch date is March 12."));
  check("md with empty MIME (extension fallback) → ready", mdUp.status === 200 && mdUp.body.status === "ready");
  // xlsx: real workbook via the same lib the parser uses
  const { createRequire } = await import("node:module");
  const XLSX = createRequire(import.meta.url)(path.join(ROOT, "node_modules", "xlsx"));
  const ws = XLSX.utils.aoa_to_sheet([["Region", "Revenue"], ["EMEA", 120000], ["APAC", 95000]]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Q1");
  const xlsxUp = await upload("revenue.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  check("xlsx → ready", xlsxUp.status === 200 && xlsxUp.body.status === "ready");
  const pdfUp = await upload("spec.pdf", "application/pdf", buildMinimalPdf("The Aurora spec requires dual redundant power supplies"));
  check("pdf → ready (real unpdf extraction)", pdfUp.status === 200 && pdfUp.body.status === "ready");

  console.log("\n[A3] Upload failure paths");
  check("unsupported type → 422", (await upload("evil.exe", "application/x-msdownload", Buffer.from("MZ"))).status === 422);
  check("empty file → 422", (await upload("empty.txt", "text/plain", Buffer.alloc(0))).status === 422);
  const corrupt = await upload("broken.pdf", "application/pdf", Buffer.from("%PDF-1.4 garbage"));
  check("corrupt pdf → 500 + error state kept", corrupt.status === 500 && !!corrupt.body.documentId);
  const docsAfter = await listDocs();
  check("library: 4 ready + 1 error", docsAfter.filter((d) => d.status === "ready").length === 4 && docsAfter.filter((d) => d.status === "error").length === 1, `got ${docsAfter.length}`);
  check("error document carries its reason", docsAfter.some((d) => d.status === "error" && d.error));

  console.log("\n[A4] RAG-grounded chat (SSE)");
  const rag = await chatSSE({ text: "What is the refund policy for widgets under the Zephyr Protocol?", ragEnabled: true });
  const types = rag.events.map((e) => e.type);
  check("SSE 200 + X-Accel-Buffering: no", rag.status === 200 && rag.headers.get("x-accel-buffering") === "no");
  const srcEvt = rag.events.find((e) => e.type === "sources");
  check("sources event cites policy.txt", !!srcEvt && srcEvt.sources.some((s) => s.documentTitle === "policy.txt"), JSON.stringify(srcEvt?.sources?.map((s) => s.documentTitle)));
  check("sources carry snippet + similarity", srcEvt?.sources?.every((s) => s.snippet && typeof s.similarity === "number"));
  check("tokens streamed + done", types.filter((t) => t === "token").length > 5 && types.includes("done"));
  const chatId = rag.events.find((e) => e.type === "start")?.chatId;
  check("chatId issued", !!chatId);

  console.log("\n[A5] Multi-turn history in the same chat");
  const turn2 = await chatSSE({ chatId, text: "And how fast are refunds processed?", ragEnabled: true });
  check("second turn completes", turn2.events.some((e) => e.type === "done"));
  const detail = await (await fetch(`${BASE}/api/chats/${chatId}`)).json();
  check("chat holds 4+ messages after two turns", (detail.messages ?? []).length >= 4, `got ${detail.messages?.length}`);
  const assistantMsgs = (detail.messages ?? []).filter((m) => m.role === "assistant");
  check("persisted assistant turns carry sources", assistantMsgs.some((m) => Array.isArray(m.sources) && m.sources.length > 0));
  check("thinking field present in message payload", assistantMsgs.every((m) => "thinking" in m));

  console.log("\n[A6] Raw export integrity (thinking + sources preserved)");
  const exportRes = await fetch(`${BASE}/api/exports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId, type: "raw" }),
  });
  const exportJson = await exportRes.json();
  const exportAssistant = (exportJson.messages ?? []).filter((m) => m.role === "assistant");
  check("raw export includes sources on cited turns", exportAssistant.some((m) => Array.isArray(m.sources) && m.sources.length > 0));
  check("raw export includes thinking field", exportAssistant.every((m) => "thinking" in m));

  console.log("\n[A7] Attachment → RAG auto-ingest (same-turn citation + dedupe)");
  const attachContent = "The Nimbus contract stipulates a 99.95 percent uptime service level agreement with quarterly credits.";
  const attachPayload = {
    text: "What uptime does the Nimbus contract stipulate?",
    ragEnabled: true,
    attachments: [{ filename: "nimbus-contract.txt", mimeType: "text/plain", data: Buffer.from(attachContent).toString("base64") }],
  };
  const attachTurn = await chatSSE(attachPayload);
  const attachSrc = attachTurn.events.find((e) => e.type === "sources");
  check("attached file is cited on the SAME turn", !!attachSrc && attachSrc.sources.some((s) => s.documentTitle === "nimbus-contract.txt"), JSON.stringify(attachSrc?.sources?.map((s) => s.documentTitle)));
  const docsWithAttach = await listDocs();
  check("attachment landed in the documents library", docsWithAttach.some((d) => d.title === "nimbus-contract.txt" && d.status === "ready"));
  await chatSSE(attachPayload); // resend the identical attachment
  const docsAfterResend = await listDocs();
  check("re-sending the same attachment does not duplicate the document",
    docsAfterResend.filter((d) => d.title === "nimbus-contract.txt").length === 1);

  console.log("\n[A8] Multi-chunk recall (late-chunk retrieval)");
  // Three keyword-dense sections, each ~600 tokens, so the document
  // spans several chunks AND each chunk stays topically coherent —
  // what the lexical-grade local embeddings need to discriminate.
  const section = (topic, words) =>
    Array.from({ length: 30 }, (_, i) => `${topic} item ${i + 1}: ${words} step number ${i + 1} of the ${topic} process.`).join(" ");
  const bigDoc = [
    section("onboarding", "provisioning accounts and issuing badges during onboarding"),
    section("expenses", "reimbursing expense reports within fourteen days of expenses"),
    section("failover", "the datacenter failover runbook shifts traffic to the osiris west region during failover"),
  ].join("\n\n");
  const bigUp = await upload("handbook.txt", "text/plain", Buffer.from(bigDoc));
  check("multi-chunk doc ingested (>2 chunks)", bigUp.status === 200 && bigUp.body.chunkCount > 2, `chunks=${bigUp.body.chunkCount}`);
  const lateQ = await chatSSE({ text: "How does the datacenter failover runbook shift traffic to the osiris west region?", ragEnabled: true });
  const lateSrc = lateQ.events.find((e) => e.type === "sources");
  const handbookHits = lateSrc?.sources?.filter((s) => s.documentTitle === "handbook.txt") ?? [];
  check("late-section content is retrieved from a non-first chunk",
    handbookHits.some((s) => s.chunkIndex > 0 && s.snippet.includes("failover")),
    JSON.stringify(handbookHits.map((s) => [s.chunkIndex, s.snippet.slice(0, 40)])));

  console.log("\n[A9] RAG-off path + audit trail");
  const noRag = await chatSSE({ text: "What is the refund policy?", ragEnabled: false });
  check("ragEnabled:false → no sources, still completes", !noRag.events.some((e) => e.type === "sources") && noRag.events.some((e) => e.type === "done"));
  const audit = await (await fetch(`${BASE}/api/audit?source=rag&limit=100`)).json();
  const events = new Set((audit.rows ?? []).map((l) => l.event));
  check("audit: document.ready + rag.retrieval + document.error + auto-ingest recorded",
    events.has("document.ready") && events.has("rag.retrieval") && events.has("document.error") && events.has("document.auto_ingested_from_chat"),
    JSON.stringify([...events]));

  console.log("\n[A10] Delete + cascade + index consistency");
  const target = docsAfterResend.find((d) => d.title === "revenue.xlsx");
  check("delete → 200", (await fetch(`${BASE}/api/documents/${target.id}`, { method: "DELETE" })).status === 200);
  check("deleted detail → 404", (await fetch(`${BASE}/api/documents/${target.id}`)).status === 404);
  check("double delete → 404", (await fetch(`${BASE}/api/documents/${target.id}`, { method: "DELETE" })).status === 404);
  const postDeleteQ = await chatSSE({ text: "When is the quarterly launch date according to the meeting notes?", ragEnabled: true });
  const postDeleteSrc = postDeleteQ.events.find((e) => e.type === "sources");
  check("retrieval intact after delete (notes.md still cited)", !!postDeleteSrc && postDeleteSrc.sources.some((s) => s.documentTitle === "notes.md"));

  // =======================================================================
  console.log("\n[B1] Real auth — signup + credentials sign-in (ragdb login-defect parity)");
  const alice = new Jar();
  const bob = new Jar();
  // Signup is rate-limited to 3/hour/IP (brute-force guard). Budget:
  // Alice + Bob + duplicate = 3 allowed calls; the 4th must 429 —
  // asserted below as the rate limiter's own verification.
  const signupA = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "alice@example.com", password: "correct-horse-1", name: "Alice" }),
  });
  check("signup Alice → ok", signupA.status === 200 && (await signupA.json()).ok === true);
  const signupB = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "bob@example.com", password: "correct-horse-2", name: "Bob" }),
  });
  check("signup Bob → ok", signupB.status === 200);
  check("duplicate signup → 409", (await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "alice@example.com", password: "correct-horse-1" }),
  })).status === 409);
  check("4th signup inside the window → 429 (brute-force guard live)", (await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "fourth@example.com", password: "correct-horse-4" }),
  })).status === 429);

  const wrongJar = new Jar();
  check("wrong password → no session token", !(await signIn(wrongJar, "alice@example.com", "not-the-password")));
  check("sign-in Alice → session cookie set (no email round-trip, no PKCE state)", await signIn(alice, "alice@example.com", "correct-horse-1"));
  const aliceSession = await getSession(alice);
  check("session reports Alice", aliceSession.user?.email === "alice@example.com", JSON.stringify(aliceSession.user));
  check("sign-in Bob", await signIn(bob, "bob@example.com", "correct-horse-2"));

  console.log("\n[B2] Two-user isolation (parity with ragdb's RLS model)");
  const aliceDoc = await upload("alice-secret.txt", "text/plain",
    Buffer.from("Alice's private launch codes are stored in vault Epsilon under the orchid protocol."), alice);
  check("Alice uploads her document", aliceDoc.status === 200 && aliceDoc.body.status === "ready");
  const aliceDocs = await listDocs(alice);
  const bobDocs = await listDocs(bob);
  check("Alice sees her document", aliceDocs.some((d) => d.title === "alice-secret.txt"));
  check("Bob does NOT see Alice's document", !bobDocs.some((d) => d.title === "alice-secret.txt"));
  check("demo-user documents invisible to Alice", !aliceDocs.some((d) => d.title === "policy.txt"));

  const aliceChat = await chatSSE({ text: "What protocol guards the launch codes in vault Epsilon?", ragEnabled: true }, alice);
  const aliceSrc = aliceChat.events.find((e) => e.type === "sources");
  check("Alice's retrieval cites her document", !!aliceSrc && aliceSrc.sources.some((s) => s.documentTitle === "alice-secret.txt"));
  const aliceChatId = aliceChat.events.find((e) => e.type === "start")?.chatId;

  const bobProbe = await chatSSE({ text: "What protocol guards the launch codes in vault Epsilon?", ragEnabled: true }, bob);
  check("Bob's retrieval finds NOTHING of Alice's", !bobProbe.events.some((e) => e.type === "sources"));
  check("Bob cannot read Alice's chat → 404", (await fetch(`${BASE}/api/chats/${aliceChatId}`, { headers: { cookie: bob.header() } })).status === 404);
  const aliceDocId = aliceDocs.find((d) => d.title === "alice-secret.txt")?.id;
  check("Bob cannot delete Alice's document → 404", (await fetch(`${BASE}/api/documents/${aliceDocId}`, { method: "DELETE", headers: { cookie: bob.header() } })).status === 404);

  // =======================================================================
  console.log("\n[C1] Restart with a BROKEN pgvector config — persistence + graceful degradation");
  await stopServer();
  if (!(await startServer({
    RAG_DRIVER: "supabase",
    SUPABASE_URL: "http://127.0.0.1:59999", // nothing listens here
    SUPABASE_SERVICE_ROLE_KEY: "dead-key",
  }))) throw new Error("restart failed");

  const session2 = await (await fetch(`${BASE}/api/session`)).json();
  check("restarted server reports supabase driver", session2.rag?.driver === "supabase", JSON.stringify(session2.rag));
  const docsSurvived = await listDocs();
  check("documents survived the restart", docsSurvived.some((d) => d.title === "policy.txt"), `got ${docsSurvived.length}`);
  const chatSurvived = await (await fetch(`${BASE}/api/chats/${chatId}`)).json();
  check("chat history survived the restart", (chatSurvived.messages ?? []).length >= 4);
  check("Alice's JWT session survived the restart", (await getSession(alice)).user?.email === "alice@example.com");

  const degraded = await chatSSE({ text: "What is the refund policy for widgets under the Zephyr Protocol?", ragEnabled: true });
  const degradedSrc = degraded.events.find((e) => e.type === "sources");
  check("retrieval DEGRADES to local and still cites sources (chat never breaks)",
    !!degradedSrc && degradedSrc.sources.some((s) => s.documentTitle === "policy.txt"));
  const audit2 = await (await fetch(`${BASE}/api/audit?source=rag&limit=20`)).json();
  const lastRetrieval = (audit2.rows ?? []).find((l) => l.event === "rag.retrieval");
  check("audit records degradedToLocal on the fallback retrieval", lastRetrieval?.payload?.degradedToLocal === true, JSON.stringify(lastRetrieval?.payload));

  // Signup validation check deferred here: the restart reset the
  // in-memory rate-limit window consumed in Phase B.
  check("weak password → 400", (await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "weak@example.com", password: "short" }),
  })).status === 400);
} catch (e) {
  failed++;
  failures.push(`runner crashed: ${e?.stack ?? e}`);
  console.error(e);
} finally {
  await stopServer();
}

console.log("\n" + "═".repeat(64));
console.log(`E2E passed: ${passed}/${passed + failed}`);
if (failures.length > 0) {
  console.log("FAILURES:");
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
process.exit(0);
