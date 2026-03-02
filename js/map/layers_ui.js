// js/map/layers_ui.js
export function initLayersUI({
  map,
  baseLayers = {},
  overlays = {},
  onMyLocation = null,
  legendHTML = ""
} = {}) {
  if (!map) return null;

  // Layers control (base + overlays)
  const lc = L.control.layers(baseLayers, overlays, { collapsed: true }).addTo(map);

  // Botón Mi ubicación (control custom)
  const MyLoc = L.Control.extend({
    options: { position: "topleft" },
    onAdd() {
      const btn = L.DomUtil.create("button", "tm-map-btn");
      btn.type = "button";
      btn.innerHTML = `📍`;
      btn.title = "Mostrar mi ubicación";
      L.DomEvent.disableClickPropagation(btn);
      L.DomEvent.on(btn, "click", (e) => {
        L.DomEvent.stop(e);
        if (typeof onMyLocation === "function") onMyLocation();
      });
      return btn;
    }
  });
  const myLocCtrl = new MyLoc();
  myLocCtrl.addTo(map);


  // helper para actualizar overlays sin recrear todo
  function updateOverlays(newOverlays = {}) {
    // Leaflet no ofrece API pública “setOverlays”, así que:
    // 1) removemos los overlays del control
    // 2) agregamos los nuevos
    // Nota: las layers siguen existiendo en el mapa; esto solo actualiza el panel.
    Object.keys(overlays).forEach(name => {
      try { lc.removeLayer(overlays[name]); } catch {}
    });
    overlays = { ...newOverlays };
    Object.keys(overlays).forEach(name => {
      try { lc.addOverlay(overlays[name], name); } catch {}
    });
  }

  return { layersControl: lc, updateOverlays };
}