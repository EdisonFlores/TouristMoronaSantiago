import { db } from "../services/firebase.js";
import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const cache = new Map();        // name -> { data, ts }
const inflight = new Map();     // name -> Promise
const TTL_MS = 1000 * 60 * 10;  // 10 min

function isFresh(entry) {
  if (!entry) return false;
  return (Date.now() - entry.ts) < TTL_MS;
}

export async function getCollectionCache(name, { force = false } = {}) {
  const key = String(name || "").trim();
  if (!key) return [];

  const existing = cache.get(key);
  if (!force && isFresh(existing)) return existing.data;

  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    const snap = await getDocs(collection(db, key)); // ✅ SIN limit
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    cache.set(key, { data, ts: Date.now() });
    inflight.delete(key);
    return data;
  })().catch(err => {
    inflight.delete(key);
    throw err;
  });

  inflight.set(key, p);
  return p;
}

export function clearCollectionCache(name) {
  cache.delete(String(name || "").trim());
}

export function clearAllCaches() {
  cache.clear();
}

