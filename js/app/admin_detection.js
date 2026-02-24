// js/app/admin_detection.js
import { reverseGeocodeNominatim } from "../services/nominatim.js";
import { getCollectionCache } from "./cache_db.js";
import { map } from "../map/map.js";

// helpers
function titleCaseWords(s) {
  const t = String(s || "").trim();
  if (!t) return "";
  return t
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function normLite(s) {
  return String(s || "").trim().toLowerCase();
}

function llFromDoc(doc) {
  const u = doc?.ubicacion;
  const { latitude, longitude } = u || {};
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  return [latitude, longitude];
}

function passTypeFilter(source, doc) {
  const t = normLite(doc?.tipo);

  if (source === "lugar") return true;
  if (source === "paradas_transporte") return t === "urbana";
  if (source === "paradas_rurales") return t === "rural";
  return true;
}

function normalizeAdminFromDoc(source, doc) {
  const s = String(source || "").toLowerCase();

  if (s === "lugar") {
    return {
      provincia: String(doc?.provincia || ""),
      canton: String(doc?.ciudad || ""),   // lugar.ciudad = cantón
      parroquia: String(doc?.parroquia || "")
    };
  }

  if (s === "paradas_rurales") {
    return {
      provincia: String(doc?.provincia || ""),
      canton: String(doc?.cantonorigen || ""),
      parroquia: String(doc?.parroquiaorigen || "")
    };
  }

  if (s === "paradas_transporte") {
    return {
      provincia: String(doc?.provincia || ""),
      canton: String(doc?.canton || ""),
      parroquia: String(doc?.ciudad || "")
    };
  }

  return { provincia: "", canton: "", parroquia: "" };
}

function isAdminUsable(a) {
  const p = String(a?.provincia || "").trim();
  const c = String(a?.canton || "").trim();
  return Boolean(p && c);
}

// === 1) Inferir ADMIN desde BD (fallback) ===
async function inferAdminFromDBByNearest(loc, opts = {}) {
  const MAX_RADIUS_M = opts.maxRadiusM ?? 7000;
  const HARD_ACCEPT_M = opts.hardAcceptM ?? 1200;

  const sources = [
    { name: "lugar",              priority: 1 },
    { name: "paradas_transporte", priority: 2 },
    { name: "paradas_rurales",    priority: 3 }
  ];

  let best = null;

  for (const src of sources) {
    const all = await getCollectionCache(src.name);
    const arr = Array.isArray(all) ? all : [];

    for (const doc of arr) {
      if (doc?.activo === false) continue;
      if (!passTypeFilter(src.name, doc)) continue;

      const ll = llFromDoc(doc);
      if (!ll) continue;

      const d = map.distance(loc, ll);
      if (d > MAX_RADIUS_M) continue;

      const admin = normalizeAdminFromDoc(src.name, doc);
      if (!isAdminUsable(admin)) continue;

      const cand = { admin, distM: d, source: src.name, priority: src.priority };

      if (d <= HARD_ACCEPT_M) {
        return { ...cand.admin, _source: cand.source, _distM: cand.distM };
      }

      if (!best) best = cand;
      else {
        const betterDist = cand.distM < best.distM;
        const tie = Math.abs(cand.distM - best.distM) < 80;
        const betterPriority = tie && cand.priority < best.priority;
        if (betterDist || betterPriority) best = cand;
      }
    }
  }

  if (!best) return null;
  return { ...best.admin, _source: best.source, _distM: best.distM };
}

// === 2) Inferir ENTORNO (urbano/rural) desde BD por cercanía ===
async function inferEntornoFromDBByNearest(loc, opts = {}) {
  const MAX_RADIUS_M = opts.maxRadiusM ?? 7000;

  const sources = [
    { name: "paradas_transporte", priority: 1, entorno: "urbano" },
    { name: "paradas_rurales",    priority: 2, entorno: "rural"  },
    { name: "lugar",              priority: 3, entorno: ""       }
  ];

  let best = null;

  for (const src of sources) {
    const all = await getCollectionCache(src.name);
    const arr = Array.isArray(all) ? all : [];

    for (const doc of arr) {
      if (doc?.activo === false) continue;
      if (!passTypeFilter(src.name, doc)) continue;

      const ll = llFromDoc(doc);
      if (!ll) continue;

      const d = map.distance(loc, ll);
      if (d > MAX_RADIUS_M) continue;

      const cand = { distM: d, priority: src.priority, source: src.name, doc, entornoFixed: src.entorno };

      if (!best) best = cand;
      else {
        const betterDist = cand.distM < best.distM;
        const tie = Math.abs(cand.distM - best.distM) < 80;
        const betterPriority = tie && cand.priority < best.priority;
        if (betterDist || betterPriority) best = cand;
      }
    }
  }

  if (!best) return "";

  if (best.source === "paradas_transporte") return "urbano";
  if (best.source === "paradas_rurales") return "rural";

  // en "lugar" intentamos leer doc.entorno si existe
  const ent = normLite(best.doc?.entorno);
  if (ent === "urbano" || ent === "rural") return ent;

  return "";
}

/**
 * ✅ FUNCIÓN PRINCIPAL (la que ya usas para usuario)
 * Retorna { detectedAdmin, ctxGeo }
 */
export async function detectAdminContextFromLatLng(loc) {
  let admin = { provincia: "", canton: "", parroquia: "" };

  try {
    const a = await reverseGeocodeNominatim(loc[0], loc[1], {
      retries: 1,
      timeoutMs: 6500,
      initialDelayMs: 900
    });

    admin = {
      provincia: titleCaseWords(a.provincia),
      canton: titleCaseWords(a.canton),
      parroquia: titleCaseWords(a.parroquia)
    };
  } catch (e) {
    console.warn("Nominatim falló. Usando fallback BD por cercanía.", e);

    const fromDB = await inferAdminFromDBByNearest(loc, { maxRadiusM: 7000, hardAcceptM: 1200 });
    if (fromDB) {
      admin = {
        provincia: titleCaseWords(fromDB.provincia),
        canton: titleCaseWords(fromDB.canton),
        parroquia: titleCaseWords(fromDB.parroquia)
      };
    } else {
      admin = { provincia: "", canton: "", parroquia: "" };
    }
  }

  const entornoUser = await inferEntornoFromDBByNearest(loc, { maxRadiusM: 7000 });

  const anySevilla =
    normLite(admin.canton).includes("sevilla") ||
    normLite(admin.parroquia).includes("sevilla");

  let detectedAdmin = { provincia: "", canton: "", parroquia: "" };
  let ctxGeo = {
    provincia: "",
    canton: "",
    parroquia: "",
    specialSevilla: false,
    entornoUser: entornoUser || ""
  };

  if (anySevilla) {
    detectedAdmin = {
      provincia: "Morona Santiago",
      canton: "Sevilla Don Bosco",
      parroquia: "Sevilla Don Bosco"
    };

    ctxGeo = {
      provincia: "Morona Santiago",
      canton: "Sevilla Don Bosco",
      parroquia: "Sevilla Don Bosco",
      specialSevilla: true,
      entornoUser: entornoUser || ""
    };

    return { detectedAdmin, ctxGeo };
  }

  detectedAdmin = {
    provincia: admin.provincia || "",
    canton: admin.canton || "",
    parroquia: admin.parroquia || ""
  };

  ctxGeo = {
    provincia: detectedAdmin.provincia,
    canton: detectedAdmin.canton,
    parroquia: detectedAdmin.parroquia,
    specialSevilla: false,
    entornoUser: entornoUser || ""
  };

  return { detectedAdmin, ctxGeo };
}

/**
 * ✅ NUEVO: helper específico para puntos manuales
 * Retorna { ctxGeoPoint, detectedAdminPoint, entornoPoint }
 */
export async function detectPointContext(loc) {
  const res = await detectAdminContextFromLatLng(loc);
  return {
    detectedAdminPoint: res.detectedAdmin,
    ctxGeoPoint: res.ctxGeo,
    entornoPoint: res.ctxGeo?.entornoUser || ""
  };
}