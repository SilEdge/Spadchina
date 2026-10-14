import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export function installAtlasMap(target, atlas, placeURL, esc) {
  const container = document.createElement('div');
  container.id = 'atlas-map';
  container.className = 'interactive-atlas-map';
  container.setAttribute('aria-label', 'Карта мест Беларуси');
  target.replaceWith(container);
  const map = L.map(container, { scrollWheelZoom: false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  }).addTo(map);
  if (window.SP?.b) L.geoJSON(window.SP.b, { style: { color: '#2d6ba4', weight: 2, fillOpacity: 0.04 }, interactive: false }).addTo(map);
  const points = [];
  atlas.places.forEach((place, index) => {
    const coords = atlas.coords?.[place.id];
    if (!coords || coords.length !== 2) return;
    points.push(coords);
    const icon = L.divIcon({ className: 'atlas-marker', html: `<span>${index + 1}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
    L.marker(coords, { icon, title: place.name, alt: place.name, keyboard: true })
      .bindPopup(`<strong>${esc(place.name)}</strong>${place.map_label ? `<p>${esc(place.map_label)}</p>` : ''}<p>${esc(place.region)} · ${place.tasks} заданий</p><a class="atlas-popup-link" href="${placeURL(place)}">Открыть статью →</a>`)
      .addTo(map);
  });
  if (points.length) map.fitBounds(points, { padding: [35, 35], maxZoom: 7, animate: false });
  else map.setView([53.7, 27.5], 7);
  const observer = new ResizeObserver(() => map.invalidateSize());
  observer.observe(container);
  window.addEventListener('pagehide', () => { observer.disconnect(); map.remove(); }, { once: true });
  return map;
}
