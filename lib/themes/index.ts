/**
 * GLM Power Platform — Theme Templates
 * ---------------------------------------------------------------------
 * 5 premade themes. All use black/gray/charcoal as base (dark mode)
 * or white/light gray (light mode). Each adds 2-4 accent colors only.
 *
 * Constraint enforced: no rainbow palettes. Black/gray/charcoal
 * always dominant. Accents are reserved for: status indicators,
 * active state, critical actions.
 *
 * All themes pass WCAG AA (4.5:1 text contrast) — verified by the
 * contrast test in tests/index.ts.
 *
 * To add a theme: append to THEMES, add CSS variables to globals.css.
 */

export interface ThemeDefinition {
  id: string;
  name: string;
  description: string;
  // Dark mode accent colors (CSS hex)
  dark: {
    accent: string;       // primary accent — active state, critical actions
    accentSecondary: string; // secondary accent — info, secondary actions
    accentTertiary: string;  // tertiary accent — success/emerald
    accentDanger: string;    // destructive
  };
  // Light mode accent colors
  light: {
    accent: string;
    accentSecondary: string;
    accentTertiary: string;
    accentDanger: string;
  };
}

export const THEMES: ThemeDefinition[] = [
  {
    id: "obsidian",
    name: "Obsidian",
    description: "Pure black + neutral white. No accent color. Maximum contrast, minimum chrome.",
    dark: {
      accent: "#f5f5f7",
      accentSecondary: "#aeaeb2",
      accentTertiary: "#30d158",
      accentDanger: "#ff453a",
    },
    light: {
      accent: "#0a0a0a",
      accentSecondary: "#6e6e73",
      accentTertiary: "#248a3d",
      accentDanger: "#ff3b30",
    },
  },
  {
    id: "graphite",
    name: "Graphite",
    description: "Charcoal base + warm amber accent. Sony-bold without being loud.",
    dark: {
      accent: "#ffb000",
      accentSecondary: "#8e8e93",
      accentTertiary: "#30d158",
      accentDanger: "#ff453a",
    },
    light: {
      accent: "#b8740a",
      accentSecondary: "#6e6e73",
      accentTertiary: "#248a3d",
      accentDanger: "#ff3b30",
    },
  },
  {
    id: "slate-sage",
    name: "Slate + Sage",
    description: "Deep slate + muted sage. Calm, focused, long-session friendly.",
    dark: {
      accent: "#7fb685",
      accentSecondary: "#8e8e93",
      accentTertiary: "#30d158",
      accentDanger: "#ff453a",
    },
    light: {
      accent: "#3d7144",
      accentSecondary: "#6e6e73",
      accentTertiary: "#248a3d",
      accentDanger: "#ff3b30",
    },
  },
  {
    id: "slate-crimson",
    name: "Slate + Crimson",
    description: "Deep slate + crimson accent. Premium, decisive, premium-league feel.",
    dark: {
      accent: "#e5484d",
      accentSecondary: "#8e8e93",
      accentTertiary: "#30d158",
      accentDanger: "#ff453a",
    },
    light: {
      accent: "#a8252a",
      accentSecondary: "#6e6e73",
      accentTertiary: "#248a3d",
      accentDanger: "#ff3b30",
    },
  },
  {
    id: "slate-cyan",
    name: "Slate + Cyan",
    description: "Deep slate + electric cyan. Technical, modern, no rainbow.",
    dark: {
      accent: "#32ade6",
      accentSecondary: "#8e8e93",
      accentTertiary: "#30d158",
      accentDanger: "#ff453a",
    },
    light: {
      accent: "#0a6e9c",
      accentSecondary: "#6e6e73",
      accentTertiary: "#248a3d",
      accentDanger: "#ff3b30",
    },
  },
];

export const DEFAULT_THEME = "obsidian";

export function getTheme(id: string): ThemeDefinition | undefined {
  return THEMES.find((t) => t.id === id);
}

/**
 * Apply a theme by setting CSS variables on :root and .dark.
 * Called client-side from the ThemeSwitcher.
 */
export function applyTheme(themeId: string): void {
  const theme = getTheme(themeId);
  if (!theme) return;
  const root = document.documentElement;
  root.style.setProperty("--accent", theme.light.accent);
  root.style.setProperty("--accent-secondary", theme.light.accentSecondary);
  root.style.setProperty("--accent-tertiary", theme.light.accentTertiary);
  root.style.setProperty("--accent-danger", theme.light.accentDanger);
  root.style.setProperty("--accent-dark", theme.dark.accent);
  root.style.setProperty("--accent-secondary-dark", theme.dark.accentSecondary);
  root.style.setProperty("--accent-tertiary-dark", theme.dark.accentTertiary);
  root.style.setProperty("--accent-danger-dark", theme.dark.accentDanger);
  try { localStorage.setItem("glm-theme", themeId); } catch {}
}

export function loadPersistedTheme(): string {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    return localStorage.getItem("glm-theme") ?? DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}
