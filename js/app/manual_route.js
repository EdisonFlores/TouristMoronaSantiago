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

    // ✅ NUEVO: detector por punto (admin+entorno)
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

  async function buildRoute() {
    const infoEl = document.getElementById("route-info");
    const activePlace = getActivePlace?.();

    const hasBDPlace = !!activePlace?.ubicacion;
    const hasManualDest = Array.isArray(manualDest) && manualDest.length === 2;

    if (!hasBDPlace && !hasManualDest) return;

    clearRoute?.();
    clearTransportLayers?.();
    clearRouteInfo?.();

    const gpsUserLoc = getUserLoc?.();
    const startLoc = (Array.isArray(manualStart) && manualStart.length === 2) ? manualStart : gpsUserLoc;
    if (!startLoc) return;

    const destLoc = hasBDPlace
      ? [activePlace.ubicacion.latitude, activePlace.ubicacion.longitude]
      : manualDest;

    // ✅ destino (si manual, le agregamos entorno luego)
    const destPlace = hasBDPlace ? activePlace : {
      nombre: "Destino seleccionado",
      ubicacion: { latitude: destLoc[0], longitude: destLoc[1] }
    };

    const mode = getMode?.() || "walking";

    // ========== ✅ BUS: detectar contexto real de start/dest ==========
    if (mode === "bus") {
      if (infoEl) {
        infoEl.innerHTML = `
          <div class="alert alert-info py-2 mb-2">
            ⏳ Buscando ruta en bus (urbano/rural)…
          </div>
        `;
      }

      // ctx base (del usuario actual detectado al inicio)
      const ctxBase = getCtxGeo?.() || {};

      // detect contexto del ORIGEN real (puede ser manualStart o GPS)
      let startCtx = null;
      try {
        startCtx = await detectPointContext?.(startLoc);
      } catch {}

      // detect contexto del DESTINO real (solo si es manualDest, si es BD ya puede traer entorno)
      let destCtx = null;
      if (!hasBDPlace) {
        try {
          destCtx = await detectPointContext?.(destLoc);
        } catch {}
      }

      // ✅ entorno del origen: si no se detecta, usa el de ctxBase
      const entornoUser =
        (startCtx?.entornoPoint === "urbano" || startCtx?.entornoPoint === "rural")
          ? startCtx.entornoPoint
          : (ctxBase.entornoUser || "");

      // ✅ contexto geográfico a usar para filtrar buses:
      // si destino es manual y se detectó provincia/cantón, úsalo; si no, usa ctxBase.
      const ctxForBus = (destCtx?.ctxGeoPoint?.provincia && destCtx?.ctxGeoPoint?.canton)
        ? destCtx.ctxGeoPoint
        : ctxBase;

      // ✅ entorno del destino: si destino manual y detectamos entorno, lo ponemos en destPlace
      if (!hasBDPlace && (destCtx?.entornoPoint === "urbano" || destCtx?.entornoPoint === "rural")) {
        destPlace.entorno = destCtx.entornoPoint;
      }

      try {
        const res = await planAndShowBusStops?.(
          startLoc,
          destPlace,
          {
            tipo: "auto",
            provincia: ctxForBus.provincia || "",
            canton: ctxForBus.canton || "",
            parroquia: ctxForBus.parroquia || "",
            specialSevilla: ctxForBus.specialSevilla === true,
            entornoUser,
            now: new Date(),
            sentido: "auto"
          },
          { infoEl }
        );

        if (!res && infoEl) {
          infoEl.innerHTML = `
            <div class="alert alert-warning py-2 mb-0">
              ❌ No se encontró una ruta en bus para este destino.
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

    // ========== MODOS NORMALES ==========
    if (hasBDPlace) {
      const isManualStart = Array.isArray(manualStart) && manualStart.length === 2;
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