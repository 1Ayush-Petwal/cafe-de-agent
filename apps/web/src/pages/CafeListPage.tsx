import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { api, CafeDto } from '../api/client';

// react-leaflet + bundler: the default marker icon paths break under Vite, so
// point them at the bundled asset URLs (issue #18 — Leaflet/OSM, no Google Maps).
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const DEFAULT_ICON = new L.Icon.Default();

const SELECTED_ICON = new L.Icon({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [30, 49],
  iconAnchor: [15, 49],
  popupAnchor: [1, -40],
  className: 'cafe-pin-selected',
});

const DELHI_CENTER: [number, number] = [28.6139, 77.209];

interface Coords {
  lat: number;
  lon: number;
}

/** Great-circle distance in km (haversine), computed client-side. */
function haversineKm(a: Coords, b: Coords): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Open/closed derived from the café's opening/closing hour vs the current hour. */
function isOpenNow(cafe: CafeDto): boolean {
  const hour = new Date().getHours();
  return hour >= cafe.openingHour && hour < cafe.closingHour;
}

/** Google Maps universal directions deep link (plain URL, no embed/API key). */
function directionsUrl(cafe: CafeDto): string {
  const destination =
    cafe.latitude != null && cafe.longitude != null
      ? `${cafe.latitude},${cafe.longitude}`
      : encodeURIComponent(`${cafe.name}, ${cafe.area}`);
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
}

/** Pans the map to the selected café without re-mounting the map. */
function MapFocus({ cafe }: { cafe: CafeDto | null }) {
  const map = useMap();
  useEffect(() => {
    if (cafe && cafe.latitude != null && cafe.longitude != null) {
      map.setView([cafe.latitude, cafe.longitude], Math.max(map.getZoom(), 14));
    }
  }, [cafe, map]);
  return null;
}

export function CafeListPage() {
  const [cafes, setCafes] = useState<CafeDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [userLoc, setUserLoc] = useState<Coords | null>(null);

  useEffect(() => {
    api
      .listCafes()
      .then(setCafes)
      .catch(() => setError('Could not load cafés'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // Permission denied (or unsupported) → simply leave distances off; the
    // page stays fully functional (issue #18 acceptance criterion).
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLoc({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => setUserLoc(null),
    );
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cafes;
    return cafes.filter(
      (c) => c.name.toLowerCase().includes(q) || c.area.toLowerCase().includes(q),
    );
  }, [cafes, search]);

  const selected = useMemo(
    () => cafes.find((c) => c.id === selectedId) ?? null,
    [cafes, selectedId],
  );

  const mapped = useMemo(
    () => filtered.filter((c) => c.latitude != null && c.longitude != null),
    [filtered],
  );

  if (loading) return <p>Loading cafés…</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <div>
      <h1>Cafés in Delhi</h1>
      <input
        className="locator-search"
        type="search"
        placeholder="Search by name or area…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="locator-layout">
        <ul className="cafe-list locator-cards">
          {filtered.map((cafe) => {
            const distance =
              userLoc && cafe.latitude != null && cafe.longitude != null
                ? haversineKm(userLoc, { lat: cafe.latitude, lon: cafe.longitude })
                : null;
            const open = isOpenNow(cafe);
            return (
              <li
                key={cafe.id}
                className={`locator-card${cafe.id === selectedId ? ' selected' : ''}`}
                onMouseEnter={() => setSelectedId(cafe.id)}
              >
                <div className="locator-card-head">
                  <Link to={`/cafes/${cafe.id}`}>
                    <strong>{cafe.name}</strong>
                  </Link>
                  <span className="rating" title={`${cafe.ratingCount} ratings`}>
                    ★ {cafe.rating.toFixed(1)}
                  </span>
                </div>
                <span className="area">{cafe.area}</span>
                <div className="locator-meta">
                  <span className={open ? 'open' : 'closed'}>{open ? 'Open' : 'Closed'}</span>
                  {distance != null && <span>{distance.toFixed(1)} km away</span>}
                </div>
                {cafe.cuisines.length > 0 && (
                  <div className="cuisines">
                    {cafe.cuisines.map((c) => (
                      <span key={c} className="cuisine-chip">
                        {c}
                      </span>
                    ))}
                  </div>
                )}
                <a
                  className="directions-link"
                  href={directionsUrl(cafe)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Directions
                </a>
              </li>
            );
          })}
          {filtered.length === 0 && <li>No cafés match “{search}”.</li>}
        </ul>
        <div className="locator-map">
          <MapContainer center={DELHI_CENTER} zoom={12} style={{ height: '100%', width: '100%' }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapFocus cafe={selected} />
            {mapped.map((cafe) => (
              <Marker
                key={cafe.id}
                position={[cafe.latitude as number, cafe.longitude as number]}
                icon={cafe.id === selectedId ? SELECTED_ICON : DEFAULT_ICON}
                eventHandlers={{ click: () => setSelectedId(cafe.id) }}
              >
                <Popup>
                  <strong>{cafe.name}</strong>
                  <br />
                  {cafe.area}
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      </div>
    </div>
  );
}
