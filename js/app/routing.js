let routingControl = null;

export const trazarRuta = (map, from, to, color = "#007bff") => {
  if (!from || !to) return;

  if (routingControl) {
    map.removeControl(routingControl);
  }

  routingControl = L.Routing.control({
    waypoints: [
      L.latLng(from[0], from[1]),
      L.latLng(to[0], to[1])
    ],
    lineOptions: {
      styles: [{ color, weight: 5 }]
    },
    router: L.Routing.osrmv1({
      serviceUrl: "https://router.project-osrm.org/route/v1"
    }),
    addWaypoints: false,
    draggableWaypoints: false,
    fitSelectedRoutes: true,
    show: false
  }).addTo(map);
};

// ✅ FUNCIÓN QUE FALTABA
export function calcularTiempo(route, mode) {
  const velocidades = {
    walking: 5,
    bicycle: 15,
    motorcycle: 35,
    driving: 40
  };

  const velocidad = velocidades[mode] || 5;

  const distanciaKm = route.distance / 1000;
  const tiempoHoras = distanciaKm / velocidad;

  return {
    distancia: distanciaKm.toFixed(2),
    tiempo: Math.ceil(tiempoHoras * 60) + " min"
  };
}
