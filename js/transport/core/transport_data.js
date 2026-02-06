// js/transport/core/transport_data.js
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "../../services/firebase.js";

/* ==========================
   NORMALIZACIÓN FUERTE
   (evita que General Proaño != General Proano)
========================== */
export function normStr(s) {
  return String(s ?? "").trim().toLowerCase();
}

export function normKey(s) {
  // lower + trim + quitar diacríticos + colapsar espacios
  const t = String(s ?? "").trim().toLowerCase();
  // normalize puede fallar en entornos viejos, por eso try/catch
  try {
    return t
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // diacríticos
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return t.replace(/\s+/g, " ").trim();
  }
}

export function titleCase(s) {
  const t = String(s ?? "").trim();
  if (!t) return "";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function normCobertura(v) {
  const s = normStr(v);
  if (s === "normal") return "Normal";
  if (s === "interna") return "Interna";
  if (s === "externa") return "Externa";
  return "";
}

function toNormArrayKey(v) {
  if (Array.isArray(v)) return v.map(normKey).filter(Boolean);
  if (v == null) return [];
  const s = normKey(v);
  return s ? [s] : [];
}

// ctx: { canton, parroquia }
export async function getLineasByTipo(tipo, ctx = {}) {
  const t = normStr(tipo);
  const snap = await getDocs(collection(db, "lineas_transporte"));
  const out = [];

  const cantonSel = normKey(ctx?.canton);
  const parroquiaSel = normKey(ctx?.parroquia); // en tu BD: ciudadpasa = parroquias

  snap.forEach(d => {
    const l = d.data();
    if (!l?.activo) return;
    if (normStr(l.tipo) !== t) return;

    // ✅ FILTRO CANTÓN
    if (cantonSel) {
      const cantones = toNormArrayKey(l.cantonpasa);
      const ok = cantones.includes(cantonSel) || normKey(l.canton) === cantonSel;
      if (!ok) return;
    }

    // ✅ FILTRO PARROQUIA (ciudadpasa)
    if (parroquiaSel) {
      const parroquias = toNormArrayKey(l.ciudadpasa);
      const ok = parroquias.includes(parroquiaSel) || normKey(l.ciudad) === parroquiaSel;
      if (!ok) return;
    }

    out.push({ id: d.id, ...l });
  });

  return out;
}

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
