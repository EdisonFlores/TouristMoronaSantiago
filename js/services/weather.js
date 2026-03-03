// js/services/weather.js

function pickWeatherEmoji(code, isNight) {
  // modo nocturno tiene prioridad
  if (isNight) return "🌙";

  if (typeof code !== "number") return "☁";
  if (code === 0) return "☀";
  if ([1, 2].includes(code)) return "🌤";
  if (code === 3) return "☁";
  if ([45, 48].includes(code)) return "🌫";
  if ([51, 61, 63, 65, 80].includes(code)) return "🌧";
  if (code >= 95) return "⛈";
  return "☁";
}

function tempToBadgeClass(t) {
  if (typeof t !== "number") return "tm-wbadge-na";
  if (t <= 14) return "tm-wbadge-cold";
  if (t >= 28) return "tm-wbadge-hot";
  if (t >= 22) return "tm-wbadge-warm";
  return "tm-wbadge-mild";
}

function isNightNow() {
  const h = new Date().getHours();
  return (h >= 18 || h < 6);
}

export async function fetchWeather(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${encodeURIComponent(lat)}` +
    `&longitude=${encodeURIComponent(lon)}` +
    `&current=temperature_2m,weather_code,wind_speed_10m,precipitation` +
    `&hourly=temperature_2m,weather_code,wind_speed_10m,precipitation` +
    `&daily=temperature_2m_max,temperature_2m_min,weather_code` +
    `&forecast_hours=48` +
    `&forecast_days=7` +
    `&timezone=auto`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);

  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error("weather_fetch_failed");
    return r.json();
  } finally {
    clearTimeout(t);
  }
}

export async function updateWeatherBadge(lat, lon) {
  const tempEl = document.getElementById("weatherTemp"); // aquí va el texto del badge
  const badgeEl = document.getElementById("weatherBadge"); // contenedor (pill)
  if (!tempEl || !badgeEl) return;

  try {
    tempEl.textContent = "--°C";

    // limpia clases anteriores de color
    badgeEl.classList.remove(
      "tm-wbadge-cold", "tm-wbadge-mild", "tm-wbadge-warm", "tm-wbadge-hot", "tm-wbadge-na",
      "tm-wbadge-night"
    );

    const data = await fetchWeather(lat, lon);

    const temp = data?.current?.temperature_2m;
    const code = data?.current?.weather_code;

    const night = isNightNow();
    const icon = pickWeatherEmoji(code, night);

    // color según temperatura
    badgeEl.classList.add(tempToBadgeClass(temp));

    // modo nocturno automático (>=18 o <6)
    if (night) badgeEl.classList.add("tm-wbadge-night");

    // animación cuando cambia el ícono/valor
    badgeEl.classList.remove("tm-wbadge-pop");
    // forzar reflow para reiniciar animación
    void badgeEl.offsetWidth;
    badgeEl.classList.add("tm-wbadge-pop");

    if (typeof temp === "number") {
      tempEl.textContent = `${icon} ${Math.round(temp)}°C`;
    } else {
      tempEl.textContent = `${icon} --°C`;
    }

  } catch {
    tempEl.textContent = "--°C";
  }
}
/* =========================
   AUTO REFRESH (5 MIN)
========================= */

let weatherInterval = null;

export function startWeatherAutoRefresh(getUserLoc, minutes = 5) {
  // evita duplicar intervalos
  if (weatherInterval) clearInterval(weatherInterval);

  const refresh = async () => {
    const loc = getUserLoc?.();
    if (!loc) return;
    await updateWeatherBadge(loc[0], loc[1]);
  };

  // ejecutar inmediatamente
  refresh();

  // repetir cada X minutos
  weatherInterval = setInterval(refresh, minutes * 60 * 1000);
}

export function stopWeatherAutoRefresh() {
  if (weatherInterval) {
    clearInterval(weatherInterval);
    weatherInterval = null;
  }
}