// js/transport/core/transport_data.js
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "../../services/firebase.js";

/* ==========================
   HELPERS: normalización
========================== */
export function normStr(s) {
  return String(s ?? "").trim().toLowerCase();
}

export function titleCase(s) {
  const t = String(s ?? "").trim();
  if (!t) return "";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Normaliza cobertura según tu BD: Normal / Interna / Externa
export function normCobertura(v) {
  const s = normStr(v);
  if (s === "normal") return "Normal";
  if (s === "interna") return "Interna";
  if (s === "externa") return "Externa";
  return "";
}

/* ==========================
   DATA: líneas / paradas
========================== */

// ctx opcional: { canton: "Morona" } (si luego filtras por cantonpasa, lo haces aquí)
export async function getLineasByTipo(tipo, ctx = {}) {
  const t = normStr(tipo);
  const snap = await getDocs(collection(db, "lineas_transporte"));
  const out = [];

  snap.forEach(d => {
    const l = d.data();
    if (!l?.activo) return;
    if (normStr(l.tipo) !== t) return;

    // si luego quieres filtrar por canton:
    // if (ctx?.canton && Array.isArray(l.cantonpasa)) {
    //   const ok = l.cantonpasa.map(normStr).includes(normStr(ctx.canton)) || normStr(l.canton) === normStr(ctx.canton);
    //   if (!ok) return;
    // }

    out.push({ id: d.id, ...l });
  });

  return out;
}

// ctx opcional para futuros filtros
export async function getParadasByLinea(codigoLinea, ctx = {}) {
  const snap = await getDocs(collection(db, "paradas_transporte"));
  const paradas = [];

  snap.forEach(d => {
    const p = d.data();
    if (p?.activo && p.codigo_linea === codigoLinea) {
      paradas.push(p);
    }
  });

  paradas.sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0));
  return paradas;
}
