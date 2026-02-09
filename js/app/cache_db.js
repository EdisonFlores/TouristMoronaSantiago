// js/app/cache_db.js
import { db } from "../services/firebase.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/**
 * Cache simple:
 * - primera vez: hace 1 getDocs
 * - siguientes: devuelve array cacheado
 */
const _cache = new Map();      // name -> array
const _loading = new Map();    // name -> Promise

export async function getCollectionCache(name, { force = false } = {}) {
  if (!force && _cache.has(name)) return _cache.get(name);
  if (!force && _loading.has(name)) return _loading.get(name);

  const p = (async () => {
    const snap = await getDocs(collection(db, name));
    const arr = [];
    snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
    _cache.set(name, arr);
    _loading.delete(name);
    return arr;
  })();

  _loading.set(name, p);
  return p;
}

export function clearCollectionCache(name) {
  _cache.delete(name);
  _loading.delete(name);
}

export function clearAllCaches() {
  _cache.clear();
  _loading.clear();
}
