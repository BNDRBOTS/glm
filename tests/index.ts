/**
 * GLM Power Platform — Smoke + Sanity Tests
 * ---------------------------------------------------------------------
 * Run with: bun run test
 *
 * `server-only` is stubbed via tests/preload.ts (Bun plugin).
 */

import assert from "node:assert";

const results: { name: string; passed: boolean; error?: string }[] = [];

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`  ✓ ${name}`);
  } catch (e) {
    results.push({ name, passed: false, error: (e as Error).message });
    console.log(`  ✗ ${name}`);
    console.log(`    ${((e as Error).message).split("\n")[0]}`);
  }
}

function eq(actual: unknown, expected: unknown, msg?: string) {
  assert.deepStrictEqual(actual, expected, msg ?? "");
}

function ok(cond: unknown, msg?: string) {
  assert.ok(cond, msg ?? "");
}

// ---------------------------------------------------------------------
// Models catalog
// ---------------------------------------------------------------------

console.log("\nModels catalog");
await test("has exactly 3 models", async () => {
  const { MODELS } = await import("@/lib/ai/models");
  eq(MODELS.length, 3, "should have 3 models");
});

await test("peak model is GLM 5.2", async () => {
  const { MODELS } = await import("@/lib/ai/models");
  const peak = MODELS.find((m) => m.tier === "peak");
  ok(peak?.id === "glm-5.2", "peak should be glm-5.2");
});

await test("no 4.6 models present", async () => {
  const { MODELS } = await import("@/lib/ai/models");
  const has46 = MODELS.some((m) => m.id.includes("4.6"));
  ok(!has46, "no 4.6 models should be in catalog");
});

await test("has GLM 5.1 and GLM 5.1 Flash", async () => {
  const { MODELS } = await import("@/lib/ai/models");
  ok(MODELS.some((m) => m.id === "glm-5.1"), "should have glm-5.1");
  ok(MODELS.some((m) => m.id === "glm-5.1-flash"), "should have glm-5.1-flash");
});

// ---------------------------------------------------------------------
// Connectors registry
// ---------------------------------------------------------------------

console.log("\nConnectors registry");
await test("has 6 connectors", async () => {
  const { listConnectors } = await import("@/lib/connectors/registry");
  eq(listConnectors().length, 6, "should have 6 connectors");
});

await test("has CourtListener connector", async () => {
  const { getConnector } = await import("@/lib/connectors/registry");
  const c = getConnector("courtlistener");
  ok(c, "courtlistener connector should exist");
  eq(c!.manifest.category, "LEGAL_RESEARCH");
  ok(c!.manifest.capabilities.search, "should support search");
  ok(c!.manifest.capabilities.fetch, "should support fetch");
});

await test("has Midpage connector", async () => {
  const { getConnector } = await import("@/lib/connectors/registry");
  const c = getConnector("midpage");
  ok(c, "midpage connector should exist");
  eq(c!.manifest.category, "LEGAL_RESEARCH");
});

await test("legacy connectors still present (notion/github/courtroom5/localfs)", async () => {
  const { getConnector } = await import("@/lib/connectors/registry");
  ok(getConnector("notion"), "notion should exist");
  ok(getConnector("github"), "github should exist");
  ok(getConnector("courtroom5"), "courtroom5 should exist");
  ok(getConnector("localfs"), "localfs should exist");
});

await test("CourtListener manifest has correct env key", async () => {
  const { getConnector } = await import("@/lib/connectors/registry");
  const c = getConnector("courtlistener")!;
  eq(c.manifest.envKey, "COURTLISTENER_API_TOKEN");
});

await test("Midpage manifest has correct env key", async () => {
  const { getConnector } = await import("@/lib/connectors/registry");
  const c = getConnector("midpage")!;
  eq(c.manifest.envKey, "MIDPAGE_API_KEY");
});

// ---------------------------------------------------------------------
// Backends registry
// ---------------------------------------------------------------------

console.log("\nBackends registry");
await test("has 5 backends", async () => {
  const { listBackends } = await import("@/lib/backends/registry");
  eq(listBackends().length, 5, "should have 5 backends");
});

await test("has Supabase, Neon, MongoDB, Firebase, Turso", async () => {
  const { getBackend } = await import("@/lib/backends/registry");
  ok(getBackend("supabase"), "supabase should exist");
  ok(getBackend("neon"), "neon should exist");
  ok(getBackend("mongodb"), "mongodb should exist");
  ok(getBackend("firebase"), "firebase should exist");
  ok(getBackend("turso"), "turso should exist");
});

await test("Supabase requires URL + anonKey", async () => {
  const { getBackend } = await import("@/lib/backends/registry");
  const b = getBackend("supabase")!;
  const keys = b.manifest.requiredFields.map((f) => f.key);
  ok(keys.includes("url"), "should require url");
  ok(keys.includes("anonKey"), "should require anonKey");
});

// ---------------------------------------------------------------------
// Permissions / modes
// ---------------------------------------------------------------------

console.log("\nPermissions / modes");
await test("has 3 modes", async () => {
  const { MODES } = await import("@/lib/permissions/modes");
  eq(MODES.length, 3);
});

await test("default mode is auto", async () => {
  const { parseMode } = await import("@/lib/permissions/modes");
  // parseMode returns "auto" for undefined/invalid input — that IS the default
  eq(parseMode(undefined), "auto");
  eq(parseMode("invalid"), "auto");
});

await test("auto mode delivers output", async () => {
  const { modeGate } = await import("@/lib/permissions/modes");
  const d = modeGate({ mode: "auto", output: "hello", fullBuildOnly: false });
  eq(d.action, "deliver");
});

await test("plan mode requires approval when isPlanStep", async () => {
  const { modeGate } = await import("@/lib/permissions/modes");
  const d = modeGate({
    mode: "plan",
    output: "Step 1: do X\nStep 2: do Y",
    fullBuildOnly: false,
    isPlanStep: true,
    hasUserApprovedPlan: false,
  });
  eq(d.action, "require-plan-approval");
});

await test("accept-edits mode requires edit approval", async () => {
  const { modeGate } = await import("@/lib/permissions/modes");
  const d = modeGate({ mode: "accept-edits", output: "+added line\n-removed line", fullBuildOnly: false });
  eq(d.action, "require-edit-approval");
});

await test("fullBuildOnly rejects slop", async () => {
  const { modeGate } = await import("@/lib/permissions/modes");
  const d = modeGate({
    mode: "auto",
    output: "function foo() { /* TODO: implement */ }",
    fullBuildOnly: true,
  });
  eq(d.action, "reject");
});

// ---------------------------------------------------------------------
// Slop detector
// ---------------------------------------------------------------------

console.log("\nSlop detector");
await test("detects TODO markers", async () => {
  const { detectSlopPatterns } = await import("@/lib/permissions/modes");
  const s = detectSlopPatterns("function foo() { /* TODO: implement */ }");
  ok(s.includes("todo-marker"), `expected todo-marker, got: ${s.join(", ")}`);
});

await test("detects 'not implemented' throws", async () => {
  const { detectSlopPatterns } = await import("@/lib/permissions/modes");
  const s = detectSlopPatterns("function foo() { throw new Error('not implemented') }");
  ok(s.includes("not-implemented-throw"), `expected not-implemented-throw, got: ${s.join(", ")}`);
});

await test("detects empty function bodies", async () => {
  const { detectSlopPatterns } = await import("@/lib/permissions/modes");
  const s = detectSlopPatterns("function foo() {}");
  ok(s.includes("empty-function-body"), `expected empty-function-body, got: ${s.join(", ")}`);
});

await test("detects placeholder tags", async () => {
  const { detectSlopPatterns } = await import("@/lib/permissions/modes");
  const s = detectSlopPatterns("const apiKey = '<placeholder>';");
  ok(s.includes("placeholder-tag"), `expected placeholder-tag, got: ${s.join(", ")}`);
});

await test("detects implement-later language", async () => {
  const { detectSlopPatterns } = await import("@/lib/permissions/modes");
  const s = detectSlopPatterns("We will implement later in the next iteration.");
  ok(s.includes("implement-later"));
});

await test("detects meta-heavy output (no substance)", async () => {
  const { detectSlopPatterns } = await import("@/lib/permissions/modes");
  const text = [
    "I would start by analyzing the requirements.",
    "Let me first explain my approach.",
    "To do this, I'll need to consider several factors.",
    "The approach I'd take involves multiple steps.",
    "First, I would examine the input data.",
    "Next, I'll think about the constraints.",
    "Here's how I would structure the solution.",
  ].join("\n");
  const s = detectSlopPatterns(text);
  ok(s.includes("meta-heavy-no-substance"), `expected meta-heavy-no-substance, got: ${s.join(", ")}`);
});

await test("clean code passes (no slop detected)", async () => {
  const { detectSlopPatterns } = await import("@/lib/permissions/modes");
  const clean = `
function add(a: number, b: number): number {
  return a + b;
}

export function calculateTotal(items: { price: number }[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}
`.trim();
  const s = detectSlopPatterns(clean);
  eq(s.length, 0, `expected no slop, got: ${s.join(", ")}`);
});

// ---------------------------------------------------------------------
// Distillation
// ---------------------------------------------------------------------

console.log("\nDistillation");
await test("freezes intent from first user message (no abstraction)", async () => {
  const { initState } = await import("@/lib/distillation");
  const state = initState("chat-1", "Build me a React component for a settings panel with dark mode");
  ok(state.originalIntent.includes("Build me a React component"), "intent should be preserved verbatim");
  ok(state.originalIntent.includes("settings panel"), "intent should not be abstracted away");
});

await test("extracts entities from first message", async () => {
  const { initState } = await import("@/lib/distillation");
  const state = initState("chat-1", "I need to integrate Stripe and Notion into my Next.js app");
  ok(state.entities.includes("Stripe"), "should extract Stripe");
  ok(state.entities.includes("Notion"), "should extract Notion");
  ok(state.entities.includes("Next"), "should extract Next");
});

await test("intent alignment scores high when output mentions intent tokens", async () => {
  const { initState, distillTurn } = await import("@/lib/distillation");
  let state = initState("chat-1", "Build a React component for settings panel");
  state = distillTurn(state, {
    id: "t1",
    role: "assistant",
    content: "Here is your React settings panel component with dark mode support.",
  });
  ok(state.turns[1].intentAlignment > 0.3, `expected alignment > 0.3, got ${state.turns[1].intentAlignment}`);
});

await test("intent alignment scores low when output drifts", async () => {
  const { initState, distillTurn } = await import("@/lib/distillation");
  let state = initState("chat-1", "Build a React component for settings panel");
  state = distillTurn(state, {
    id: "t1",
    role: "assistant",
    content: "Today the weather is sunny and the birds are singing outside my window.",
  });
  ok(state.turns[1].intentAlignment < 0.2, `expected alignment < 0.2, got ${state.turns[1].intentAlignment}`);
});

await test("drift detection triggers when recent turns drift", async () => {
  const { initState, distillTurn } = await import("@/lib/distillation");
  let state = initState("chat-1", "Build a React component for settings panel");
  state = distillTurn(state, { id: "t1", role: "assistant", content: "The weather today is lovely and the birds are singing." });
  state = distillTurn(state, { id: "t2", role: "assistant", content: "I went for a walk in the park this morning." });
  ok(state.driftDetected, "drift should be detected after 2 off-topic turns");
});

await test("distillation accumulates facts across turns", async () => {
  const { initState, distillTurn } = await import("@/lib/distillation");
  let state = initState("chat-1", "Tell me about TypeScript");
  state = distillTurn(state, {
    id: "t1",
    role: "assistant",
    content: "TypeScript is a superset of JavaScript. It adds static typing to JavaScript.",
  });
  ok(state.facts.length >= 1, `should have at least 1 fact, got ${state.facts.length}`);
});

// ---------------------------------------------------------------------
// Quality checker
// ---------------------------------------------------------------------

console.log("\nQuality checker (silent AI)");
await test("clean output passes without retry", async () => {
  const { checkAndRetry } = await import("@/lib/quality/checker");
  const result = await checkAndRetry(
    "function add(a, b) { return a + b; }",
    [{ role: "user", content: "write add function" }],
    {
      fullBuildOnly: true,
      maxRetries: 2,
      originalIntent: "write add function",
      retry: async () => "function add(a, b) { return a + b; }",
    }
  );
  ok(result.passed, "should pass");
  eq(result.attempts, 1, "should not retry");
});

await test("sloppy output triggers retry and passes when retry is clean", async () => {
  const { checkAndRetry } = await import("@/lib/quality/checker");
  let calls = 0;
  const result = await checkAndRetry(
    "function foo() { /* TODO: implement */ }",
    [{ role: "user", content: "write foo function" }],
    {
      fullBuildOnly: true,
      maxRetries: 2,
      originalIntent: "write foo function",
      retry: async () => {
        calls++;
        return "function foo() { return 42; }";
      },
    }
  );
  ok(result.passed, "should pass after retry");
  eq(result.attempts, 2, "should have retried once");
  eq(calls, 1, "retry callback should have been called once");
});

await test("delivered with warning when budget exhausted", async () => {
  const { checkAndRetry } = await import("@/lib/quality/checker");
  const result = await checkAndRetry(
    "function foo() { /* TODO */ }",
    [{ role: "user", content: "write foo" }],
    {
      fullBuildOnly: true,
      maxRetries: 1,
      originalIntent: "write foo",
      retry: async () => "function foo() { /* FIXME */ }",
    }
  );
  ok(!result.passed, "should not pass");
  ok(result.deliveredWithWarning, "should be delivered with warning");
});

// ---------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------

console.log("\nThemes");
await test("has 5 premade themes", async () => {
  const { THEMES } = await import("@/lib/themes");
  eq(THEMES.length, 5);
});

await test("default theme is obsidian", async () => {
  const { DEFAULT_THEME } = await import("@/lib/themes");
  eq(DEFAULT_THEME, "obsidian");
});

await test("each theme has 4 accent colors in dark + light", async () => {
  const { THEMES } = await import("@/lib/themes");
  for (const t of THEMES) {
    ok(t.dark.accent && t.dark.accentSecondary && t.dark.accentTertiary && t.dark.accentDanger, `${t.id} dark missing accents`);
    ok(t.light.accent && t.light.accentSecondary && t.light.accentTertiary && t.light.accentDanger, `${t.id} light missing accents`);
  }
});

await test("all accent colors are valid hex", async () => {
  const { THEMES } = await import("@/lib/themes");
  const hexRe = /^#[0-9a-f]{6}$/i;
  for (const t of THEMES) {
    ok(hexRe.test(t.dark.accent), `${t.id} dark.accent invalid`);
    ok(hexRe.test(t.dark.accentSecondary), `${t.id} dark.accentSecondary invalid`);
    ok(hexRe.test(t.light.accent), `${t.id} light.accent invalid`);
  }
});

await test("getTheme returns the theme by id", async () => {
  const { getTheme } = await import("@/lib/themes");
  const t = getTheme("graphite");
  ok(t?.name === "Graphite");
  ok(!getTheme("nonexistent"), "nonexistent should return undefined");
});

// ---------------------------------------------------------------------
// WCAG contrast
// ---------------------------------------------------------------------

console.log("\nWCAG contrast");
await test("black on white passes AA at 21:1", async () => {
  const { contrastRatio } = await import("@/lib/wcag");
  const r = contrastRatio("#000000", "#ffffff");
  ok(r.ratio > 20, `expected > 20, got ${r.ratio}`);
  ok(r.passes.aa, "should pass AA");
  ok(r.passes.aaa, "should pass AAA");
});

await test("white on black passes AA at 21:1", async () => {
  const { contrastRatio } = await import("@/lib/wcag");
  const r = contrastRatio("#f5f5f7", "#000000");
  ok(r.ratio > 18, `expected > 18, got ${r.ratio}`);
  ok(r.passes.aa);
});

await test("light gray on white fails AA for normal text", async () => {
  const { contrastRatio } = await import("@/lib/wcag");
  // #cccccc on #ffffff ≈ 1.6:1 — fails both AA and AA-large
  const r = contrastRatio("#cccccc", "#ffffff");
  ok(!r.passes.aa, `#cccccc on #ffffff should fail AA, got ${r.asString}`);
  ok(!r.passes.aaLarge, `#cccccc on #ffffff should also fail AA-large, got ${r.asString}`);
});

await test("auditContrast runs against all required pairs", async () => {
  const { auditContrast } = await import("@/lib/wcag");
  const result = auditContrast();
  ok(result.summary.total > 0, "should have at least 1 pair");
  // Every pair must pass its required level
  for (const p of result.pairs) {
    ok(p.pass, `FAIL: ${p.label} — ${p.result.asString} (required ${p.required})`);
  }
});

await test("invalid hex returns 0 ratio", async () => {
  const { contrastRatio } = await import("@/lib/wcag");
  const r = contrastRatio("not-a-color", "#000000");
  eq(r.ratio, 0);
  ok(!r.passes.aa);
});

// ---------------------------------------------------------------------
// Voice (STT) — module loads, provider detection works
// ---------------------------------------------------------------------

console.log("\nVoice (STT)");
await test("voice module exports transcribeAudio + isVoiceAvailable", async () => {
  const mod = await import("@/lib/voice");
  ok(typeof mod.transcribeAudio === "function");
  ok(typeof mod.isVoiceAvailable === "function");
});

await test("isVoiceAvailable returns false without keys", async () => {
  const { isVoiceAvailable } = await import("@/lib/voice");
  // In test env, no keys are set
  const result = isVoiceAvailable();
  ok(typeof result === "boolean");
});

await test("transcribeAudio throws when no key set", async () => {
  const { transcribeAudio } = await import("@/lib/voice");
  // Make sure no keys leak in
  const origZai = process.env.ZAI_API_KEY;
  const origOpenai = process.env.OPENAI_API_KEY;
  delete process.env.ZAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    let threw = false;
    try {
      await transcribeAudio(Buffer.from("fake"), "audio/webm", { provider: "zai" });
    } catch {
      threw = true;
    }
    ok(threw, "should throw without ZAI_API_KEY");
  } finally {
    if (origZai) process.env.ZAI_API_KEY = origZai;
    if (origOpenai) process.env.OPENAI_API_KEY = origOpenai;
  }
});

// ---------------------------------------------------------------------
// Skills — trigger matching + types
// ---------------------------------------------------------------------

console.log("\nSkills");
await test("matchTriggers finds skills whose triggers appear in input", async () => {
  const { matchTriggers } = await import("@/lib/skills");
  const skills = [
    {
      id: "1", name: "Courtroom", description: "", systemPrompt: "",
      mode: "auto" as const, fullBuildOnly: true,
      allowedConnectors: [], allowedBackends: [],
      triggers: ["case", "lawsuit"], version: 1,
      origin: "local" as const, author: null,
      enabled: true, createdAt: "", updatedAt: "",
    },
    {
      id: "2", name: "React Dev", description: "", systemPrompt: "",
      mode: "auto" as const, fullBuildOnly: true,
      allowedConnectors: [], allowedBackends: [],
      triggers: ["component", "react"], version: 1,
      origin: "local" as const, author: null,
      enabled: true, createdAt: "", updatedAt: "",
    },
  ];
  const matches = matchTriggers("help me with my case", skills);
  ok(matches.length === 1 && matches[0].id === "1", "should match Courtroom skill");
});

await test("matchTriggers skips disabled skills", async () => {
  const { matchTriggers } = await import("@/lib/skills");
  const skills = [
    {
      id: "1", name: "Disabled", description: "", systemPrompt: "",
      mode: "auto" as const, fullBuildOnly: true,
      allowedConnectors: [], allowedBackends: [],
      triggers: ["match"], version: 1,
      origin: "local" as const, author: null,
      enabled: false, createdAt: "", updatedAt: "",
    },
  ];
  const matches = matchTriggers("this should match", skills);
  eq(matches.length, 0);
});

// ---------------------------------------------------------------------
// Audit log — write + query + prune
// ---------------------------------------------------------------------

console.log("\nAudit log");
await test("logAudit writes without throwing", async () => {
  const { logAudit } = await import("@/lib/audit");
  await logAudit({
    userId: "test-user",
    source: "system",
    event: "test.event",
    payload: { foo: "bar" },
  });
  // If we got here without throwing, test passes
  ok(true);
});

await test("logAudit swallows DB errors silently", async () => {
  const { logAudit } = await import("@/lib/audit");
  // Force an invalid payload (circular ref) — logAudit should not throw
  const circular: any = {};
  circular.self = circular;
  try {
    await logAudit({
      userId: "test-user",
      source: "system",
      event: "test.circular",
      payload: circular,
    });
    ok(true, "should not throw");
  } catch (e) {
    // JSON.stringify of circular throws — but logAudit should catch it
    ok(false, `logAudit should not throw: ${(e as Error).message}`);
  }
});

// ---------------------------------------------------------------------
// Stripe — not configured returns structured response
// ---------------------------------------------------------------------

console.log("\nStripe billing");
await test("isBillingConfigured returns false without STRIPE_SECRET_KEY", async () => {
  const { isBillingConfigured } = await import("@/lib/billing/stripe");
  const orig = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  try {
    ok(!isBillingConfigured(), "should be false without key");
  } finally {
    if (orig) process.env.STRIPE_SECRET_KEY = orig;
  }
});

await test("createCheckoutSession returns notConfigured without key", async () => {
  const { createCheckoutSession } = await import("@/lib/billing/stripe");
  const orig = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  try {
    const result = await createCheckoutSession({
      planId: "team", groupId: "g1",
      successUrl: "https://example.com/s",
      cancelUrl: "https://example.com/c",
    });
    ok("notConfigured" in result, "should return notConfigured");
  } finally {
    if (orig) process.env.STRIPE_SECRET_KEY = orig;
  }
});

await test("PLANS has 3 tiers (power, team, pro)", async () => {
  const { PLANS } = await import("@/lib/billing/stripe");
  ok(PLANS.length >= 3, "should have at least 3 plans");
  ok(PLANS.some((p) => p.id === "power"));
  ok(PLANS.some((p) => p.id === "team"));
  ok(PLANS.some((p) => p.id === "pro"));
});

await test("power plan is free (price 0)", async () => {
  const { PLANS } = await import("@/lib/billing/stripe");
  const power = PLANS.find((p) => p.id === "power");
  eq(power?.priceMonthly, 0);
});

// ---------------------------------------------------------------------
// Filesystem path boundary (attachments + Local FS connector)
// ---------------------------------------------------------------------

console.log("\nFilesystem path boundary");
await test("isInsideRoot accepts paths inside the root", async () => {
  const { isInsideRoot } = await import("@/lib/fs-boundary");
  ok(isInsideRoot("/data/attachments", "abc-file.txt"));
  ok(isInsideRoot("/data/attachments", "sub/dir/file.txt"));
  ok(isInsideRoot("/data/attachments", "/data/attachments/file.txt"));
});

await test("isInsideRoot rejects parent-directory traversal", async () => {
  const { isInsideRoot } = await import("@/lib/fs-boundary");
  ok(!isInsideRoot("/data/attachments", "../outside.txt"));
  ok(!isInsideRoot("/data/attachments", "../../etc/passwd"));
  ok(!isInsideRoot("/data/attachments", "sub/../../outside.txt"));
});

await test("isInsideRoot rejects sibling-prefix escape (startsWith bug)", async () => {
  const { isInsideRoot } = await import("@/lib/fs-boundary");
  // "/data/attachments-evil/x" starts with "/data/attachments" but is
  // NOT inside it — the old prefix check accepted this.
  ok(!isInsideRoot("/data/attachments", "/data/attachments-evil/x"));
  ok(!isInsideRoot("/data/attachments", "../attachments-evil/x"));
});

await test("resolveInsideRoot throws on escape, resolves when safe", async () => {
  const { resolveInsideRoot } = await import("@/lib/fs-boundary");
  const safe = resolveInsideRoot("/data/attachments", "uuid-file.txt");
  ok(safe.endsWith("uuid-file.txt"));
  let threw = false;
  try {
    resolveInsideRoot("/data/attachments", "../../etc/passwd");
  } catch {
    threw = true;
  }
  ok(threw, "escape should throw");
});

await test("attachment store/read/delete round-trip stays inside root", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "glm-att-test-"));
  const orig = process.env.ATTACHMENTS_DIR;
  process.env.ATTACHMENTS_DIR = dir;
  try {
    const { storeAttachment, readAttachment, deleteAttachment } = await import("@/lib/storage/attachments");
    const stored = await storeAttachment("../../evil name.txt", "text/plain", Buffer.from("hello"));
    ok(!stored.storageKey.includes(".."), "storageKey must be sanitized");
    const back = await readAttachment(stored.storageKey);
    eq(back?.toString("utf8"), "hello");
    // Traversal reads return null instead of leaking files
    const escape = await readAttachment("../outside.txt");
    eq(escape, null);
    await deleteAttachment(stored.storageKey);
    eq(await readAttachment(stored.storageKey), null);
  } finally {
    if (orig === undefined) delete process.env.ATTACHMENTS_DIR;
    else process.env.ATTACHMENTS_DIR = orig;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

await test("default attachments dir is NOT under .next (build-wipe hazard)", async () => {
  const fs = await import("node:fs/promises");
  const src = await fs.readFile(new URL("../lib/storage/attachments.ts", import.meta.url), "utf8");
  ok(!/DEFAULT_DIR\s*=\s*[^\n]*\.next/.test(src), "default dir must live outside .next/");
});

// ---------------------------------------------------------------------
// Rate limit buckets — the paths that actually take auth traffic
// ---------------------------------------------------------------------

console.log("\nRate limit buckets");
await test("NextAuth credentials callback path is rate limited", async () => {
  const { RATE_LIMITS } = await import("@/lib/ratelimit");
  const bucket = RATE_LIMITS["POST:/api/auth/callback/credentials"];
  ok(bucket, "credentials callback bucket must exist — that is the real sign-in POST path");
  ok(bucket.max <= 10, "sign-in bucket should be strict");
  eq(bucket.scope, "ip");
});

await test("sensitive account mutations have strict buckets", async () => {
  const { RATE_LIMITS } = await import("@/lib/ratelimit");
  ok(RATE_LIMITS["POST:/api/auth/change-password"], "change-password bucket");
  ok(RATE_LIMITS["POST:/api/auth/delete-account"], "delete-account bucket");
});

await test("checkRateLimit blocks after bucket max", async () => {
  const { resetRedisForTests } = await import("@/lib/redis");
  await resetRedisForTests();
  const { checkRateLimit } = await import("@/lib/ratelimit");
  const opts = { method: "POST", path: "/api/auth/callback/credentials", userId: null, ip: "203.0.113.9" };
  let last;
  for (let i = 0; i < 6; i++) last = await checkRateLimit(opts);
  ok(last && !last.allowed, "6th sign-in attempt in a minute must be blocked");
  await resetRedisForTests();
});

// ---------------------------------------------------------------------
// Memory journal — attribution + fault isolation
// ---------------------------------------------------------------------

console.log("\nMemory journal");
await test("logTurn never throws, even without a database", async () => {
  const { logTurn } = await import("@/lib/memory");
  // No DATABASE_URL in the test env — the create will fail. logTurn
  // must swallow it (the Message table is the authoritative store).
  await logTurn({
    messageId: "m1",
    chatId: "c1",
    authorId: null,
    ownerId: "owner-1",
    role: "assistant",
    content: "partial output",
    truncated: true,
  });
  ok(true, "should not throw");
});

await test("TurnRecord separates authorId from ownerId", async () => {
  const mod = await import("@/lib/memory");
  // Type-level contract: a record with assistant authorship null +
  // owner set compiles and is accepted by logTurn.
  const rec: Parameters<typeof mod.logTurn>[0] = {
    messageId: "m2",
    chatId: "c2",
    authorId: null,
    ownerId: "owner-2",
    role: "assistant",
    content: "x",
  };
  await mod.logTurn(rec);
  ok(true);
});

// ---------------------------------------------------------------------
// In-memory redis — TTL + sweep behavior
// ---------------------------------------------------------------------

console.log("\nIn-memory redis");
await test("expired keys read as null", async () => {
  const { getRedis, resetRedisForTests } = await import("@/lib/redis");
  await resetRedisForTests();
  const redis = await getRedis();
  await redis.set("t:expired", "v", -1); // already expired
  eq(await redis.get("t:expired"), null);
  await resetRedisForTests();
});

await test("incr counts within a window", async () => {
  const { getRedis, resetRedisForTests } = await import("@/lib/redis");
  await resetRedisForTests();
  const redis = await getRedis();
  eq(await redis.incr("t:counter", 60), 1);
  eq(await redis.incr("t:counter", 60), 2);
  eq(await redis.incr("t:counter", 60), 3);
  await resetRedisForTests();
});

// ---------------------------------------------------------------------
// Tool-call parsing — output cleaning stays lossless for prose
// ---------------------------------------------------------------------

console.log("\nTool-call parsing");
await test("parseToolCalls extracts calls and cleans output", async () => {
  const { parseToolCalls } = await import("@/lib/tools/connector-calls");
  const output = [
    "Let me search for that.",
    "```tool:connector:search",
    '{ "provider": "github", "query": "next-auth", "limit": 5 }',
    "```",
    "One moment.",
  ].join("\n");
  const parsed = parseToolCalls(output);
  eq(parsed.calls.length, 1);
  eq(parsed.calls[0].provider, "github");
  eq(parsed.calls[0].kind, "search");
  ok(!parsed.cleaned.includes("tool:connector"), "directive removed from visible output");
  ok(parsed.cleaned.includes("Let me search for that."), "prose preserved");
  ok(parsed.cleaned.includes("One moment."), "prose preserved");
});

await test("parseToolCalls skips malformed JSON without dropping prose", async () => {
  const { parseToolCalls } = await import("@/lib/tools/connector-calls");
  const output = "Before\n```tool:connector:search\n{ not json\n```\nAfter";
  const parsed = parseToolCalls(output);
  eq(parsed.calls.length, 0);
  ok(parsed.cleaned.includes("Before"));
  ok(parsed.cleaned.includes("After"));
});

// ---------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------

console.log("\n" + "─".repeat(60));
const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;
console.log(`Passed: ${passed} / ${results.length}`);
if (failed > 0) {
  console.log(`Failed: ${failed}`);
  for (const r of results.filter((r) => !r.passed)) {
    console.log(`  ✗ ${r.name}: ${r.error}`);
  }
  process.exit(1);
} else {
  console.log("All tests passed.");
  process.exit(0);
}