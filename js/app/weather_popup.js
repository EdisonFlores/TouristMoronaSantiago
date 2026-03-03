//js/app/weather_popup.js
import { fetchWeather } from "../services/weather.js";

let tmClockInterval = null;

function ensureWeatherModal() {
  if (document.getElementById("tm-weather-modal")) return;

  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="modal fade" id="tm-weather-modal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Clima</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>
          </div>

          <div class="modal-body">
            <div id="tm-weather-status" class="small mb-2"></div>

            <ul class="nav nav-tabs" id="tm-weather-tabs" role="tablist">
              <li class="nav-item" role="presentation">
                <button class="nav-link active" id="tab-hourly" data-bs-toggle="tab"
                        data-bs-target="#pane-hourly" type="button" role="tab"
                        aria-controls="pane-hourly" aria-selected="true">
                  Horas del día
                </button>
              </li>
              <li class="nav-item" role="presentation">
                <button class="nav-link" id="tab-daily" data-bs-toggle="tab"
                        data-bs-target="#pane-daily" type="button" role="tab"
                        aria-controls="pane-daily" aria-selected="false">
                  Próximos días
                </button>
              </li>
            </ul>

            <div class="tab-content pt-3">
              <div class="tab-pane fade show active" id="pane-hourly" role="tabpanel" aria-labelledby="tab-hourly">
                <div id="tm-weather-hourly"></div>
              </div>
              <div class="tab-pane fade" id="pane-daily" role="tabpanel" aria-labelledby="tab-daily">
                <div id="tm-weather-daily"></div>
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-primary" data-bs-dismiss="modal">Cerrar</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
}

function fmtDate(iso) {
  try {
    const d = new Date(`${iso}T00:00:00`);
    return d.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" });
  } catch {
    return iso;
  }
}

function weatherCodeToText(code) {
  const m = {
    0: "Despejado",
    1: "Mayormente despejado",
    2: "Parcialmente nublado",
    3: "Nublado",
    45: "Niebla",
    48: "Niebla",
    51: "Llovizna",
    61: "Lluvia",
    63: "Lluvia moderada",
    65: "Lluvia fuerte",
    80: "Chubascos",
    95: "Tormenta"
  };
  return (typeof code === "number" && (code in m)) ? m[code] : "Clima";
}

function weatherCodeToIcon(code) {
  if (typeof code !== "number") return '<i class="bi bi-cloud"></i>';
  if (code === 0) return '<i class="bi bi-sun-fill"></i>';
  if ([1, 2].includes(code)) return '<i class="bi bi-cloud-sun-fill"></i>';
  if (code === 3) return '<i class="bi bi-cloud-fill"></i>';
  if ([45, 48].includes(code)) return '<i class="bi bi-cloud-fog-fill"></i>';
  if ([51, 61, 63, 65, 80].includes(code)) return '<i class="bi bi-cloud-rain-fill"></i>';
  if (code >= 95) return '<i class="bi bi-cloud-lightning-rain-fill"></i>';
  return '<i class="bi bi-cloud"></i>';
}

/* reloj en vivo */
function startHourlyClock() {
  if (tmClockInterval) clearInterval(tmClockInterval);

  const el = document.getElementById("tm-hourly-datetime");
  if (!el) return;

  tmClockInterval = setInterval(() => {
    const now = new Date();

    const dateLabel = now.toLocaleDateString(undefined, {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric"
    });

    const timeLabel = now.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });

    el.textContent = `${dateLabel} — ${timeLabel}`;
  }, 1000);
}

function stopHourlyClock() {
  if (tmClockInterval) {
    clearInterval(tmClockInterval);
    tmClockInterval = null;
  }
}

/* ===== HOY (00:00–23:00) ===== */
function renderHourlyHTML(data) {
  const curTemp = data?.current?.temperature_2m;
  const curCode = data?.current?.weather_code;

  const times = data?.hourly?.time || [];
  const temps = data?.hourly?.temperature_2m || [];
  const codes = data?.hourly?.weather_code || [];
  const winds = data?.hourly?.wind_speed_10m || [];
  const rains = data?.hourly?.precipitation || [];

  const now = new Date();
  const todayKey = now.toLocaleDateString("en-CA");

  const todayItems = times.map((iso, idx) => {
    const dt = new Date(iso);
    return { iso, idx, dt, dayKey: dt.toLocaleDateString("en-CA") };
  }).filter(x => x.dayKey === todayKey);

  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  });

  const timeLabel = now.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  const headerRight = `${dateLabel} — ${timeLabel}`;

  const rows = todayItems.map(x => {
    const i = x.idx;

    const hh = x.dt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    const temp = temps[i];
    const code = codes[i];

    const windTxt = (typeof winds[i] === "number") ? `${Math.round(winds[i])} km/h` : "--";
    const rainTxt = (typeof rains[i] === "number") ? `${rains[i].toFixed(1)} mm` : "--";

    const desc = weatherCodeToText(code);
    const icon = weatherCodeToIcon(code);

    const tempTxt = (typeof temp === "number") ? `${Math.round(temp)}°C` : "--°C";

    const isNight = (() => {
      const h = x.dt.getHours();
      return (h >= 18 || h < 6);
    })();

    return `
      <div class="tm-forecast-row ${isNight ? "tm-night" : ""}"
           style="grid-template-columns: 80px 40px 1fr 90px;">
        <div class="tm-forecast-day">${hh}</div>
        <div class="text-center tm-wicon">${icon}</div>

        <div class="tm-forecast-desc">
          ${desc}
          <div class="tm-extra small">
            💨 ${windTxt} &nbsp;&nbsp; 🌧 ${rainTxt}
          </div>
        </div>

        <div class="tm-forecast-temp">${tempTxt}</div>
      </div>
    `;
  }).join("");

  const headerDesc = weatherCodeToText(curCode);
  const headerIcon = weatherCodeToIcon(curCode);

  const curWind = data?.current?.wind_speed_10m;
  const curRain = data?.current?.precipitation;

  const curWindTxt = (typeof curWind === "number") ? `${Math.round(curWind)} km/h` : "--";
  const curRainTxt = (typeof curRain === "number") ? `${curRain.toFixed(1)} mm` : "--";

  return `
    <div class="d-flex align-items-start justify-content-between mb-2">
      <div>
        <div class="h4 mb-0">${typeof curTemp === "number" ? `${Math.round(curTemp)}°C` : "--°C"}</div>
        <div class="small d-flex align-items-center gap-2">
          ${headerIcon}
          <span>${headerDesc}</span>
        </div>
        <div class="small tm-extra mt-1">
          💨 ${curWindTxt} &nbsp;&nbsp; 🌧 ${curRainTxt}
        </div>
      </div>

      <div id="tm-hourly-datetime" class="small opacity-75 text-capitalize text-end">
        ${headerRight}
      </div>
    </div>

    <div class="tm-forecast mt-2">
      ${rows || `<div class="alert alert-info mb-0">No hay datos horarios disponibles para hoy.</div>`}
    </div>
  `;
}

function renderDailyHTML(data) {
  const days = data?.daily?.time || [];
  const tmax = data?.daily?.temperature_2m_max || [];
  const tmin = data?.daily?.temperature_2m_min || [];
  const codes = data?.daily?.weather_code || [];

  const rows = days.slice(0, 7).map((d, i) => {
    const desc = weatherCodeToText(codes[i]);
    const icon = weatherCodeToIcon(codes[i]);

    return `
      <div class="tm-forecast-row" style="grid-template-columns: 120px 40px 1fr 90px;">
        <div class="tm-forecast-day">${fmtDate(d)}</div>
        <div class="text-center tm-wicon">${icon}</div>
        <div class="tm-forecast-desc">${desc}</div>
        <div class="tm-forecast-temp">
          <span class="tm-max">${Number.isFinite(tmax[i]) ? Math.round(tmax[i]) : "--"}°</span>
          <span class="tm-min">${Number.isFinite(tmin[i]) ? Math.round(tmin[i]) : "--"}°</span>
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="tm-forecast">
      ${rows || `<div class="alert alert-info mb-0">No hay datos diarios disponibles.</div>`}
    </div>
  `;
}

export async function openWeatherPopup({ lat, lon }) {
  ensureWeatherModal();

  const status = document.getElementById("tm-weather-status");
  const hourlyEl = document.getElementById("tm-weather-hourly");
  const dailyEl = document.getElementById("tm-weather-daily");

  status.textContent = "Cargando pronóstico…";
  hourlyEl.innerHTML = "";
  dailyEl.innerHTML = "";

  const modalEl = document.getElementById("tm-weather-modal");
  const modal = new bootstrap.Modal(modalEl);
  modal.show();

  setTimeout(startHourlyClock, 0);
  modalEl.addEventListener("hidden.bs.modal", stopHourlyClock, { once: true });

  try {
    const data = await fetchWeather(lat, lon);

    status.textContent = "";
    hourlyEl.innerHTML = renderHourlyHTML(data);
    dailyEl.innerHTML = renderDailyHTML(data);

    setTimeout(startHourlyClock, 0);

  } catch (err) {
    console.error("Weather popup error:", err);
    status.textContent = "";

    const errHtml = `
      <div class="alert alert-warning mb-0">
        No se pudo obtener el pronóstico en este momento.
      </div>
    `;

    hourlyEl.innerHTML = errHtml;
    dailyEl.innerHTML = errHtml;
  }
}

export function initWeatherPopup({ getUserLoc, getMapCenter }) {
  const badge = document.getElementById("weatherBadge");
  if (!badge) return;

  badge.style.cursor = "pointer";
  badge.addEventListener("click", () => {
    // ✅ prioridad: centro del mapa
    const c = getMapCenter?.();
    if (c && typeof c.lat === "number" && typeof c.lng === "number") {
      openWeatherPopup({ lat: c.lat, lon: c.lng });
      return;
    }

    // fallback: ubicación del usuario
    const loc = getUserLoc?.();
    if (!loc) return;
    openWeatherPopup({ lat: loc[0], lon: loc[1] });
  });
}