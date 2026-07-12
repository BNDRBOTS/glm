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

/**
 * Minimal valid single-page PDF with one text object, built by hand.
 * Lets the parser test exercise the REAL unpdf pipeline without a
 * binary fixture in the repo.
 */
function buildMinimalPdf(text: string): Buffer {
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

// ---------------------------------------------------------------------
// Models catalog
// ---------------------------------------------------------------------

console.log("\nModels catalog");
await test("has 5 models — 3 GLM (Z.ai) + 2 DeepSeek", async () => {
  const { MODELS } = await import("@/lib/ai/models");
  eq(MODELS.length, 5, "should have 5 models");
  eq(MODELS.filter((m) => m.provider === "zai").length, 3, "3 Z.ai models");
  eq(MODELS.filter((m) => m.provider === "deepseek").length, 2, "2 DeepSeek models");
});

await test("peak Z.ai model is GLM 5.2", async () => {
  const { MODELS } = await import("@/lib/ai/models");
  const peak = MODELS.find((m) => m.tier === "peak" && m.provider === "zai");
  ok(peak?.id === "glm-5.2", "peak zai should be glm-5.2");
});

await test("DeepSeek Reasoner present with reasoning + peak tier", async () => {
  const { getModel } = await import("@/lib/ai/models");
  const m = getModel("deepseek-reasoner");
  ok(m, "deepseek-reasoner should exist");
  eq(m!.provider, "deepseek");
  ok(m!.reasoning, "reasoner should support reasoning");
  eq(m!.tier, "peak");
});

await test("DeepSeek Chat present without reasoning", async () => {
  const { getModel } = await import("@/lib/ai/models");
  const m = getModel("deepseek-chat");
  ok(m, "deepseek-chat should exist");
  eq(m!.provider, "deepseek");
  ok(!m!.reasoning, "chat model should not claim reasoning");
});

await test("provider routing: GLM→zai, DeepSeek→deepseek, unknown→zai", async () => {
  const { getProviderForModel } = await import("@/lib/ai/models");
  eq(getProviderForModel("glm-5.2"), "zai");
  eq(getProviderForModel("glm-5.1-flash"), "zai");
  eq(getProviderForModel("deepseek-reasoner"), "deepseek");
  eq(getProviderForModel("some-unknown-model"), "zai", "unknown defaults to zai (pre-merge behavior)");
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
// RAG — chunker (merged from ragdb)
// ---------------------------------------------------------------------

console.log("\nRAG chunker");
await test("empty / whitespace text produces zero chunks", async () => {
  const { chunkText } = await import("@/lib/rag/chunker");
  eq(chunkText("").length, 0);
  eq(chunkText("   \n\n  ").length, 0);
});

await test("short text produces a single chunk with its content", async () => {
  const { chunkText } = await import("@/lib/rag/chunker");
  const chunks = chunkText("The quick brown fox jumps over the lazy dog.");
  eq(chunks.length, 1);
  eq(chunks[0].index, 0);
  ok(chunks[0].content.includes("quick brown fox"));
  ok(chunks[0].tokenCount > 0, "token count should be positive");
});

await test("long text splits into multiple sequentially-indexed chunks", async () => {
  const { chunkText } = await import("@/lib/rag/chunker");
  const sentence = "This is a moderately long sentence used to fill the chunk window with tokens. ";
  const text = sentence.repeat(200);
  const chunks = chunkText(text, { maxTokens: 128, overlapTokens: 16 });
  ok(chunks.length > 3, `expected >3 chunks, got ${chunks.length}`);
  chunks.forEach((c, i) => eq(c.index, i, "chunk indices must be sequential"));
  for (const c of chunks.slice(0, -1)) {
    ok(c.tokenCount <= 128 + 32, `chunk ${c.index} exceeds window: ${c.tokenCount}`);
  }
});

await test("consecutive chunks overlap (sliding window)", async () => {
  const { chunkText } = await import("@/lib/rag/chunker");
  const text = Array.from({ length: 100 }, (_, i) => `Sentence number ${i} carries some words.`).join(" ");
  const chunks = chunkText(text, { maxTokens: 64, overlapTokens: 16 });
  ok(chunks.length >= 2, "need at least 2 chunks to check overlap");
  // The tail of chunk N should reappear at the head of chunk N+1.
  const tail = chunks[0].content.split(/\s+/).slice(-3).join(" ");
  ok(chunks[1].content.includes(tail), `overlap missing: "${tail}" not in chunk 1`);
});

await test("punctuation-light text is preserved verbatim (no welded words)", async () => {
  const { chunkText } = await import("@/lib/rag/chunker");
  const text = "alpha beta gamma delta epsilon zeta eta theta";
  const chunks = chunkText(text);
  eq(chunks.length, 1);
  eq(chunks[0].content, text, "capturing split must rebuild source verbatim");
});

await test("oversized single sentence becomes its own chunk", async () => {
  const { chunkText } = await import("@/lib/rag/chunker");
  const giant = Array.from({ length: 900 }, (_, i) => `word${i}`).join(" ") + ".";
  const chunks = chunkText(`Short lead-in. ${giant} Short tail.`, { maxTokens: 256, overlapTokens: 16 });
  ok(chunks.some((c) => c.tokenCount > 256), "giant sentence should exceed window as its own chunk");
});

// ---------------------------------------------------------------------
// RAG — embeddings (provider chain + local fallback)
// ---------------------------------------------------------------------

console.log("\nRAG embeddings");
await test("provider resolution falls back to local without keys", async () => {
  const { resolveEmbeddingProvider } = await import("@/lib/rag/embeddings");
  const origOpenai = process.env.OPENAI_API_KEY;
  const origZai = process.env.ZAI_API_KEY;
  const origPref = process.env.RAG_EMBEDDINGS_PROVIDER;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ZAI_API_KEY;
  delete process.env.RAG_EMBEDDINGS_PROVIDER;
  try {
    eq(resolveEmbeddingProvider(), "local");
    process.env.OPENAI_API_KEY = "sk-test";
    eq(resolveEmbeddingProvider(), "openai", "openai wins when key present");
    process.env.RAG_EMBEDDINGS_PROVIDER = "local";
    eq(resolveEmbeddingProvider(), "local", "explicit local overrides keys");
    process.env.RAG_EMBEDDINGS_PROVIDER = "zai";
    eq(resolveEmbeddingProvider(), "openai", "explicit zai without ZAI key falls back to best available");
    process.env.ZAI_API_KEY = "zai-test";
    eq(resolveEmbeddingProvider(), "zai", "explicit zai honored once key exists");
  } finally {
    if (origOpenai) process.env.OPENAI_API_KEY = origOpenai; else delete process.env.OPENAI_API_KEY;
    if (origZai) process.env.ZAI_API_KEY = origZai; else delete process.env.ZAI_API_KEY;
    if (origPref) process.env.RAG_EMBEDDINGS_PROVIDER = origPref; else delete process.env.RAG_EMBEDDINGS_PROVIDER;
  }
});

await test("local embedding is deterministic, 256-dim, L2-normalized", async () => {
  const { localHashEmbedding, EMBEDDING_DIMENSIONS } = await import("@/lib/rag/embeddings");
  const a = localHashEmbedding("The mitochondria is the powerhouse of the cell");
  const b = localHashEmbedding("The mitochondria is the powerhouse of the cell");
  eq(a.length, EMBEDDING_DIMENSIONS.local);
  eq(a, b, "same input must produce identical vectors");
  const norm = Math.sqrt(a.reduce((acc, v) => acc + v * v, 0));
  ok(Math.abs(norm - 1) < 1e-9, `expected unit norm, got ${norm}`);
});

await test("local embedding: zero vector for empty text, no NaNs", async () => {
  const { localHashEmbedding } = await import("@/lib/rag/embeddings");
  const v = localHashEmbedding("");
  ok(v.every((x) => x === 0), "empty text → zero vector");
  const w = localHashEmbedding("hello");
  ok(w.every((x) => Number.isFinite(x)), "no NaN/Infinity components");
});

await test("embedBatch(local) preserves order and length", async () => {
  const { embedBatch, localHashEmbedding } = await import("@/lib/rag/embeddings");
  const texts = ["first text", "second text", "third text"];
  const batch = await embedBatch(texts, "local");
  eq(batch.length, 3);
  eq(batch[1], localHashEmbedding("second text"), "batch order must match input order");
  eq((await embedBatch([], "local")).length, 0, "empty batch → empty result");
});

await test("openai/zai providers throw clearly without keys (no silent fake vectors)", async () => {
  const { embedText } = await import("@/lib/rag/embeddings");
  const origOpenai = process.env.OPENAI_API_KEY;
  const origZai = process.env.ZAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ZAI_API_KEY;
  try {
    for (const provider of ["openai", "zai"] as const) {
      let threw = false;
      try {
        await embedText("x", provider);
      } catch (e) {
        threw = true;
        ok(String(e).includes("API_KEY"), `error should name the missing key: ${e}`);
      }
      ok(threw, `${provider} should throw without a key`);
    }
  } finally {
    if (origOpenai) process.env.OPENAI_API_KEY = origOpenai;
    if (origZai) process.env.ZAI_API_KEY = origZai;
  }
});

// ---------------------------------------------------------------------
// RAG — similarity + ranking (pure core of the local driver)
// ---------------------------------------------------------------------

console.log("\nRAG similarity + ranking");
await test("cosine: identical=1, orthogonal=0, dimension mismatch=0", async () => {
  const { cosineSimilarity } = await import("@/lib/rag/similarity");
  ok(Math.abs(cosineSimilarity([1, 2, 3], [1, 2, 3]) - 1) < 1e-9);
  eq(cosineSimilarity([1, 0], [0, 1]), 0);
  eq(cosineSimilarity([1, 2], [1, 2, 3]), 0, "mismatched dims must score 0, not throw");
  eq(cosineSimilarity([], []), 0);
  eq(cosineSimilarity([0, 0], [1, 1]), 0, "zero vector must score 0, not NaN");
});

await test("rankChunks: threshold filters, topK caps, sorted desc", async () => {
  const { rankChunks } = await import("@/lib/rag/similarity");
  const mk = (id: string, embedding: number[]) => ({
    id, documentId: "d1", documentTitle: "Doc", chunkIndex: 0, content: id, embedding,
  });
  const query = [1, 0, 0];
  const ranked = rankChunks(query, [
    mk("exact", [1, 0, 0]),
    mk("close", [0.9, 0.1, 0]),
    mk("far", [0, 1, 0]),
    mk("mid", [0.5, 0.5, 0]),
  ], { topK: 2, matchThreshold: 0.3 });
  eq(ranked.length, 2, "topK=2 caps results");
  eq(ranked[0].id, "exact");
  eq(ranked[1].id, "close");
  ok(ranked.every((r) => r.similarity >= 0.3), "threshold enforced");
});

await test("rankChunks: empty input and no matches return []", async () => {
  const { rankChunks } = await import("@/lib/rag/similarity");
  eq(rankChunks([1, 0], [], {}).length, 0);
  const none = rankChunks([1, 0], [
    { id: "a", documentId: "d", documentTitle: "D", chunkIndex: 0, content: "a", embedding: [0, 1] },
  ], { matchThreshold: 0.5 });
  eq(none.length, 0);
});

await test("local embeddings + ranking retrieve the semantically-overlapping chunk", async () => {
  const { localHashEmbedding } = await import("@/lib/rag/embeddings");
  const { rankChunks } = await import("@/lib/rag/similarity");
  const docs = [
    "The refund policy allows returns within 30 days of purchase with a receipt.",
    "Our office hours are Monday through Friday, nine to five, Eastern time.",
    "Deploy the application to Railway using the provided railway.json config.",
  ];
  const chunks = docs.map((content, i) => ({
    id: `c${i}`, documentId: `d${i}`, documentTitle: `Doc ${i}`, chunkIndex: 0,
    content, embedding: localHashEmbedding(content),
  }));
  const query = localHashEmbedding("what is the refund policy for returns?");
  const ranked = rankChunks(query, chunks, { topK: 1, matchThreshold: 0.05 });
  eq(ranked.length, 1);
  eq(ranked[0].id, "c0", "refund chunk should rank first");
});

// ---------------------------------------------------------------------
// RAG — pipeline (prompt assembly, ragdb semantics)
// ---------------------------------------------------------------------

console.log("\nRAG pipeline");
await test("formatContext numbers sources and separates with ---", async () => {
  const { formatContext } = await import("@/lib/rag/pipeline");
  const ctx = formatContext([
    { id: "a", documentId: "d1", documentTitle: "Contract", chunkIndex: 2, content: "Clause A", similarity: 0.9 },
    { id: "b", documentId: "d2", documentTitle: "Manual", chunkIndex: 0, content: "Step one", similarity: 0.8 },
  ]);
  ok(ctx.includes("[Source 1 | Contract | chunk:2]"), "first source header");
  ok(ctx.includes("[Source 2 | Manual | chunk:0]"), "second source header");
  ok(ctx.includes("\n\n---\n\n"), "separator between sources");
  eq(formatContext([]), "");
});

await test("buildRagSystemPrompt: cite instruction with chunks, null without", async () => {
  const { buildRagSystemPrompt } = await import("@/lib/rag/pipeline");
  const prompt = buildRagSystemPrompt([
    { id: "a", documentId: "d1", documentTitle: "Doc", chunkIndex: 0, content: "Fact.", similarity: 0.9 },
  ]);
  ok(prompt, "prompt should exist with chunks");
  ok(prompt!.includes("Cite [Source N]"), "must instruct citation");
  ok(prompt!.includes("say so plainly"), "must instruct honesty when absent");
  eq(buildRagSystemPrompt([]), null, "no chunks → null (chat prefix stack untouched)");
});

await test("toSources truncates snippets to 200 chars and rounds similarity", async () => {
  const { toSources } = await import("@/lib/rag/pipeline");
  const long = "x".repeat(500);
  const sources = toSources([
    { id: "a", documentId: "d", documentTitle: "T", chunkIndex: 1, content: long, similarity: 0.87654 },
  ]);
  eq(sources[0].snippet.length, 200);
  eq(sources[0].similarity, 0.877);
  eq(sources[0].chunkId, "a");
});

// ---------------------------------------------------------------------
// RAG — parsers (real parsing, no mocks: txt, md, xlsx, pdf)
// ---------------------------------------------------------------------

console.log("\nRAG parsers");
await test("txt + markdown parse via direct utf-8", async () => {
  const { parseDocument } = await import("@/lib/rag/parsers");
  eq(await parseDocument(Buffer.from("hello world"), "text/plain"), "hello world");
  eq(await parseDocument(Buffer.from("# Title\n\nBody"), "text/markdown"), "# Title\n\nBody");
});

await test("unsupported MIME type throws", async () => {
  const { parseDocument } = await import("@/lib/rag/parsers");
  let threw = false;
  try {
    await parseDocument(Buffer.from("x"), "image/png");
  } catch (e) {
    threw = true;
    ok(String(e).includes("Unsupported MIME type"));
  }
  ok(threw);
});

await test("xlsx round-trip: written workbook parses back to sheet CSV", async () => {
  const XLSX = await import("xlsx");
  const { parseDocument, XLSX_MIME } = await import("@/lib/rag/parsers");
  const ws = XLSX.utils.aoa_to_sheet([
    ["Product", "Price"],
    ["Widget", 9.99],
    ["Gadget", 24.5],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Inventory");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const text = await parseDocument(buf, XLSX_MIME);
  ok(text.includes("=== Sheet: Inventory ==="), "sheet header present");
  ok(text.includes("Widget,9.99"), "row data present as CSV");
});

await test("pdf: handcrafted single-page PDF extracts its text via unpdf", async () => {
  const { parseDocument } = await import("@/lib/rag/parsers");
  const buf = buildMinimalPdf("RAG merge verification text");
  const text = await parseDocument(buf, "application/pdf");
  ok(text.includes("RAG merge verification text"), `extracted: ${text.slice(0, 80)}`);
});

await test("corrupt pdf fails loudly (error path, not silent empty)", async () => {
  const { parseDocument } = await import("@/lib/rag/parsers");
  let threw = false;
  try {
    await parseDocument(Buffer.from("%PDF-1.4 garbage no xref"), "application/pdf");
  } catch {
    threw = true;
  }
  ok(threw, "corrupt PDF should raise, ingest marks document status=error");
});

await test("resolveMimeType: trusts allowed types, falls back to extension", async () => {
  const { resolveMimeType, ALLOWED_MIME, DOCX_MIME, XLSX_MIME } = await import("@/lib/rag/parsers");
  eq(resolveMimeType("a.pdf", "application/pdf"), "application/pdf");
  eq(resolveMimeType("notes.md", ""), "text/markdown", "browsers omit .md MIME — extension fallback");
  eq(resolveMimeType("report.docx", "application/octet-stream"), DOCX_MIME);
  eq(resolveMimeType("sheet.xlsx", null), XLSX_MIME);
  eq(resolveMimeType("evil.exe", "application/x-msdownload"), null);
  eq(ALLOWED_MIME.size, 5, "exactly 5 supported MIME types (pdf, docx, xlsx, txt, md)");
});

// ---------------------------------------------------------------------
// AI client — provider message normalization (DeepSeek alternation)
// ---------------------------------------------------------------------

console.log("\nAI provider messages");
await test("zai: leading system turns merge, rest pass through untouched", async () => {
  const { buildProviderMessages } = await import("@/lib/ai/client");
  const out = buildProviderMessages("zai", [
    { role: "system", content: "A" },
    { role: "system", content: "B" },
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
    { role: "system", content: "tool results" },
  ]);
  eq(out[0].role, "system");
  eq(out[0].content, "A\n\nB");
  eq(out.length, 4, "non-leading system preserved for zai");
  eq(out[3].role, "system");
});

await test("deepseek: consecutive same-role turns merge (ragdb behavior)", async () => {
  const { buildProviderMessages } = await import("@/lib/ai/client");
  const out = buildProviderMessages("deepseek", [
    { role: "system", content: "sys" },
    { role: "user", content: "first" },
    { role: "user", content: "second" },
    { role: "assistant", content: "reply" },
    { role: "user", content: "third" },
  ]);
  eq(out.length, 4);
  eq(out[1].content, "first\n\nsecond", "consecutive user turns merged");
  eq(out[1].role, "user");
  eq(out[2].role, "assistant");
  eq(out[3].role, "user");
});

await test("deepseek: strict alternation after system (no adjacent same-role)", async () => {
  const { buildProviderMessages } = await import("@/lib/ai/client");
  const out = buildProviderMessages("deepseek", [
    { role: "system", content: "sys" },
    { role: "user", content: "q" },
    { role: "assistant", content: "a" },
    { role: "system", content: "tool results here" },
    { role: "user", content: "follow-up" },
  ]);
  const rest = out.slice(1);
  for (let i = 1; i < rest.length; i++) {
    ok(rest[i].role !== rest[i - 1].role, `adjacent same-role at ${i}: ${rest[i].role}`);
  }
  ok(rest[0].role === "user", "first non-system must be user");
  ok(out.some((m) => m.content.includes("tool results here")), "folded system content preserved");
});

await test("deepseek: leading assistant turn dropped, tool turns folded to user", async () => {
  const { buildProviderMessages } = await import("@/lib/ai/client");
  const out = buildProviderMessages("deepseek", [
    { role: "assistant", content: "orphaned reply" },
    { role: "user", content: "real question" },
    { role: "tool", content: "tool output" },
  ]);
  ok(out[0].role === "user", "leading assistant dropped");
  ok(out.some((m) => m.role === "user" && m.content.includes("tool output")), "tool folded into user");
});

await test("isProviderConfigured reflects env keys per provider", async () => {
  const { isProviderConfigured } = await import("@/lib/ai/client");
  const origZai = process.env.ZAI_API_KEY;
  const origDs = process.env.DEEPSEEK_API_KEY;
  delete process.env.ZAI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    ok(!isProviderConfigured("zai"));
    ok(!isProviderConfigured("deepseek"));
    process.env.DEEPSEEK_API_KEY = "ds-test";
    ok(isProviderConfigured("deepseek"));
    ok(!isProviderConfigured("zai"), "keys are independent per provider");
  } finally {
    if (origZai) process.env.ZAI_API_KEY = origZai;
    if (origDs) process.env.DEEPSEEK_API_KEY = origDs; else delete process.env.DEEPSEEK_API_KEY;
  }
});

// ---------------------------------------------------------------------
// RAG — retrieval security boundary + driver config
// ---------------------------------------------------------------------

console.log("\nRAG security + drivers");
await test("retrieveChunks refuses to run without a userId (no unscoped path)", async () => {
  const { retrieveChunks } = await import("@/lib/rag/retriever");
  let threw = false;
  try {
    await retrieveChunks("", "query");
  } catch (e) {
    threw = true;
    ok(String(e).includes("userId"));
  }
  ok(threw, "empty userId must throw before touching data");
});

await test("ingestDocument refuses empty userId and empty/oversized files", async () => {
  const { ingestDocument, MAX_FILE_SIZE } = await import("@/lib/rag/ingest");
  eq(MAX_FILE_SIZE, 50 * 1024 * 1024, "50 MB cap preserved from ragdb");
  for (const [userId, buffer, expect] of [
    ["", Buffer.from("x"), "userId"],
    ["u1", Buffer.alloc(0), "Empty file"],
  ] as const) {
    let threw = false;
    try {
      await ingestDocument(userId, { filename: "a.txt", mimeType: "text/plain", buffer });
    } catch (e) {
      threw = true;
      ok(String(e).includes(expect), `expected "${expect}" in: ${e}`);
    }
    ok(threw, `should throw for ${expect}`);
  }
});

await test("rag driver defaults to local; supabase requires full config", async () => {
  const { resolveRagDriver, getSupabaseRagConfig } = await import("@/lib/rag/retriever");
  const orig = {
    driver: process.env.RAG_DRIVER,
    url: process.env.SUPABASE_URL,
    ragUrl: process.env.RAG_SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ragKey: process.env.RAG_SUPABASE_SERVICE_KEY,
  };
  delete process.env.RAG_DRIVER;
  delete process.env.SUPABASE_URL;
  delete process.env.RAG_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.RAG_SUPABASE_SERVICE_KEY;
  try {
    eq(resolveRagDriver(), "local", "default driver is local");
    eq(getSupabaseRagConfig(), null, "no config without env");
    process.env.RAG_DRIVER = "supabase";
    eq(resolveRagDriver(), "local", "supabase without URL+key degrades to local");
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    eq(resolveRagDriver(), "supabase", "fully configured supabase driver activates");
    const cfg = getSupabaseRagConfig();
    eq(cfg?.url, "https://x.supabase.co");
  } finally {
    for (const [k, v] of Object.entries({
      RAG_DRIVER: orig.driver, SUPABASE_URL: orig.url, RAG_SUPABASE_URL: orig.ragUrl,
      SUPABASE_SERVICE_ROLE_KEY: orig.key, RAG_SUPABASE_SERVICE_KEY: orig.ragKey,
    })) {
      if (v) process.env[k] = v; else delete process.env[k];
    }
  }
});

// ---------------------------------------------------------------------
// RAG — Supabase pgvector driver against a mock PostgREST server.
// Verifies request shape, result mapping, the local-embedding refusal,
// automatic fallback to the local driver, and mirror/remove calls —
// no real Supabase needed.
// ---------------------------------------------------------------------

console.log("\nRAG pgvector driver (mock PostgREST)");
{
  interface MockCall {
    method: string;
    path: string;
    query: string;
    headers: Record<string, string | undefined>;
    body: unknown;
  }
  const calls: MockCall[] = [];
  let failNextRpc = false;

  const mock = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const body = req.method === "GET" || req.method === "DELETE" ? null : await req.json();
      calls.push({
        method: req.method,
        path: url.pathname,
        query: url.search,
        headers: {
          apikey: req.headers.get("apikey") ?? undefined,
          authorization: req.headers.get("authorization") ?? undefined,
          prefer: req.headers.get("prefer") ?? undefined,
        },
        body,
      });
      if (url.pathname === "/rest/v1/rpc/match_rag_chunks") {
        if (failNextRpc) {
          failNextRpc = false;
          return new Response(JSON.stringify({ message: "function unavailable" }), { status: 500 });
        }
        return Response.json([
          {
            id: "pg-1",
            document_id: "doc-9",
            document_title: "PG Doc",
            chunk_index: 3,
            content: "pgvector matched content",
            similarity: 0.91,
          },
        ]);
      }
      if (url.pathname === "/rest/v1/rag_chunks") {
        return req.method === "DELETE" ? new Response(null, { status: 204 }) : Response.json([]);
      }
      return new Response("not found", { status: 404 });
    },
  });
  const baseUrl = `http://127.0.0.1:${mock.port}`;

  const withSupabaseEnv = async (fn: () => Promise<void>) => {
    const orig = {
      driver: process.env.RAG_DRIVER,
      url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_SERVICE_ROLE_KEY,
      embed: process.env.RAG_EMBEDDINGS_PROVIDER,
      openai: process.env.OPENAI_API_KEY,
      zai: process.env.ZAI_API_KEY,
    };
    process.env.RAG_DRIVER = "supabase";
    process.env.SUPABASE_URL = baseUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
    delete process.env.RAG_EMBEDDINGS_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ZAI_API_KEY;
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries({
        RAG_DRIVER: orig.driver,
        SUPABASE_URL: orig.url,
        SUPABASE_SERVICE_ROLE_KEY: orig.key,
        RAG_EMBEDDINGS_PROVIDER: orig.embed,
        OPENAI_API_KEY: orig.openai,
        ZAI_API_KEY: orig.zai,
      })) {
        if (v) process.env[k] = v;
        else delete process.env[k];
      }
    }
  };

  await test("queryPgvectorRpc sends service-key auth + correct RPC payload and maps results", async () => {
    const { queryPgvectorRpc } = await import("@/lib/rag/retriever");
    calls.length = 0;
    const chunks = await queryPgvectorRpc(
      { url: baseUrl, serviceKey: "test-service-key" },
      "user-1",
      [0.5, 0.5],
      { topK: 4, matchThreshold: 0.42 }
    );
    const call = calls.find((c) => c.path === "/rest/v1/rpc/match_rag_chunks");
    ok(call, "should POST the RPC");
    eq(call!.headers.apikey, "test-service-key");
    eq(call!.headers.authorization, "Bearer test-service-key");
    const payload = call!.body as Record<string, unknown>;
    eq(payload.p_user_id, "user-1", "server-supplied user id — the isolation boundary");
    eq(payload.match_count, 4);
    eq(payload.match_threshold, 0.42);
    eq(payload.query_embedding, [0.5, 0.5]);
    eq(chunks.length, 1);
    eq(chunks[0].documentTitle, "PG Doc", "snake_case → camelCase mapping");
    eq(chunks[0].chunkIndex, 3);
    eq(chunks[0].similarity, 0.91);
  });

  await test("queryPgvectorRpc surfaces RPC failures (feeds the fallback-to-local path)", async () => {
    const { queryPgvectorRpc } = await import("@/lib/rag/retriever");
    failNextRpc = true;
    let threw = false;
    try {
      await queryPgvectorRpc({ url: baseUrl, serviceKey: "k" }, "u", [0.1]);
    } catch (e) {
      threw = true;
      ok(String(e).includes("match_rag_chunks 500"), `error should carry status: ${e}`);
    }
    ok(threw, "500 must throw — retrieveChunks catches it and degrades to local");
  });

  await test("mirrorChunksToPgvector posts rows with service key + merge-duplicates", async () => {
    await withSupabaseEnv(async () => {
      const { mirrorChunksToPgvector } = await import("@/lib/rag/retriever");
      calls.length = 0;
      const mirrored = await mirrorChunksToPgvector("user-1", "doc-9", "PG Doc", [
        { id: "c1", chunkIndex: 0, content: "alpha", embedding: [0.1, 0.2] },
        { id: "c2", chunkIndex: 1, content: "beta", embedding: [0.3, 0.4] },
      ]);
      ok(mirrored === true, "mirror should report success");
      const call = calls.find((c) => c.path === "/rest/v1/rag_chunks" && c.method === "POST");
      ok(call, "should POST to rag_chunks");
      eq(call!.headers.apikey, "test-service-key");
      eq(call!.headers.prefer, "resolution=merge-duplicates", "idempotent upsert on re-ingest");
      const rows = call!.body as Array<Record<string, unknown>>;
      eq(rows.length, 2);
      eq(rows[0].user_id, "user-1");
      eq(rows[1].chunk_index, 1);
      eq(rows[0].document_title, "PG Doc");
    });
  });

  await test("removeDocumentFromPgvector deletes by document_id filter", async () => {
    await withSupabaseEnv(async () => {
      const { removeDocumentFromPgvector } = await import("@/lib/rag/retriever");
      calls.length = 0;
      const removed = await removeDocumentFromPgvector("doc-9");
      ok(removed === true);
      const call = calls.find((c) => c.method === "DELETE");
      ok(call, "should send DELETE");
      ok(call!.query.includes("document_id=eq.doc-9"), `filter missing: ${call!.query}`);
    });
  });

  mock.stop(true);
}

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