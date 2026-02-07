// js/services/nominatim.js
export async function reverseGeocodeNominatim(lat, lon) {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
    `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}` +
    `&zoom=12&addressdetails=1&accept-language=es`;

  const res = await fetch(url, {
    headers: {
      // Nominatim recomienda identificar tu app (mejor si pones un dominio/email real)
      "User-Agent": "TouristMacas/1.0 (contact: your-email@example.com)"
    }
  });

  if (!res.ok) throw new Error("Nominatim reverse failed");
  const data = await res.json();

  const a = data?.address || {};

  // Ecuador: suele venir:
  // state = provincia, county = cantón, city/town/village/suburb = parroquia/ciudad
  const provincia = a.state || a.region || "";
  const canton = a.county || "";
  const parroquia =
    a.city_district || a.suburb || a.city || a.town || a.village || a.hamlet || "";

  return { provincia, canton, parroquia, raw: data };
}
