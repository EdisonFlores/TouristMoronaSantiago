// js/app/selects.js
import { db } from "../services/firebase.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* =========================
   PROVINCIAS (desde "lugar")
========================= */
export async function getProvinciasConDatos() {
  const snap = await getDocs(collection(db, "lugar"));
  const provincias = new Set();

  snap.forEach(doc => {
    const d = doc.data();
    if (d?.activo && d.provincia?.trim()) {
      provincias.add(d.provincia.trim());
    }
  });

  return [...provincias].sort();
}

/* =========================
   CANTONES (campo ciudad en "lugar")
========================= */
export async function getCantonesConDatos(provincia) {
  const snap = await getDocs(collection(db, "lugar"));
  const cantones = new Set();

  snap.forEach(doc => {
    const d = doc.data();
    if (d?.activo && d.provincia === provincia && d.ciudad?.trim()) {
      cantones.add(d.ciudad.trim());
    }
  });

  return [...cantones].sort();
}

/* =========================
   PARROQUIAS del cantón:
   ✅ desde lugares + desde lineas_transporte.ciudadpasa
========================= */
export async function getParroquiasConDatos(provincia, canton) {
  const parroquias = new Set();

  // 1) desde "lugar"
  const snapLugares = await getDocs(collection(db, "lugar"));
  snapLugares.forEach(doc => {
    const d = doc.data();
    if (!d?.activo) return;
    if (d.provincia !== provincia) return;
    if (d.ciudad !== canton) return;
    if (d.parroquia?.trim()) parroquias.add(d.parroquia.trim());
  });

  // 2) desde "lineas_transporte" (ciudadpasa = parroquias)
  const snapLineas = await getDocs(collection(db, "lineas_transporte"));
  snapLineas.forEach(doc => {
    const l = doc.data();
    if (!l?.activo) return;
    if (l.provincia !== provincia) return;

    // cantonpasa puede ser array o string
    const cantonesPasa = Array.isArray(l.cantonpasa) ? l.cantonpasa : (l.cantonpasa ? [l.cantonpasa] : []);
    const okCanton =
      cantonesPasa.includes(canton) || l.canton === canton;

    if (!okCanton) return;

    const parroquiasPasa = Array.isArray(l.ciudadpasa) ? l.ciudadpasa : (l.ciudadpasa ? [l.ciudadpasa] : []);
    parroquiasPasa.forEach(p => {
      const s = String(p || "").trim();
      if (s) parroquias.add(s);
    });
  });

  return [...parroquias].sort((a, b) => a.localeCompare(b));
}
