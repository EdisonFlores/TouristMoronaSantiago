import { db } from "../services/firebase.js";
import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* =========================
   PROVINCIAS
========================= */
export async function getProvinciasConDatos() {
  const snap = await getDocs(collection(db, "lugar"));
  const provincias = new Set();

  snap.forEach(doc => {
    const d = doc.data();
    if (d.provincia?.trim()) {
      provincias.add(d.provincia.trim());
    }
  });

  return [...provincias].sort();
}

/* =========================
   CANTONES (campo ciudad)
========================= */
export async function getCantonesConDatos(provincia) {
  const snap = await getDocs(collection(db, "lugar"));
  const cantones = new Set();

  snap.forEach(doc => {
    const d = doc.data();
    if (
      d.provincia === provincia &&
      d.ciudad?.trim()
    ) {
      cantones.add(d.ciudad.trim());
    }
  });

  return [...cantones].sort();
}

/* =========================
   PARROQUIAS
========================= */
export async function getParroquiasConDatos(provincia, canton) {
  const snap = await getDocs(collection(db, "lugar"));
  const parroquias = new Set();

  snap.forEach(doc => {
    const d = doc.data();
    if (
      d.provincia === provincia &&
      d.ciudad === canton &&
      d.parroquia?.trim()
    ) {
      parroquias.add(d.parroquia.trim());
    }
  });

  return [...parroquias].sort();
}
