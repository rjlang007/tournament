import { useEffect } from "react";
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";

const DEFAULT_CENTER: LatLngExpression = [14.5995, 120.9842];

type Props = {
  latitude?: number | null;
  longitude?: number | null;
  editable?: boolean;
  onChange?: (latitude: number, longitude: number) => void;
};

function MapViewport({ center }: { center: LatLngExpression }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom() < 5 ? 15 : map.getZoom());
  }, [center, map]);
  return null;
}

function MapClickHandler({ onChange }: { onChange?: Props["onChange"] }) {
  useMapEvents({
    click(event) {
      onChange?.(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

export default function TournamentLocationMap({ latitude, longitude, editable = false, onChange }: Props) {
  const hasLocation = typeof latitude === "number" && typeof longitude === "number";
  const center: LatLngExpression = hasLocation ? [latitude, longitude] : DEFAULT_CENTER;

  return (
    <MapContainer center={center} zoom={hasLocation ? 16 : 12} scrollWheelZoom className="h-64 w-full rounded-xl">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapViewport center={center} />
      {editable && <MapClickHandler onChange={onChange} />}
      {hasLocation && <CircleMarker center={[latitude, longitude]} radius={10} pathOptions={{ color: "#f2c94c", fillColor: "#f2c94c", fillOpacity: 0.9 }} />}
    </MapContainer>
  );
}
