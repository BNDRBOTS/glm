import type { Connector, ConnectorContext } from "../registry";

/**
 * GitHub connector — drop-in PAT.
 * Get token: https://github.com/settings/tokens (repo scope)
 */
export const githubConnector: Connector = {
  manifest: {
    id: "github",
    label: "GitHub",
    description: "Connect GitHub repos. Pull files, push commits, manage issues.",
    category: "DEV",
    authType: "api_key",
    iconKey: "github",
    envKey: "GITHUB_TOKEN",
    authUrl: "https://github.com/settings/tokens",
    baseUrl: "https://api.github.com",
    capabilities: { search: true, fetch: true, list: true, push: true, query: true },
  },

  async testConnection(ctx: ConnectorContext) {
    const key = ctx.credentials.token || process.env.GITHUB_TOKEN;
    if (!key) return { ok: false, message: "No token. Paste a GitHub PAT with repo scope." };
    try {
      const r = await fetch(`${this.manifest.baseUrl}/user`, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/vnd.github+json" },
      });
      if (r.ok) {
        const u = await r.json();
        return { ok: true, message: `GitHub connected as @${u.login}.` };
      }
      return { ok: false, message: `GitHub rejected the token (${r.status}).` };
    } catch (e) {
      return { ok: false, message: `Network error: ${(e as Error).message}` };
    }
  },

  async list(ctx: ConnectorContext) {
    const key = ctx.credentials.token || process.env.GITHUB_TOKEN;
    if (!key) throw new Error("GitHub token not configured");
    const r = await fetch(`${this.manifest.baseUrl}/user/repos?per_page=50&sort=updated`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/vnd.github+json" },
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`GitHub list failed (${r.status}): ${txt.slice(0, 200)}`);
    }
    const j = await r.json();
    return (j ?? []).map((repo: any) => ({ id: repo.full_name, name: repo.full_name, type: "repo" }));
  },

  async fetch(ctx: ConnectorContext, id: string) {
    const key = ctx.credentials.token || process.env.GITHUB_TOKEN;
    if (!key) throw new Error("GitHub token not configured");
    const [owner, repo, ...pathParts] = id.split("/");
    if (!owner || !repo) throw new Error(`Invalid GitHub resource id: ${id}. Expected owner/repo/path`);
    const path = pathParts.join("/");
    const r = await fetch(`${this.manifest.baseUrl}/repos/${owner}/${repo}/contents/${path}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/vnd.github.raw" },
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`GitHub fetch failed (${r.status}): ${txt.slice(0, 200)}`);
    }
    const content = await r.text();
    return {
      id,
      title: path,
      content,
      url: `https://github.com/${owner}/${repo}/blob/main/${path}`,
      fetchedAt: new Date().toISOString(),
    };
  },

  async search(ctx: ConnectorContext, query: string, opts?: { limit?: number }) {
    const key = ctx.credentials.token || process.env.GITHUB_TOKEN;
    if (!key) throw new Error("GitHub token not configured");
    const r = await fetch(`${this.manifest.baseUrl}/search/code?q=${encodeURIComponent(query)}&per_page=${opts?.limit ?? 10}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/vnd.github+json" },
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`GitHub search failed (${r.status}): ${txt.slice(0, 200)}`);
    }
    const j = await r.json();
    return (j.items ?? []).map((item: any) => ({
      id: `${item.repository.full_name}/${item.path}`,
      title: item.name,
      snippet: item.text_matches?.[0]?.fragment,
      url: item.html_url,
      metadata: { repo: item.repository.full_name, path: item.path },
    }));
  },
};
