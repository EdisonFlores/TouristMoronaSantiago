// js/map/context_menu.js
export function installMapContextMenu(map, handlers = {}) {
  const {
    onDirectionsFromHere = null,
    onDirectionsToHere = null,
    onClearDirections = null, // ✅ NUEVO
    onCenterHere = null
  } = handlers || {};

  // Evitar duplicados si se llama 2 veces
  if (map.__tm_ctxmenu_installed) return;
  map.__tm_ctxmenu_installed = true;

  const menu = document.createElement("div");
  menu.id = "tm-ctxmenu";
  menu.style.position = "absolute";
  menu.style.zIndex = "9999";
  menu.style.minWidth = "210px";
  menu.style.background = "#fff";
  menu.style.border = "1px solid rgba(0,0,0,.2)";
  menu.style.borderRadius = "10px";
  menu.style.boxShadow = "0 6px 18px rgba(0,0,0,.18)";
  menu.style.padding = "6px";
  menu.style.display = "none";
  menu.style.userSelect = "none";

  const itemStyle = `
    width: 100%;
    padding: 10px 10px;
    border: 0;
    background: transparent;
    text-align: left;
    cursor: pointer;
    border-radius: 8px;
    font-size: 14px;
  `;

  const itemHover = (btn, on) => {
    btn.style.background = on ? "rgba(0,0,0,.06)" : "transparent";
  };

  const mkItem = (label, fn) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.style.cssText = itemStyle;
    btn.textContent = label;

    btn.onmouseenter = () => itemHover(btn, true);
    btn.onmouseleave = () => itemHover(btn, false);

    btn.onclick = () => {
      hide();
      try { fn?.(); } catch (e) { console.warn("ctxmenu handler error:", e); }
    };
    return btn;
  };

  const sep = () => {
    const hr = document.createElement("div");
    hr.style.height = "1px";
    hr.style.margin = "6px 6px";
    hr.style.background = "rgba(0,0,0,.12)";
    return hr;
  };

  function show(containerPoint, latlng) {
    menu.innerHTML = "";

    if (typeof onDirectionsFromHere === "function") {
      menu.appendChild(mkItem("📍 Indicaciones desde aquí", () => onDirectionsFromHere(latlng)));
    }

    if (typeof onDirectionsToHere === "function") {
      menu.appendChild(mkItem("🎯 Indicaciones hasta aquí", () => onDirectionsToHere(latlng)));
    }

    // ✅ NUEVO: quitar indicaciones
    if (typeof onClearDirections === "function") {
      menu.appendChild(sep());
      menu.appendChild(mkItem("🧹 Quitar indicaciones", () => onClearDirections()));
    }

    if (typeof onCenterHere === "function") {
      menu.appendChild(sep());
      menu.appendChild(mkItem("🎯 Centrar mapa aquí", () => onCenterHere(latlng)));
    }

    if (!menu.childNodes.length) return;

    const c = map.getContainer();
    c.appendChild(menu);

    // Posicionar relativo al contenedor del mapa
    menu.style.left = `${containerPoint.x}px`;
    menu.style.top = `${containerPoint.y}px`;
    menu.style.display = "block";
  }

  function hide() {
    menu.style.display = "none";
  }

  // ocultar al hacer click normal en mapa
  map.on("click", () => hide());
  map.on("movestart", () => hide());
  map.on("zoomstart", () => hide());

  // click derecho
  map.on("contextmenu", (e) => {
    const pt = map.latLngToContainerPoint(e.latlng);
    show(pt, e.latlng);
  });

  // ESC para cerrar
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") hide();
  });

  // click afuera para cerrar
  document.addEventListener("click", (ev) => {
    if (!menu || menu.style.display === "none") return;
    if (!menu.contains(ev.target)) hide();
  });
}