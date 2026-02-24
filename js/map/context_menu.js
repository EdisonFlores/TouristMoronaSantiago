// js/map/context_menu.js
export function installMapContextMenu(map, { onDirectionsToHere, onCenterHere } = {}) {
  if (!map) return;

  // --- styles mínimos (por si css no carga aún)
  const ensureStyles = () => {
    if (document.getElementById("tm-contextmenu-style")) return;
    const st = document.createElement("style");
    st.id = "tm-contextmenu-style";
    st.textContent = `
      .tm-cm{position:absolute;z-index:99999;min-width:220px;background:#fff;border-radius:10px;
        box-shadow:0 10px 30px rgba(0,0,0,.18);border:1px solid rgba(0,0,0,.08);overflow:hidden;font-size:14px}
      .tm-cm .tm-item{padding:10px 12px;cursor:pointer;display:flex;gap:10px;align-items:center}
      .tm-cm .tm-item:hover{background:rgba(13,110,253,.08)}
      .tm-cm .tm-sep{height:1px;background:rgba(0,0,0,.08)}
      .tm-cm .tm-ico{width:18px;text-align:center}
    `;
    document.head.appendChild(st);
  };

  ensureStyles();

  const menu = document.createElement("div");
  menu.className = "tm-cm";
  menu.style.display = "none";
  menu.innerHTML = `
    <div class="tm-item" data-act="toHere">
      <span class="tm-ico">🧭</span>
      <span>Indicaciones hasta aquí</span>
    </div>
    <div class="tm-sep"></div>
    <div class="tm-item" data-act="center">
      <span class="tm-ico">🎯</span>
      <span>Centrar mapa aquí</span>
    </div>
  `;
  document.body.appendChild(menu);

  let lastLatLng = null;

  function hide() {
    menu.style.display = "none";
    lastLatLng = null;
  }

  function showAt(pageX, pageY) {
    menu.style.display = "block";
    // ajuste para no salir de pantalla
    const pad = 8;
    const w = menu.offsetWidth || 240;
    const h = menu.offsetHeight || 120;

    let x = pageX;
    let y = pageY;

    const maxX = window.innerWidth - w - pad;
    const maxY = window.innerHeight - h - pad;

    if (x > maxX) x = maxX;
    if (y > maxY) y = maxY;

    menu.style.left = `${Math.max(pad, x)}px`;
    menu.style.top = `${Math.max(pad, y)}px`;
  }

  // click fuera
  document.addEventListener("click", () => hide(), true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });

  // clicks del menú
  menu.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const act = e.target?.closest?.("[data-act]")?.dataset?.act;
    if (!act || !lastLatLng) return;

    if (act === "toHere" && typeof onDirectionsToHere === "function") {
      onDirectionsToHere(lastLatLng);
    }
    if (act === "center" && typeof onCenterHere === "function") {
      onCenterHere(lastLatLng);
    }
    hide();
  });

  // evento leaflet
  map.on("contextmenu", (ev) => {
    lastLatLng = ev.latlng;
    // Leaflet envía el evento original del mouse en ev.originalEvent
    const oe = ev.originalEvent;
    const x = oe?.pageX ?? 0;
    const y = oe?.pageY ?? 0;
    showAt(x, y);
  });

  // si arrastras o haces zoom: ocultar
  map.on("movestart zoomstart", () => hide());

  return { hide };
}