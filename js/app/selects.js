// js/app/selects.js
import { db } from "../services/firebase.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* =========================
   HELPERS
========================= */
function toTitleCase(s) {
  const t = String(s || "").trim();
  if (!t) return "";
  return t
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

/* =========================
   PROVINCIAS (desde BD - opcional)
   (ya NO es obligatorio usarlo para auto-llenado)
========================= */
export async function getProvinciasConDatos() {
  const snap = await getDocs(collection(db, "lugar"));
  const provincias = new Set();

  snap.forEach(doc => {
    const d = doc.data();
    if (d?.activo && d.provincia?.trim()) {
      provincias.add(toTitleCase(d.provincia.trim()));
    }
  });

  return [...provincias].sort();
}

/* =========================
   CANTONES (desde BD - opcional)
   (en tu colección "lugar", el cantón está en "ciudad")
========================= */
export async function getCantonesConDatos(provincia) {
  const snap = await getDocs(collection(db, "lugar"));
  const cantones = new Set();
  const prov = toTitleCase(provincia);

  snap.forEach(doc => {
    const d = doc.data();
    if (!d?.activo) return;
    if (toTitleCase(d.provincia) !== prov) return;

    if (d.ciudad?.trim()) {
      cantones.add(toTitleCase(d.ciudad.trim()));
    }
  });

  return [...cantones].sort();
}

/* =========================
   PARROQUIAS (DESDE BD)
   ✅ SOLO parroquias del cantón detectado/seleccionado
========================= */
export async function getParroquiasConDatos(provincia, canton) {
  const snap = await getDocs(collection(db, "lugar"));
  const parroquias = new Set();
  const prov = toTitleCase(provincia);
  const can = toTitleCase(canton);

  snap.forEach(doc => {
    const d = doc.data();
    if (!d?.activo) return;

    if (toTitleCase(d.provincia) !== prov) return;
    if (toTitleCase(d.ciudad) !== can) return; // ciudad = cantón

    if (d.parroquia?.trim()) {
      parroquias.add(toTitleCase(d.parroquia.trim()));
    }
  });

  return [...parroquias].sort();
}
