// js/services/nominatim.js

export function toTitleCase(s) {
  const t = String(s || "").trim();
  if (!t) return "";
  return t
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export async function reverseGeocodeNominatim(lat, lon) {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}` +
    `&accept-language=es`;

  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "Accept-Language": "es"
    }
  });

  const data = await res.json();
  const a = data?.address || {};

  // ✅ Debug útil: ver qué campos trae Nominatim (solo en dev)
  console.log("Nominatim address keys:", a);

  const provincia =
    a.state || a.region || a.province || "";

  // ✅ Cantón: Nominatim varía mucho según país/OSM
  const canton =
    a.county ||
    a.municipality ||
    a.city ||
    a.town ||
    a.city_district ||
    a.state_district ||
    "";

  // ✅ Parroquia: también varía
  const parroquia =
    a.suburb ||
    a.village ||
    a.hamlet ||
    a.neighbourhood ||
    a.quarter ||
    a.locality ||
    a.city_district ||
    "";

  return {
    provincia: toTitleCase(provincia),
    canton: toTitleCase(canton),
    parroquia: toTitleCase(parroquia),
    raw: a
  };
}
