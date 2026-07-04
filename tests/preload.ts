/**
 * Bun preload for tests.
 * Stubs `server-only` package so server-only modules can be imported
 * in the test runner without triggering the React server-only guard.
 *
 * This is safe: in production, Next.js's bundler applies the
 * `react-server` export condition which resolves `server-only` to
 * its no-op `empty.js` for server components. The throwing
 * `index.js` is only the client-component safety net. Tests don't
 * have that distinction, so we stub it.
 */

import { plugin } from "bun";

plugin({
  name: "server-only-stub",
  setup(build) {
    build.onResolve({ filter: /^server-only$/ }, () => ({
      // Resolve sibling stub-server-only.ts in this directory.
      path: Bun.resolveSync("./stub-server-only.ts", import.meta.dir),
      namespace: "file",
    }));
  },
});
