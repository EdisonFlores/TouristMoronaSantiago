import { getCollectionCache } from "./cache_db.js";

/* =========================
   (LEGACY) PROVINCIAS (desde "lugar")
========================= */
export async function getProvinciasConDatos() {
  const docs = await getCollectionCache("lugar");
  const provincias = new Set();

  (Array.isArray(docs) ? docs : []).forEach(d => {
    if (!d?.activo) return;
    if (d.provincia?.trim()) provincias.add(d.provincia.trim());
  });

  return [...provincias].sort();
}

/* =========================
   (LEGACY) CANTONES (campo ciudad en "lugar")
========================= */
export async function getCantonesConDatos(provincia) {
  const docs = await getCollectionCache("lugar");
  const cantones = new Set();

  (Array.isArray(docs) ? docs : []).forEach(d => {
    if (!d?.activo) return;
    if (d.provincia === provincia && d.ciudad?.trim()) cantones.add(d.ciudad.trim());
  });

  return [...cantones].sort();
}

/* =========================
   (LEGACY) PARROQUIAS (desde "lugar")
========================= */
export async function getParroquiasConDatos(provincia, canton) {
  const docs = await getCollectionCache("lugar");
  const parroquias = new Set();

  (Array.isArray(docs) ? docs : []).forEach(d => {
    if (!d?.activo) return;
    if (d.provincia === provincia && d.ciudad === canton && d.parroquia?.trim()) {
      parroquias.add(d.parroquia.trim());
    }
  });

  return [...parroquias].sort();
}

/* =====================================================
   ✅ NUEVO: PROVINCIAS desde colección "provincias"
   Doc ejemplo:
   - Nombre (string)
   - codigo (string)
   - ubicación (GeoPoint)
===================================================== */
export async function getProvinciasFS() {
  const docs = await getCollectionCache("provincias");
  const arr = Array.isArray(docs) ? docs : [];

  // ordena por Nombre/nombre
  arr.sort((a, b) => {
    const an = String(a?.Nombre || a?.nombre || "").trim();
    const bn = String(b?.Nombre || b?.nombre || "").trim();
    return an.localeCompare(bn);
  });

  return arr;
}

/* =====================================================
   ✅ NUEVO: CANTONES por código de provincia
   Colección "cantones"
   - codigo_provincia (string)
   - nombre (string)
   - ubicación (GeoPoint)
===================================================== */
export async function getCantonesFSByCodigoProvincia(codigo_provincia) {
  const docs = await getCollectionCache("cantones");
  const arr = Array.isArray(docs) ? docs : [];
  const cp = String(codigo_provincia || "").trim();

  const filtered = arr.filter(c => String(c?.codigo_provincia || "").trim() === cp);

  filtered.sort((a, b) => {
    const an = String(a?.nombre || a?.Nombre || "").trim();
    const bn = String(b?.nombre || b?.Nombre || "").trim();
    return an.localeCompare(bn);
  });

  return filtered;
}

/* =====================================================
   ✅ NUEVO: Tipos de comida desde colección "lugar"
   - subcategoria = "alimentacion"
   - tipocomida = "Marisqueria", etc.
===================================================== */
export async function getTiposComidaFromLugar({ provincia, canton, specialSevilla } = {}) {
  const docs = await getCollectionCache("lugar");
  const arr = Array.isArray(docs) ? docs : [];

  const provSel = String(provincia || "").trim();
  const cantonSel = String(canton || "").trim();

  const set = new Set();

  arr.forEach(l => {
    if (!l?.activo) return;
    if (String(l?.provincia || "").trim() !== provSel) return;

    const sub = String(l?.subcategoria || "").trim().toLowerCase();
    if (sub !== "alimentacion") return;

    // filtro geográfico por cantón
    const ciudad = String(l?.ciudad || "").trim();

    if (specialSevilla) {
      if (ciudad !== "Sevilla Don Bosco" && ciudad !== "Morona") return;
    } else {
      if (ciudad !== cantonSel) return;
    }

    const tc = String(l?.tipocomida || "").trim();
    if (tc) set.add(tc);
  });

  return [...set].sort((a, b) => a.localeCompare(b));
}