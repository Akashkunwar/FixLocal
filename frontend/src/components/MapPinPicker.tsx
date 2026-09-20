import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/** Bengaluru demo centre */
export const BLR_CENTER = { lat: 12.9716, lng: 77.5946 };

// OpenStreetMap's public tiles are fine for development only; set VITE_MAP_TILE_URL
// to a provider with a production usage policy before launch.
const TILE_URL = import.meta.env.VITE_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  import.meta.env.VITE_MAP_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const DEFAULT_ZOOM = 12;

// Fix default marker icons under Vite (broken relative paths)
const markerIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

type Props = {
  lat: number | null;
  lng: number | null;
  onChange: (coords: { lat: number; lng: number }) => void;
  height?: number;
  className?: string;
};

export function MapPinPicker({ lat, lng, onChange, height = 260, className }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const startLat = lat ?? BLR_CENTER.lat;
    const startLng = lng ?? BLR_CENTER.lng;

    const map = L.map(containerRef.current, {
      center: [startLat, startLng],
      zoom: DEFAULT_ZOOM,
      scrollWheelZoom: false,
    });
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);

    const marker = L.marker([startLat, startLng], {
      draggable: true,
      icon: markerIcon,
    }).addTo(map);

    marker.on("dragend", () => {
      const p = marker.getLatLng();
      onChangeRef.current({
        lat: Math.round(p.lat * 1e5) / 1e5,
        lng: Math.round(p.lng * 1e5) / 1e5,
      });
    });

    map.on("click", (e: L.LeafletMouseEvent) => {
      const { lat: clat, lng: clng } = e.latlng;
      marker.setLatLng([clat, clng]);
      onChangeRef.current({
        lat: Math.round(clat * 1e5) / 1e5,
        lng: Math.round(clng * 1e5) / 1e5,
      });
    });

    mapRef.current = map;
    markerRef.current = marker;

    // If parent had no coords yet, seed Bengaluru once
    if (lat == null || lng == null) {
      onChangeRef.current({
        lat: Math.round(startLat * 1e5) / 1e5,
        lng: Math.round(startLng * 1e5) / 1e5,
      });
    }

    // Leaflet needs a paint before sizing correctly in some layouts
    setTimeout(() => map.invalidateSize(), 80);

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  // Sync external lat/lng → marker (e.g. reset draft)
  useEffect(() => {
    if (lat == null || lng == null || !markerRef.current || !mapRef.current) return;
    const cur = markerRef.current.getLatLng();
    if (Math.abs(cur.lat - lat) < 1e-5 && Math.abs(cur.lng - lng) < 1e-5) return;
    markerRef.current.setLatLng([lat, lng]);
    mapRef.current.panTo([lat, lng]);
  }, [lat, lng]);

  return (
    <div className={className}>
      <div
        ref={containerRef}
        className="overflow-hidden rounded-xl ring-1 ring-slate-200"
        style={{ height }}
        role="application"
        aria-label="Map pin picker — click or drag to set job location"
      />
      <p className="mt-1.5 text-xs text-slate-500">
        Click the map or drag the pin to set coordinates
        {lat != null && lng != null && (
          <span className="ml-1 font-mono text-slate-600">
            ({lat.toFixed(5)}, {lng.toFixed(5)})
          </span>
        )}
      </p>
    </div>
  );
}
