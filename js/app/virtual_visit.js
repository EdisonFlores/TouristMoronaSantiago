// js/app/virtual_visit.js
export const VIRTUAL_MORONA_LOC = [-2.316261, -78.124737];

// ✅ entorno fijo para esa ubicación virtual
export const VIRTUAL_MORONA_ENV = "urbano";

export function shouldShowVisitMorona(ctxGeo = {}) {
  const c = String(ctxGeo?.canton || "").trim().toLowerCase();

  // ✅ NO mostrar si el usuario ya está en Morona o Sevilla Don Bosco
  if (c === "morona") return false;
  if (c.includes("sevilla")) return false;

  // si no sabemos cantón => permitir explorar
  if (!c) return true;

  return true;
}

export function applyVisitMorona({ setUserLocation, map, onAfterSet } = {}) {
  if (typeof setUserLocation === "function") setUserLocation(VIRTUAL_MORONA_LOC);
  if (map) map.setView(VIRTUAL_MORONA_LOC, 14);

  if (typeof onAfterSet === "function") {
    onAfterSet(VIRTUAL_MORONA_LOC, {
      entornoUser: VIRTUAL_MORONA_ENV,
      isVirtual: true
    });
  }

  return VIRTUAL_MORONA_LOC;
}