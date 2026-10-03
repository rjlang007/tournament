import { useEffect, useState, FormEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api, fileUrl } from "../../lib/api";
import type { EventDivisionName, EventPaymentMethod, PostDetail, RegistrationField, RegistrationFieldType, Tournament } from "../../lib/api";
import TournamentLocationMap from "../../components/TournamentLocationMap";

const FIELD_TYPES: RegistrationFieldType[] = ["text", "textarea", "number", "email", "phone"];
const DIVISIONS: { name: EventDivisionName; label: string }[] = [
  { name: "BEGINNER", label: "Beginner" },
  { name: "NOVICE", label: "Novice" },
  { name: "LOW_INTERMEDIATE", label: "Low intermediate" },
  { name: "HIGH_INTERMEDIATE", label: "High intermediate" },
];

export default function CreatePost() {
  const navigate = useNavigate();
  const locationState = useLocation().state as { notice?: string } | null;
  const { postId } = useParams();
  const isEditing = !!postId;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [details, setDetails] = useState("");
  const [paymentInstructions, setPaymentInstructions] = useState("");
  const [location, setLocation] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [locationLatitude, setLocationLatitude] = useState<number | null>(null);
  const [locationLongitude, setLocationLongitude] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [scheduledStart, setScheduledStart] = useState("");
  const [scheduledEnd, setScheduledEnd] = useState("");
  const [registrationLink, setRegistrationLink] = useState("");
  const [fields, setFields] = useState<RegistrationField[]>([]);
  const [photos, setPhotos] = useState<FileList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [tournamentId, setTournamentId] = useState("");
  const [tournamentType, setTournamentType] = useState<"RANDOM_PAIRING" | "FIXED_BRACKET">("RANDOM_PAIRING");
  const [divisionCapacities, setDivisionCapacities] = useState<Record<EventDivisionName, string>>({
    BEGINNER: "", NOVICE: "", LOW_INTERMEDIATE: "", HIGH_INTERMEDIATE: "",
  });
  const [paymentMethods, setPaymentMethods] = useState<EventPaymentMethod[]>(["IN_PERSON"]);
  const [paymentQrFile, setPaymentQrFile] = useState<File | null>(null);
  const [existingQrUrl, setExistingQrUrl] = useState<string | null>(null);
  const [paymentQrRemoved, setPaymentQrRemoved] = useState(false);
  const [loaded, setLoaded] = useState(!postId);

  useEffect(() => {
    api.get<Tournament[]>("/tournaments").then(({ data }) => setTournaments(data.filter((t) => t.status !== "COMPLETED")));
    if (postId) {
      api.get<PostDetail>(`/posts/${postId}`).then(({ data }) => {
        if (!data.isOwner) throw new Error("Only the event host can edit this event.");
        setTitle(data.title);
        setDescription(data.description);
        setDetails(data.details ?? "");
        setPaymentInstructions(data.paymentInstructions ?? "");
        setLocation(data.location);
        setLocationAddress(data.locationAddress ?? "");
        setLocationLatitude(data.locationLatitude ?? null);
        setLocationLongitude(data.locationLongitude ?? null);
        setAmount(data.amount ?? "");
        setScheduledStart(toLocalDateTime(data.scheduledStart));
        setScheduledEnd(toLocalDateTime(data.scheduledEnd));
        setRegistrationLink(data.registrationLink ?? "");
        setFields(data.registrationFields);
        setTournamentId(data.tournamentId ?? "");
        setDivisionCapacities(Object.fromEntries(DIVISIONS.map(({ name }) => [name, data.divisions.find((division) => division.name === name)?.capacity.toString() ?? ""])) as Record<EventDivisionName, string>);
        setPaymentMethods(data.paymentMethods);
        setExistingQrUrl(data.paymentQrUrl ?? null);
        setPaymentQrRemoved(false);
      }).catch((err: any) => setError(err?.message || "Could not load this event."))
        .finally(() => setLoaded(true));
    }
  }, [postId]);

  function addField() {
    setFields([...fields, { label: "", type: "text", required: false }]);
  }
  function updateField(i: number, patch: Partial<RegistrationField>) {
    setFields(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  function removeField(i: number) {
    setFields(fields.filter((_, idx) => idx !== i));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const divisions = DIVISIONS.flatMap(({ name }) => divisionCapacities[name].trim()
      ? [{ name, capacity: Number(divisionCapacities[name]) }]
      : []);
    if (divisions.length === 0) {
      setError("Choose at least one player division and set its capacity.");
      return;
    }
    if (paymentMethods.length === 0) {
      setError("Choose at least one payment option.");
      return;
    }
    if (!isEditing && (locationLatitude === null || locationLongitude === null)) {
      setError("Pin the venue on the map before publishing.");
      return;
    }
    if (paymentMethods.includes("QR") && !paymentQrFile && (!existingQrUrl || paymentQrRemoved)) {
      setError("Upload the payment QR image or remove QR payment from the options.");
      return;
    }
    setSubmitting(true);
    try {
      const cleanFields = fields.filter((f) => f.label.trim().length > 0);
      const payload = {
        title,
        description,
        details: isEditing ? details || null : details || undefined,
        paymentInstructions: isEditing ? paymentInstructions || null : paymentInstructions || undefined,
        location,
        locationAddress: locationAddress || null,
        locationLatitude,
        locationLongitude,
        amount: isEditing ? amount : amount || undefined,
        capacity: divisions.reduce((total, division) => total + division.capacity, 0),
        divisions,
        paymentMethods,
        scheduledStart: scheduledStart ? new Date(scheduledStart).toISOString() : isEditing ? null : undefined,
        scheduledEnd: scheduledEnd ? new Date(scheduledEnd).toISOString() : isEditing ? null : undefined,
        registrationLink: isEditing ? registrationLink : registrationLink || undefined,
        registrationFields: isEditing ? cleanFields : cleanFields.length > 0 ? cleanFields : undefined,
        tournamentId: tournamentId || undefined,
        tournamentType,
      };
      const { data } = isEditing
        ? await api.patch(`/posts/${postId}`, payload)
        : await api.post("/posts", payload);

      if (paymentQrFile) {
        const form = new FormData();
        form.append("qr", paymentQrFile);
        try {
          await api.post(`/posts/${data.id}/payment-qr`, form, { headers: { "Content-Type": "multipart/form-data" } });
        } catch {
          navigate(`/community/${data.id}/edit`, { state: { notice: "Event saved, but the QR image did not upload. Choose it again and save." } });
          return;
        }
      } else if (paymentQrRemoved && existingQrUrl && isEditing) {
        await api.delete(`/posts/${data.id}/payment-qr`);
      }

      if (photos && photos.length > 0) {
        const form = new FormData();
        Array.from(photos).forEach((file) => form.append("photos", file));
        await api.post(`/posts/${data.id}/photos`, form, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }

      navigate(`/community/${data.id}`);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Couldn't create the post. Please check the form and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-white outline-none focus:border-ball";

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl font-bold text-white mb-6">{isEditing ? "Edit event" : "Publish an event"}</h1>
      {locationState?.notice && <p className="mb-4 text-sm text-advance">{locationState.notice}</p>}
      {!loaded ? <p className="text-sm text-white/60">Loading event…</p> : <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <label className="block text-sm text-white/70 mb-1">Title</label>
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div>
          <label className="block text-sm text-white/70 mb-1">Description</label>
          <textarea
            className={inputClass}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="block text-sm text-white/70 mb-1">Details (format, rules, schedule, etc.)</label>
          <textarea className={inputClass} rows={4} value={details} onChange={(e) => setDetails(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm text-white/70 mb-1">Payment instructions</label>
          <textarea className={inputClass} rows={3} value={paymentInstructions} onChange={(e) => setPaymentInstructions(e.target.value)} placeholder="Bank transfer, mobile wallet, or pay-at-venue instructions" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="block text-sm text-white/70 mb-1">Starts</label><input className={inputClass} type="datetime-local" value={scheduledStart} onChange={(e) => setScheduledStart(e.target.value)} required={!isEditing} /></div>
          <div><label className="block text-sm text-white/70 mb-1">Ends (optional)</label><input className={inputClass} type="datetime-local" value={scheduledEnd} onChange={(e) => setScheduledEnd(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-white/70 mb-1">Venue name or area</label>
            <input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} required />
          </div>
          <div>
            <label className="block text-sm text-white/70 mb-1">Entry fee or prize in PHP (optional)</label>
            <input
              className={inputClass}
              placeholder="e.g. ₱200 per player or Free"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </div>
        <section className="space-y-3 rounded-lg border border-white/10 p-4">
          <div><h2 className="font-display font-semibold text-white">Venue pin</h2><p className="text-xs text-white/50">Tap the map to place the event pin.</p></div>
          <textarea className={inputClass} rows={2} value={locationAddress} onChange={(e) => setLocationAddress(e.target.value)} placeholder="Street address, town, province" />
          <div className="overflow-hidden rounded-lg border border-white/10">
            <TournamentLocationMap
              latitude={locationLatitude}
              longitude={locationLongitude}
              editable
              onChange={(latitude, longitude) => { setLocationLatitude(latitude); setLocationLongitude(longitude); }}
            />
          </div>
          <p className="text-xs text-white/45">{locationLatitude !== null && locationLongitude !== null ? `Pinned at ${locationLatitude.toFixed(5)}, ${locationLongitude.toFixed(5)}` : "No map pin selected"}</p>
        </section>
        <section className="space-y-3 rounded-lg border border-white/10 p-4">
          <div><h2 className="font-display font-semibold text-white">Player divisions</h2><p className="text-xs text-white/50">Select the levels you offer and set the number of player spots in each.</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            {DIVISIONS.map(({ name, label }) => {
              const selected = divisionCapacities[name] !== "";
              return <div key={name} className="rounded-lg border border-white/10 p-3">
                <label className="flex items-center gap-2 text-sm font-medium text-white"><input type="checkbox" checked={selected} onChange={(event) => setDivisionCapacities((current) => ({ ...current, [name]: event.target.checked ? current[name] || "16" : "" }))} />{label}</label>
                {selected && <label className="mt-3 block text-xs text-white/55">Player spots<input className={`${inputClass} mt-1`} type="number" min="1" max="1000" step="1" required value={divisionCapacities[name]} onChange={(event) => setDivisionCapacities((current) => ({ ...current, [name]: event.target.value }))} /></label>}
              </div>;
            })}
          </div>
          {Object.values(divisionCapacities).some(Boolean) && <p className="text-xs text-white/55">Total event capacity: {Object.values(divisionCapacities).reduce((sum, value) => sum + (Number(value) || 0), 0)}</p>}
        </section>
        <section className="space-y-3 rounded-lg border border-white/10 p-4">
          <div><h2 className="font-display font-semibold text-white">Payment options</h2><p className="text-xs text-white/50">Choose how players can pay the organizer.</p></div>
          <div className="flex flex-wrap gap-5">
            <label className="flex items-center gap-2 text-sm text-white/75"><input type="checkbox" checked={paymentMethods.includes("QR")} onChange={(event) => setPaymentMethods((current) => event.target.checked ? [...current, "QR"] : current.filter((method) => method !== "QR"))} />QR / e-wallet</label>
            <label className="flex items-center gap-2 text-sm text-white/75"><input type="checkbox" checked={paymentMethods.includes("IN_PERSON")} onChange={(event) => setPaymentMethods((current) => event.target.checked ? [...current, "IN_PERSON"] : current.filter((method) => method !== "IN_PERSON"))} />Pay in person</label>
          </div>
          {paymentMethods.includes("QR") && <div className="space-y-2">
            <label htmlFor="payment-qr-file" className="block text-xs text-white/60">Payment QR image</label>
            <input id="payment-qr-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPaymentQrFile(event.target.files?.[0] ?? null)} className="text-sm text-white/70" />
            {paymentQrFile && <p className="text-xs text-white/50">Selected: {paymentQrFile.name}</p>}
            {existingQrUrl && !paymentQrRemoved && <div className="flex items-center gap-3"><img src={fileUrl(existingQrUrl)} alt="Current event payment QR" className="h-28 w-28 rounded-lg bg-white object-contain p-1" /><button type="button" onClick={() => setPaymentQrRemoved(true)} className="text-sm text-advance">Remove current QR</button></div>}
          </div>}
        </section>
        {!isEditing && <div>
          <label className="block text-sm text-white/70 mb-1">Existing tournament (optional)</label>
          <select className={inputClass} value={tournamentId} onChange={(e) => setTournamentId(e.target.value)}>
            <option value="">Create a new event tournament</option>
            {tournaments.map((tournament) => <option key={tournament.id} value={tournament.id}>{tournament.name}</option>)}
          </select>
        </div>}
        {!isEditing && !tournamentId && <div>
          <label className="block text-sm text-white/70 mb-1">Event format</label>
          <select className={inputClass} value={tournamentType} onChange={(e) => setTournamentType(e.target.value as typeof tournamentType)}>
            <option value="RANDOM_PAIRING">Open play / random pairing</option>
            <option value="FIXED_BRACKET">Fixed bracket tournament</option>
          </select>
        </div>}
        <div>
          <label className="block text-sm text-white/70 mb-1">External registration link (optional)</label>
          <input
            className={inputClass}
            placeholder="https://…"
            value={registrationLink}
            onChange={(e) => setRegistrationLink(e.target.value)}
          />
        </div>

        <div className="rounded-lg border border-white/10 p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-display font-semibold text-white">In-app registration form (optional)</h3>
            <button type="button" onClick={addField} className="text-sm text-ball hover:underline">
              + Add field
            </button>
          </div>
          <p className="text-xs text-white/50 mb-3">
            Add fields to let players register right here, in addition to (or instead of) an external link.
          </p>
          {fields.map((f, i) => (
            <div key={i} className="flex items-center gap-2 mb-2">
              <input
                className={`${inputClass} flex-1`}
                placeholder="Field label, e.g. Team name"
                value={f.label}
                onChange={(e) => updateField(i, { label: e.target.value })}
              />
              <select
                className="rounded-lg bg-white/10 border border-white/20 px-2 py-2 text-white text-sm"
                value={f.type}
                onChange={(e) => updateField(i, { type: e.target.value as RegistrationFieldType })}
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-xs text-white/60 whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={!!f.required}
                  onChange={(e) => updateField(i, { required: e.target.checked })}
                />
                required
              </label>
              <button type="button" onClick={() => removeField(i)} className="text-advance text-sm">
                ✕
              </button>
            </div>
          ))}
        </div>

        <div>
          <label className="block text-sm text-white/70 mb-1">Photos</label>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setPhotos(e.target.files)}
            className="text-sm text-white/70"
          />
          <p className="text-xs text-white/40 mt-1">
            Up to 8 photos. Tournament photos are automatically deleted 14 days after upload.
          </p>
        </div>

        {error && <p className="text-sm text-advance">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-ball text-neutral-900 font-display font-semibold px-6 py-2 disabled:opacity-50"
        >
          {submitting ? (isEditing ? "Saving…" : "Publishing…") : isEditing ? "Save changes" : "Publish event"}
        </button>
      </form>}
    </div>
  );
}

function toLocalDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
