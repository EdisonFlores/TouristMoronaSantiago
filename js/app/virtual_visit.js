// js/app/virtual_visit.js
export const VIRTUAL_MORONA_LOC = [-2.316261, -78.124737];

export function shouldShowVisitMorona(ctxGeo = {}) {
  // Regla: NO mostrar si el usuario está en Morona o Sevilla Don Bosco
  // (tomamos cantón o parroquia por seguridad, y también el flag specialSevilla)
  const canton = String(ctxGeo?.canton || "").trim().toLowerCase();
  const parroquia = String(ctxGeo?.parroquia || "").trim().toLowerCase();
  const specialSevilla = ctxGeo?.specialSevilla === true;

  const inMorona = canton === "morona" || parroquia === "morona";
  const inSevilla =
    specialSevilla ||
    canton === "sevilla don bosco" ||
    parroquia === "sevilla don bosco" ||
    canton.includes("sevilla") ||
    parroquia.includes("sevilla");

  // si no sabemos cantón => permitir explorar
  if (!canton && !parroquia) return true;

  // si está en Morona o Sevilla Don Bosco => NO mostrar
  if (inMorona || inSevilla) return false;

  // caso general: mostrar cuando no está en Morona
  return canton !== "morona";
}

export function applyVisitMorona({ setUserLocation, map, onAfterSet } = {}) {
  if (typeof setUserLocation === "function") setUserLocation(VIRTUAL_MORONA_LOC);
  if (map) map.setView(VIRTUAL_MORONA_LOC, 14);
  if (typeof onAfterSet === "function") onAfterSet(VIRTUAL_MORONA_LOC);
  return VIRTUAL_MORONA_LOC;
}