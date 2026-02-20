// js/services/nominatim.js
export async function reverseGeocodeNominatim(lat, lon) {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
    `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}` +
    `&zoom=12&addressdetails=1&accept-language=es`;

  const res = await fetch(url, {
    headers: {
      // Nominatim recomienda identificar la app.
      // Si tienes dominio/email real, reemplázalo aquí.
      "User-Agent": "TouristMacas/1.0 (contact: admin@touristmacas.local)"
    }
  });

  if (!res.ok) throw new Error("Nominatim reverse failed");

  const data = await res.json();
  const a = data?.address || {};

  // Ecuador suele venir así:
  // state = provincia, county = cantón, city/town/village/suburb = parroquia/ciudad
  const provinciaRaw = a.state || a.region || "";
  const cantonRaw = a.county || "";
  const parroquiaRaw =
    a.city_district ||
    a.suburb ||
    a.city ||
    a.town ||
    a.village ||
    a.hamlet ||
    "";

  return {
    provincia: toTitleCase(provinciaRaw),
    canton: toTitleCase(cantonRaw),
    parroquia: toTitleCase(parroquiaRaw),
    raw: data
  };
}

/* =========================
   Title Case: "morona santiago" -> "Morona Santiago"
========================= */
export function toTitleCase(s) {
  const t = String(s || "").trim();
  if (!t) return "";
  return t
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}