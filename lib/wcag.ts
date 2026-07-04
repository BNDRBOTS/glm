/**
 * WCAG 2.1 contrast ratio calculator.
 * ---------------------------------------------------------------------
 * Computes the contrast ratio between two hex colors.
 * Returns a number >= 1.0 (1 = no contrast, 21 = max contrast).
 *
 * WCAG thresholds:
 *   AA: 4.5:1 for normal text, 3:1 for large text (≥18pt or 14pt bold)
 *   AAA: 7:1 for normal text, 4.5:1 for large text
 *   1.4.11: 3:1 for non-text UI components (borders, icons)
 *
 * Used by:
 *   - tests/index.ts (automated contrast tests for every theme)
 *   - /api/wcag/contrast (runtime check endpoint)
 */

export interface ContrastResult {
  ratio: number;
  passes: {
    aa: boolean;        // 4.5:1
    aaLarge: boolean;   // 3:1
    aaa: boolean;       // 7:1
    aaaLarge: boolean;  // 4.5:1
    uiComponent: boolean; // 3:1 (WCAG 1.4.11)
  };
  asString: string;
}

export function contrastRatio(foreground: string, background: string): ContrastResult {
  const fg = hexToRgb(foreground);
  const bg = hexToRgb(background);
  if (!fg || !bg) {
    return {
      ratio: 0,
      passes: { aa: false, aaLarge: false, aaa: false, aaaLarge: false, uiComponent: false },
      asString: "0:1 (invalid color)",
    };
  }
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  const ratio = (lighter + 0.05) / (darker + 0.05);
  return {
    ratio,
    passes: {
      aa: ratio >= 4.5,
      aaLarge: ratio >= 3,
      aaa: ratio >= 7,
      aaaLarge: ratio >= 4.5,
      uiComponent: ratio >= 3,
    },
    asString: `${ratio.toFixed(2)}:1`,
  };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.replace("#", "").match(/^([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!m) return null;
  const full = m[1].length === 3
    ? m[1].split("").map((c) => c + c).join("")
    : m[1];
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return { r, g, b };
}

function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const rLin = channelToLinear(r);
  const gLin = channelToLinear(g);
  const bLin = channelToLinear(b);
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

function channelToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/**
 * Composite an rgba color over a background hex color.
 * Returns the resulting hex color the user actually sees.
 *
 * e.g. composite("rgba(255,255,255,0.07)", "#000000") → "#121212"
 *
 * This is necessary because backdrop-filter + rgba backgrounds
 * composite over whatever is behind them. The contrast must be
 * measured against the ACTUAL rendered color, not the raw rgba.
 */
export function composite(rgba: string, background: string): string {
  const bg = hexToRgb(background);
  if (!bg) return background;
  const m = rgba.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (!m) return rgba;
  const r = parseInt(m[1]);
  const g = parseInt(m[2]);
  const b = parseInt(m[3]);
  const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
  const outR = Math.round(r * a + bg.r * (1 - a));
  const outG = Math.round(g * a + bg.g * (1 - a));
  const outB = Math.round(b * a + bg.b * (1 - a));
  return `#${outR.toString(16).padStart(2, "0")}${outG.toString(16).padStart(2, "0")}${outB.toString(16).padStart(2, "0")}`;
}

/**
 * Every color pair that must pass WCAG AA in this app.
 * Each entry: [label, foreground, background, requiredLevel]
 *
 * Required levels:
 *   "aa"       — 4.5:1 (normal text < 18pt)
 *   "aa-large" — 3:1 (large text ≥ 18pt or ≥ 14pt bold)
 *   "ui"       — 3:1 (non-text UI components per WCAG 1.4.11)
 *
 * Surfaces are PRE-COMPOSITED: rgba backgrounds are composited over
 * their actual base (usually #000000 in dark, #ffffff in light) to
 * get the hex the user's eye actually perceives.
 */
export const REQUIRED_PAIRS: Array<[string, string, string, "aa" | "aa-large" | "ui"]> = [
  // ── DARK MODE: text on body background (#000000) ──
  ["Dark: foreground on body", "#f5f5f7", "#000000", "aa"],
  ["Dark: muted-foreground on body", "#8e8e93", "#000000", "aa"],
  ["Dark: destructive on body", "#ff453a", "#000000", "aa-large"],

  // ── DARK MODE: text on glass (rgba(255,255,255,0.04) over #000 = #0a0a0a) ──
  ["Dark: foreground on glass", "#f5f5f7", "#0a0a0a", "aa"],
  ["Dark: muted-foreground on glass", "#8e8e93", "#0a0a0a", "aa"],

  // ── DARK MODE: text on glass-strong (rgba(255,255,255,0.07) over #000 = #121212) ──
  // This is the COMPOSER surface — the one the user reported as broken.
  ["Dark: foreground on glass-strong (composer)", "#f5f5f7", "#121212", "aa"],
  ["Dark: muted-foreground on glass-strong (composer icons)", "#8e8e93", "#121212", "aa"],
  ["Dark: placeholder on glass-strong (composer placeholder)", "#8e8e93", "#121212", "aa"],

  // ── DARK MODE: text on glass-panel (rgba(255,255,255,0.03) over #000 = #080808) ──
  // This is the SIDEBAR surface.
  ["Dark: foreground on glass-panel (sidebar)", "#f5f5f7", "#080808", "aa"],
  ["Dark: muted-foreground on glass-panel (sidebar menu)", "#8e8e93", "#080808", "aa"],

  // ── DARK MODE: text on sidebar bg (rgba(10,10,12,0.6) over #000 = #060607) ──
  ["Dark: muted-foreground on sidebar", "#8e8e93", "#060607", "aa"],

  // ── DARK MODE: text on popover (rgba(20,20,22,0.95) over #000 = #131315) ──
  ["Dark: foreground on popover", "#f5f5f7", "#131315", "aa"],
  ["Dark: muted-foreground on popover", "#8e8e93", "#131315", "aa"],

  // ── DARK MODE: primary button (inverted: light bg, dark text) ──
  ["Dark: primary-foreground on primary", "#000000", "#f5f5f7", "aa"],

  // ── LIGHT MODE: text on body background (#ffffff) ──
  ["Light: foreground on body", "#0a0a0a", "#ffffff", "aa"],
  ["Light: muted-foreground on body", "#6e6e73", "#ffffff", "aa"],
  ["Light: destructive on body", "#ef4444", "#ffffff", "aa-large"],

  // ── LIGHT MODE: text on glass (rgba(255,255,255,0.7) over #fff = #ffffff) ──
  ["Light: foreground on glass", "#0a0a0a", "#ffffff", "aa"],
  ["Light: muted-foreground on glass", "#6e6e73", "#ffffff", "aa"],

  // ── LIGHT MODE: text on glass-strong (rgba(255,255,255,0.85) over #fff = #ffffff) ──
  ["Light: foreground on glass-strong (composer)", "#0a0a0a", "#ffffff", "aa"],
  ["Light: muted-foreground on glass-strong (composer icons)", "#6e6e73", "#ffffff", "aa"],

  // ── LIGHT MODE: text on glass-panel (rgba(255,255,255,0.6) over #fff = #ffffff) ──
  ["Light: foreground on glass-panel (sidebar)", "#0a0a0a", "#ffffff", "aa"],
  ["Light: muted-foreground on glass-panel (sidebar menu)", "#6e6e73", "#ffffff", "aa"],

  // ── LIGHT MODE: primary button ──
  ["Light: primary-foreground on primary", "#ffffff", "#0a0a0a", "aa"],
];

/**
 * Test every required color pair. Returns per-pair results + a summary.
 */
export function auditContrast(): {
  pairs: Array<{ label: string; fg: string; bg: string; required: string; result: ContrastResult; pass: boolean }>;
  summary: { total: number; passed: number; failed: number };
} {
  const pairs = REQUIRED_PAIRS.map(([label, fg, bg, required]) => {
    const result = contrastRatio(fg, bg);
    const pass = required === "aa" ? result.passes.aa : required === "aa-large" ? result.passes.aaLarge : result.passes.uiComponent;
    return { label, fg, bg, required, result, pass };
  });
  return {
    pairs,
    summary: {
      total: pairs.length,
      passed: pairs.filter((p) => p.pass).length,
      failed: pairs.filter((p) => !p.pass).length,
    },
  };
}
