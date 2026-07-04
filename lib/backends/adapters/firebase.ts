import type { Backend, BackendContext, BackendQueryResult } from "../registry";
import "@/lib/server-guard";

/**
 * Firebase backend — Firestore. REAL implementation.
 * ---------------------------------------------------------------------
 * Auth: service account JSON (full contents pasted into `serviceAccount`).
 * Get from: Firebase Console → Project Settings → Service Accounts →
 *           Generate New Private Key
 *
 * Free tier: 1GB Firestore storage, 10K writes/day, 50K reads/day.
 * Docs: https://firebase.google.com/docs/admin/setup
 *
 * Query format: "collection/op/[docId|filterJson]"
 *   "users/list"           — list first 100 docs in users
 *   "users/get/abc123"     — get specific doc
 *   "users/where/field/value" — where field == value
 *
 * `firebase-admin` is lazy-loaded. App is cached per projectId.
 */

let _appMod: typeof import("firebase-admin/app") | null = null;
let _firestoreMod: typeof import("firebase-admin/firestore") | null = null;

async function loadFirebase() {
  if (!_appMod) {
    _appMod = await import("firebase-admin/app");
    _firestoreMod = await import("firebase-admin/firestore");
  }
  return { appMod: _appMod!, firestoreMod: _firestoreMod! };
}

import type { App } from "firebase-admin/app";
import type { Firestore } from "firebase-admin/firestore";

const appCache = new Map<string, App>();

async function getApp(serviceAccountJson: string): Promise<App> {
  const parsed = JSON.parse(serviceAccountJson);
  const projectId = parsed.project_id;
  if (!projectId) throw new Error("Service account missing project_id");
  if (appCache.has(projectId)) return appCache.get(projectId)!;
  const { appMod } = await loadFirebase();
  const { initializeApp, cert, getApps } = appMod;
  const existing = getApps().find((a) => a.name === projectId);
  const app = existing ?? initializeApp({ credential: cert(parsed) }, projectId);
  appCache.set(projectId, app);
  return app;
}

async function getDb(serviceAccountJson: string): Promise<Firestore> {
  const { firestoreMod } = await loadFirebase();
  return firestoreMod.getFirestore(await getApp(serviceAccountJson));
}

export const firebaseBackend: Backend = {
  manifest: {
    id: "firebase",
    label: "Firebase",
    description: "Firestore + Auth + Storage. Free tier: 1GB Firestore, 10K writes/day.",
    iconKey: "firebase",
    requiredFields: [
      { key: "serviceAccount", label: "Service Account JSON", type: "password", placeholder: '{"type":"service_account",...}', required: true },
    ],
    optionalFields: [
      { key: "projectId", label: "Project ID (auto-extracted if omitted)", type: "string", placeholder: "my-app-12345", required: false },
    ],
    strengths: ["Realtime sync", "Offline-first SDK", "Auth", "Serverless functions"],
    docsUrl: "https://firebase.google.com/docs/admin/setup",
  },

  async testConnection(ctx: BackendContext) {
    const sa = ctx.credentials.serviceAccount;
    if (!sa) return { ok: false, message: "Service account JSON required." };
    let parsed: any;
    try {
      parsed = JSON.parse(sa);
    } catch {
      return { ok: false, message: "Service account is not valid JSON." };
    }
    if (parsed.type !== "service_account") {
      return { ok: false, message: "JSON must have type='service_account'." };
    }
    if (!parsed.project_id) {
      return { ok: false, message: "Service account missing project_id." };
    }
    try {
      const db = await getDb(sa);
      const docRef = db.collection("_health").doc("ping");
      await docRef.set({ ok: true, ts: Date.now() });
      await docRef.delete();
      return { ok: true, message: `Firebase connected (project: ${parsed.project_id}).` };
    } catch (e) {
      return { ok: false, message: `Firebase error: ${(e as Error).message}` };
    }
  },

  async query(ctx: BackendContext, q: string): Promise<BackendQueryResult> {
    const sa = ctx.credentials.serviceAccount;
    if (!sa) return { rows: [], count: 0, durationMs: 0 };
    const parts = q.split("/");
    if (parts.length < 2) return { rows: [], count: 0, durationMs: 0 };
    const [collection, op, ...rest] = parts;
    const start = Date.now();
    try {
      const db = await getDb(sa);
      if (op === "list") {
        const snap = await db.collection(collection).limit(100).get();
        return {
          rows: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
          count: snap.size,
          durationMs: Date.now() - start,
        };
      }
      if (op === "get") {
        const docId = rest.join("/");
        const doc = await db.collection(collection).doc(docId).get();
        if (!doc.exists) return { rows: [], count: 0, durationMs: Date.now() - start };
        return {
          rows: [{ id: doc.id, ...doc.data() }],
          count: 1,
          durationMs: Date.now() - start,
        };
      }
      if (op === "where") {
        const [field, value] = rest;
        const snap = await db.collection(collection).where(field, "==", value).limit(100).get();
        return {
          rows: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
          count: snap.size,
          durationMs: Date.now() - start,
        };
      }
      return { rows: [], count: 0, durationMs: Date.now() - start };
    } catch {
      return { rows: [], count: 0, durationMs: Date.now() - start };
    }
  },

  async push(ctx: BackendContext, table: string, record: Record<string, unknown>) {
    const sa = ctx.credentials.serviceAccount;
    if (!sa) return { ok: false };
    try {
      const db = await getDb(sa);
      const docRef = await db.collection(table).add(record);
      return { ok: true, id: docRef.id };
    } catch {
      return { ok: false };
    }
  },

  async list(ctx: BackendContext) {
    const sa = ctx.credentials.serviceAccount;
    if (!sa) return [];
    try {
      const db = await getDb(sa);
      const collections = await db.listCollections();
      return collections.map((c) => ({
        id: c.id,
        name: c.id,
        type: "collection",
      }));
    } catch {
      return [];
    }
  },
};
