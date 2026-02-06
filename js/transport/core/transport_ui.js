// js/transport/core/transport_ui.js

export function renderLineaExtraControls(
  container,
  { sentidos = [], showCobertura = false, coberturas = [] }
) {
  let wrap = container.querySelector("#linea-extra");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "linea-extra";
    container.appendChild(wrap);
  }

  wrap.innerHTML = "";

  if (sentidos.length) {
    const sel = document.createElement("select");
    sel.id = "select-sentido";
    sel.className = "form-select mb-2";
    sel.innerHTML =
      `<option value="">Seleccione sentido</option>` +
      sentidos.map(s => `<option value="${s}">${s}</option>`).join("");
    wrap.appendChild(sel);
  }

  if (showCobertura) {
    const sel2 = document.createElement("select");
    sel2.id = "select-cobertura";
    sel2.className = "form-select mb-2";
    sel2.innerHTML =
      `<option value="">Seleccione cobertura</option>` +
      coberturas.map(c => `<option value="${c}">${c}</option>`).join("");
    wrap.appendChild(sel2);
  }
}
