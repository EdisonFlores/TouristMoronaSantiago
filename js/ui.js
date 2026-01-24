export function renderUI(dataList, onSelect, onNearest, onMode) {
  const extraControls = document.getElementById("extra-controls");

  extraControls.innerHTML = `
    <select id="place-select" class="form-select mb-2">
      <option value="">📍 Seleccione un lugar</option>
      ${dataList.map((p,i)=>`<option value="${i}">${p.nombre}</option>`).join("")}
    </select>

    <button id="btn-nearest" class="btn btn-sm btn-primary mb-2">
      📌 Más cercano
    </button>

    <div class="d-flex gap-2 flex-wrap">
      <button data-mode="walking">🚶</button>
      <button data-mode="bicycle">🚲</button>
      <button data-mode="motorcycle">🏍️</button>
      <button data-mode="driving">🚗</button>
      <button data-mode="bus">🚌</button>
    </div>
  `;

  document.getElementById("place-select").onchange = e => {
    if (e.target.value !== "") {
      onSelect(dataList[e.target.value]);
    }
  };

  document.getElementById("btn-nearest").onclick = onNearest;

  document.querySelectorAll("[data-mode]").forEach(btn => {
    btn.onclick = () => onMode(btn.dataset.mode);
  });
}
