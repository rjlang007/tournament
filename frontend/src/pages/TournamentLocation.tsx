import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, Tournament } from "../lib/api";
import { useTournamentSocket } from "../lib/socket";
import TournamentLocationMap from "../components/TournamentLocationMap";

export default function TournamentLocation() {
  const { tournamentId } = useParams();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [locationName, setLocationName] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [locationLatitude, setLocationLatitude] = useState<number | null>(null);
  const [locationLongitude, setLocationLongitude] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    api.get(`/tournaments/${tournamentId}`).then((response) => {
      const data: Tournament = response.data;
      setTournament(data);
      setLocationName(data.locationName ?? "");
      setLocationAddress(data.locationAddress ?? "");
      setLocationLatitude(data.locationLatitude ?? null);
      setLocationLongitude(data.locationLongitude ?? null);
    });
  };

  useEffect(() => { load(); }, [tournamentId]);
  useTournamentSocket(tournamentId, ["tournament:changed"], load);

  const saveLocation = async () => {
    setSaving(true);
    try {
      await api.patch(`/tournaments/${tournamentId}/location`, {
        locationName,
        locationAddress,
        latitude: locationLatitude,
        longitude: locationLongitude,
      });
      load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <div className="text-xs uppercase tracking-[0.2em] text-white/50">Tournament setup</div>
        <h1 className="mt-1 font-display text-3xl font-bold text-white">Playing location</h1>
        <p className="mt-2 max-w-2xl text-sm text-white/55">
          Keep the venue details and map pin here. Court Control stays focused on live courts, games, and the queue.
        </p>
      </header>

      <section className="glass-panel p-4 sm:p-6">
        <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="space-y-4">
            <div>
              <label className="field-label">Venue name</label>
              <input
                className="field"
                value={locationName}
                onChange={(event) => setLocationName(event.target.value)}
                placeholder="e.g. Riverside Sports Center"
              />
            </div>
            <div>
              <label className="field-label">Address</label>
              <textarea
                className="field min-h-24"
                value={locationAddress}
                onChange={(event) => setLocationAddress(event.target.value)}
                placeholder="Street, city, province"
              />
            </div>
            <p className="text-xs text-white/40">
              {locationLatitude !== null && locationLongitude !== null
                ? `Pinned at ${locationLatitude.toFixed(5)}, ${locationLongitude.toFixed(5)}`
                : "No map pin selected yet."}
            </p>
            <button onClick={saveLocation} disabled={saving} className="action-button w-full sm:w-auto disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? "Saving..." : "Save venue"}
            </button>
          </div>

          <div className="overflow-hidden rounded-xl border border-white/10">
            <TournamentLocationMap
              latitude={locationLatitude}
              longitude={locationLongitude}
              editable
              onChange={(latitude, longitude) => {
                setLocationLatitude(latitude);
                setLocationLongitude(longitude);
              }}
            />
          </div>
        </div>
      </section>

      {tournament && (
        <p className="text-xs text-white/35">
          This location is shared across the entire {tournament.name} tournament event.
        </p>
      )}
    </div>
  );
}
