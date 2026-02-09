// js/app/selects.js
import { getCollectionCache } from "./cache_db.js";

/* =========================
   PROVINCIAS (desde "lugar")
========================= */
export async function getProvinciasConDatos() {
  const docs = await getCollectionCache("lugar");
  const provincias = new Set();

  docs.forEach(d => {
    if (!d?.activo) return;
    if (d.provincia?.trim()) provincias.add(d.provincia.trim());
  });

  return [...provincias].sort();
}

/* =========================
   CANTONES (campo ciudad en "lugar")
========================= */
export async function getCantonesConDatos(provincia) {
  const docs = await getCollectionCache("lugar");
  const cantones = new Set();

  docs.forEach(d => {
    if (!d?.activo) return;
    if (d.provincia === provincia && d.ciudad?.trim()) cantones.add(d.ciudad.trim());
  });

  return [...cantones].sort();
}

/* =========================
   PARROQUIAS (desde "lugar")
========================= */
export async function getParroquiasConDatos(provincia, canton) {
  const docs = await getCollectionCache("lugar");
  const parroquias = new Set();

  docs.forEach(d => {
    if (!d?.activo) return;
    if (d.provincia === provincia && d.ciudad === canton && d.parroquia?.trim()) {
      parroquias.add(d.parroquia.trim());
    }
  });

  return [...parroquias].sort();
}
