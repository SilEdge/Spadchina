import { useState } from 'react';
import boundary from '../data/belarus-outline.json';

const bounds = { west: 23.1, east: 32.8, north: 56.25, south: 51.2 };
const atlasPlaces = [
  { query: 'Мирский замок', lat: 53.451, lng: 26.473 },
  { query: 'Несвижский дворец', lat: 53.222, lng: 26.691 },
  { query: 'Беловежская пуща', lat: 52.569, lng: 23.803 },
  { query: 'Брестская крепость', lat: 52.083, lng: 23.656 },
  { query: 'Франциску Скорине', lat: 55.485, lng: 28.774 },
  { query: 'Красном Береге', lat: 52.967, lng: 29.768 },
  { query: 'Ружанский дворец', lat: 52.556, lng: 24.457 },
  { query: 'Браславские озёра', lat: 55.639, lng: 27.031 },
  { query: 'Слуцкие пояса', lat: 53.028, lng: 27.559 },
  { query: 'Полоцкая София', lat: 55.486, lng: 28.758 },
  { query: 'Хатынь', lat: 54.334, lng: 27.943 },
];

const ring = boundary.features[0].geometry.coordinates[0];
const toPoint = ([lng, lat]) => ({
  x: ((lng - bounds.west) / (bounds.east - bounds.west)) * 600,
  y: ((bounds.north - lat) / (bounds.north - bounds.south)) * 330,
});
const outline = `${ring.map((coordinate, index) => {
  const { x, y } = toPoint(coordinate);
  return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
}).join(' ')} Z`;

function taskCount(article) {
  return article.questionSets?.flat().length || article.questions?.length || 0;
}

export default function HeritageAtlas({ articles, activeCategory, onSelect, onOpenCatalog }) {
  const [zoom, setZoom] = useState(1);
  const points = atlasPlaces.flatMap((point) => {
    const article = articles.find((item) => item.title.toLocaleLowerCase().includes(point.query.toLocaleLowerCase()));
    if (!article || (activeCategory && article.category !== activeCategory)) return [];
    return [{ ...point, article, ...toPoint([point.lng, point.lat]) }];
  });
  const pointWord = points.length === 1 ? 'ТОЧКА' : points.length > 1 && points.length < 5 ? 'ТОЧКИ' : 'ТОЧЕК';
  const places = (activeCategory ? articles.filter((article) => article.category === activeCategory) : articles).slice(0, 6);

  return (
    <section id="atlas" className="atlas-section">
      <div className="container atlas-inner">
        <div className="atlas-heading">
          <span className="design-mono">Атлас</span>
          <h2>Карта историй</h2>
        </div>
        <div className="atlas-map" role="group" aria-label="Интерактивная карта достопримечательностей Беларуси">
          <div className="atlas-map-scene" style={{ transform: `scale(${zoom})` }}>
            <svg className="atlas-svg" viewBox="0 0 600 330" role="img" aria-label="Схема Беларуси с отмеченными достопримечательностями">
              <defs>
                <pattern id="atlas-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                  <path d="M 32 0 L 0 0 0 32" fill="none" stroke="currentColor" strokeOpacity=".1" strokeWidth="1" />
                </pattern>
                <pattern id="atlas-fill" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
                  <line x1="0" y1="0" x2="0" y2="8" stroke="currentColor" strokeOpacity=".1" strokeWidth="2" />
                </pattern>
              </defs>
              <rect width="600" height="330" fill="url(#atlas-grid)" />
              <path d={outline} className="atlas-boundary-shape" />
              <path d={outline} fill="url(#atlas-fill)" />
              <path d="M 38 200 C 110 188, 145 146, 218 162 S 318 244, 368 168 S 466 88, 555 116" className="atlas-route-line" />
              {points.map((point) => (
                <g key={point.article.id} transform={`translate(${point.x} ${point.y})`}>
                  <circle r="11" className="atlas-point-halo" /><circle r="4.5" className="atlas-point-dot" />
                </g>
              ))}
            </svg>
            <div className="atlas-map-pins">
              {points.map((point) => (
                <button key={point.article.id} className="atlas-pin" style={{ left: `${(point.x / 600) * 100}%`, top: `${(point.y / 330) * 100}%` }} onClick={() => onSelect(point.article)} aria-label={`Открыть: ${point.article.title}`} title={point.article.title}><span /></button>
              ))}
            </div>
          </div>
          <div className="atlas-map-label"><span>БЕЛАРУСЬ · {points.length} {pointWord} МАРШРУТА</span><span>53° 43′ N · 27° 58′ E</span></div>
          <div className="atlas-map-controls" aria-label="Управление масштабом карты">
            <button onClick={() => setZoom((value) => Math.min(2, value + 0.2))} aria-label="Приблизить карту">+</button>
            <button onClick={() => setZoom((value) => Math.max(1, value - 0.2))} aria-label="Отдалить карту">−</button>
            <button onClick={() => setZoom(1)} aria-label="Сбросить масштаб">⌖</button>
          </div>
          <span className="atlas-map-credit">СХЕМА · ИНТЕРАКТИВНЫЕ ТОЧКИ</span>
        </div>
        <ol className="atlas-place-grid">
          {places.map((place, index) => (
            <li key={place.id}>
              <button className="atlas-place-card" onClick={() => onSelect(place)}>
                <span className="atlas-place-index design-mono">{String(index + 1).padStart(2, '0')}</span>
                <span className="atlas-place-copy"><strong>{place.title}</strong><small>{place.categoryLabel}{place.region ? ` · ${place.region}` : ''}</small></span>
                <span className="atlas-place-points design-mono">{taskCount(place)} заданий</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="atlas-all-row"><button onClick={onOpenCatalog}>Все места <span aria-hidden="true">→</span></button></div>
      </div>
    </section>
  );
}
