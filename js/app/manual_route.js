// js/app/manual_route.js

export function createManualRouting(deps) {
  const {
    map,
    extraEl,
    getUserLoc,
    getActivePlace,
    setActivePlace,
    getMode,
    setMode,
    clearMarkers,
    clearRoute,
    clearTransportLayers,
    drawRoute,
    drawRouteToPoint,
    planAndShowBusStops,
    getCtxGeo,
    refreshLayersOverlays,
    clearRouteInfo,

    // ✅ detector por punto (admin+entorno+cobertura)
    detectPointContext
  } = deps;

  let manualDest = null;
  let manualDestMarker = null;

  let manualStart = null;
  let manualStartMarker = null;

  function clearManualDest() {
    manualDest = null;
    if (manualDestMarker) {
      try { map.removeLayer(manualDestMarker); } catch {}
      manualDestMarker = null;
    }
  }

  function clearManualStart() {
    manualStart = null;
    if (manualStartMarker) {
      try { map.removeLayer(manualStartMarker); } catch {}
      manualStartMarker = null;
    }
  }

  function ensureRouteControlsForManual() {
    if (!extraEl) return;

    const has = document.querySelector("[data-mode]") && document.getElementById("route-info");
    if (has) return;

    extraEl.innerHTML = `
      <div class="btn-group w-100 mb-2">
        <button class="btn btn-outline-primary" data-mode="walking">🚶</button>
        <button class="btn btn-outline-primary" data-mode="bicycle">🚴</button>
        <button class="btn btn-outline-primary" data-mode="motorcycle">🏍️</button>
        <button class="btn btn-outline-primary" data-mode="driving">🚗</button>
        <button class="btn btn-outline-primary" data-mode="bus">🚌</button>
      </div>
      <div id="route-info" class="small"></div>
    `;

    document.querySelectorAll("[data-mode]").forEach(btn => {
      btn.onclick = () => {
        setMode(btn.dataset.mode);
        buildRoute();
        refreshLayersOverlays?.();
      };
    });
  }

  function isLatLngArr(x) {
    return Array.isArray(x) && x.length === 2 && Number.isFinite(x[0]) && Number.isFinite(x[1]);
  }

  function isEntorno(x) {
    return x === "urbano" || x === "rural";
  }

  function normStr(s) {
    return String(s || "").trim().toLowerCase();
  }

  function sameAdmin(a = {}, b = {}) {
    // compara provincia/cantón/parroquia (si parroquia falta en alguno, comparamos provincia/cantón)
    const ap = normStr(a.provincia);
    const ac = normStr(a.canton);
    const aa = normStr(a.parroquia);

    const bp = normStr(b.provincia);
    const bc = normStr(b.canton);
    const ba = normStr(b.parroquia);

    if (!ap || !ac || !bp || !bc) return false; // si falta lo básico, asumimos mismatch
    if (ap !== bp) return false;
    if (ac !== bc) return false;

    // parroquia opcional
    if (!aa || !ba) return true;
    return aa === ba;
  }

  function showNoCoverage(infoEl, msg = "De momento no hay datos registrados en la zona, pronto habrá cobertura.") {
    if (!infoEl) return;
    infoEl.innerHTML = `
      <div class="alert alert-info py-2 mb-0">
        <b>📍 Sin cobertura por ahora</b><br>
        <div class="mt-1">${msg}</div>
      </div>
    `;
  }

  async function safeDetectPointContext(latlng) {
    if (!detectPointContext || !isLatLngArr(latlng)) return null;
    try {
      return await detectPointContext(latlng);
    } catch {
      return null;
    }
  }

  async function buildRoute() {
    const infoEl = document.getElementById("route-info");
    const activePlace = getActivePlace?.();

    const hasBDPlace = !!activePlace?.ubicacion;
    const hasManualDest = isLatLngArr(manualDest);

    if (!hasBDPlace && !hasManualDest) return;

    clearRoute?.();
    clearTransportLayers?.();
    clearRouteInfo?.();

    const gpsUserLoc = getUserLoc?.();
    const startLoc = isLatLngArr(manualStart) ? manualStart : gpsUserLoc;
    if (!isLatLngArr(startLoc)) return;

    const destLoc = hasBDPlace
      ? [activePlace.ubicacion.latitude, activePlace.ubicacion.longitude]
      : manualDest;

    if (!isLatLngArr(destLoc)) return;

    // ✅ destino place (si manual, armamos un objeto compatible)
    const destPlace = hasBDPlace
      ? activePlace
      : {
          nombre: "Destino seleccionado",
          ubicacion: { latitude: destLoc[0], longitude: destLoc[1] }
        };

    const mode = getMode?.() || "walking";

    // ================================
    // ✅ BUS: contexto por ORIGEN/DESTINO (admin + entorno + cobertura)
    // ================================
    if (mode === "bus") {
      if (infoEl) {
        infoEl.innerHTML = `
          <div class="alert alert-info py-2 mb-2">
            ⏳ Buscando ruta en bus (urbano/rural)…
          </div>
        `;
      }

      // ctx base (detectado al inicio con GPS)
      const ctxBase = getCtxGeo?.() || {};

      // detectar contexto real del ORIGEN (manualStart o GPS)
      const startCtx = await safeDetectPointContext(startLoc);

      // detectar contexto real del DESTINO:
      // - si es manual => siempre detectamos
      // - si es BD => si ya tiene provincia/canton ok, si no detectamos por latlng para bus
      let destCtx = null;

      const hasAdminInBDPlace =
        !!(activePlace?.provincia && activePlace?.ciudad) ||
        !!(activePlace?.provincia && activePlace?.canton);

      if (!hasBDPlace) {
        destCtx = await safeDetectPointContext(destLoc);
      } else {
        if (!hasAdminInBDPlace) {
          destCtx = await safeDetectPointContext(destLoc);
        }
      }

      // ✅ Cobertura: si detectPointContext reporta hasCoverage=false, no intentamos planear bus
      const startCoverage = (startCtx && typeof startCtx.hasCoverage === "boolean") ? startCtx.hasCoverage : true;
      const destCoverage  = (destCtx  && typeof destCtx.hasCoverage  === "boolean") ? destCtx.hasCoverage  : true;

      if (!startCoverage) {
        showNoCoverage(infoEl, "No hay datos cercanos al <b>origen</b> seleccionado para planificar bus.");
        return;
      }
      if (!destCoverage) {
        showNoCoverage(infoEl, "No hay datos cercanos al <b>destino</b> seleccionado para planificar bus.");
        return;
      }

      // ✅ entorno del origen (si no se detecta, fallback al ctxBase)
      const entornoUser =
        isEntorno(startCtx?.entornoPoint)
          ? startCtx.entornoPoint
          : (ctxBase.entornoUser || "");

      // ✅ admin del destino:
      // prioridad: destCtx.ctxGeoPoint -> activePlace admin -> ctxBase
      const bdProv = activePlace?.provincia || "";
      const bdCanton = activePlace?.canton || activePlace?.ciudad || "";
      const bdParr = activePlace?.parroquia || "";

      const ctxDestDetected = destCtx?.ctxGeoPoint || null;

      const ctxDestFromBD = (bdProv && bdCanton)
        ? { provincia: bdProv, canton: bdCanton, parroquia: bdParr, specialSevilla: ctxBase.specialSevilla === true }
        : null;

      const ctxForBus =
        (ctxDestDetected?.provincia && ctxDestDetected?.canton) ? ctxDestDetected :
        (ctxDestFromBD?.provincia && ctxDestFromBD?.canton) ? ctxDestFromBD :
        ctxBase;

      // ✅ admin del origen (para comparar mismatch)
      const ctxStartForCompare =
        (startCtx?.ctxGeoPoint?.provincia && startCtx?.ctxGeoPoint?.canton)
          ? startCtx.ctxGeoPoint
          : ctxBase;

      // ✅ si admin no coincide => permitir búsqueda sin filtro estricto
      const adminMismatch = !sameAdmin(ctxStartForCompare, ctxForBus);

      // ✅ entorno del destino (si destino manual y se detecta entorno, lo guardamos en destPlace)
      if (!hasBDPlace && isEntorno(destCtx?.entornoPoint)) {
        destPlace.entorno = destCtx.entornoPoint;
      }

      try {
        const res = await planAndShowBusStops?.(
          startLoc,
          destPlace,
          {
            // "tipo:auto" para que el planner decida urbano/rural
            tipo: "auto",

            // contexto admin usado por los controladores/data
            provincia: ctxForBus.provincia || "",
            canton: ctxForBus.canton || "",
            parroquia: ctxForBus.parroquia || "",

            // ✅ caso especial sevilla si aplica
            specialSevilla: ctxForBus.specialSevilla === true || ctxBase.specialSevilla === true,

            // ✅ entorno del “usuario” (origen real del cálculo)
            entornoUser,

            // ✅ clave para cuando el origen/destino no coincide con el filtro del cantón/parroquia
            ignoreGeoFilter: adminMismatch === true,

            now: new Date(),
            sentido: "auto"
          },
          { infoEl }
        );

        if (!res && infoEl) {
          infoEl.innerHTML = `
            <div class="alert alert-warning py-2 mb-0">
              ❌ No se encontró una ruta en bus para este destino.
              ${adminMismatch ? `<div class="small mt-1">ℹ️ Nota: el origen y destino están en contextos distintos (provincia/cantón/parroquia).</div>` : ""}
            </div>
          `;
        }
      } catch (e) {
        console.warn("Error planificando bus:", e);
        if (infoEl) {
          infoEl.innerHTML = `
            <div class="alert alert-warning py-2 mb-0">
              ❌ Ocurrió un error al planificar la ruta en bus.
            </div>
          `;
        }
      }

      return;
    }

    // ================================
    // MODOS NORMALES (walking/driving/etc.)
    // ================================
    if (hasBDPlace) {
      const isManualStart = isLatLngArr(manualStart);
      if (isManualStart) {
        await drawRouteToPoint?.({ from: startLoc, to: destLoc, mode, infoBox: infoEl, title: "Ruta" });
        return;
      }
      drawRoute?.(startLoc, activePlace, mode, infoEl);
      return;
    }

    await drawRouteToPoint?.({ from: startLoc, to: destLoc, mode, infoBox: infoEl, title: "Ruta" });
  }

  function setManualStartPoint(latlng) {
    if (!latlng) return;

    manualStart = [latlng.lat, latlng.lng];

    if (manualStartMarker) {
      try { map.removeLayer(manualStartMarker); } catch {}
    }

    manualStartMarker = L.marker(manualStart).addTo(map)
      .bindPopup("📍 Origen seleccionado")
      .openPopup();

    ensureRouteControlsForManual();
    buildRoute();
    refreshLayersOverlays?.();
  }

  function setManualDestination(latlng) {
    if (!latlng) return;

    manualDest = [latlng.lat, latlng.lng];

    if (manualDestMarker) {
      try { map.removeLayer(manualDestMarker); } catch {}
    }

    manualDestMarker = L.marker(manualDest).addTo(map)
      .bindPopup("🎯 Destino seleccionado")
      .openPopup();

    // destino manual => anula destino BD
    setActivePlace?.(null);
    clearMarkers?.();

    ensureRouteControlsForManual();
    buildRoute();
    refreshLayersOverlays?.();
  }

  return {
    clearManualDest,
    clearManualStart,
    ensureRouteControlsForManual,
    buildRoute,
    setManualStartPoint,
    setManualDestination
  };
}