import { useEffect, useState, FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import type { PostDetail, RegistrationField, RegistrationFieldType, Tournament } from "../../lib/api";

const FIELD_TYPES: RegistrationFieldType[] = ["text", "textarea", "number", "email", "phone"];

export default function CreatePost() {
  const navigate = useNavigate();
  const { postId } = useParams();
  const isEditing = !!postId;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [details, setDetails] = useState("");
  const [paymentInstructions, setPaymentInstructions] = useState("");
  const [location, setLocation] = useState("");
  const [amount, setAmount] = useState("");
  const [capacity, setCapacity] = useState("");
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
        setAmount(data.amount ?? "");
        setCapacity(data.capacity?.toString() ?? "");
        setScheduledStart(toLocalDateTime(data.scheduledStart));
        setScheduledEnd(toLocalDateTime(data.scheduledEnd));
        setRegistrationLink(data.registrationLink ?? "");
        setFields(data.registrationFields);
        setTournamentId(data.tournamentId ?? "");
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
    setSubmitting(true);
    try {
      const cleanFields = fields.filter((f) => f.label.trim().length > 0);
      const payload = {
        title,
        description,
        details: isEditing ? details || null : details || undefined,
        paymentInstructions: isEditing ? paymentInstructions || null : paymentInstructions || undefined,
        location,
        amount: isEditing ? amount : amount || undefined,
        capacity: isEditing ? capacity ? Number(capacity) : null : capacity ? Number(capacity) : undefined,
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
            <label className="block text-sm text-white/70 mb-1">Location</label>
            <input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} required />
          </div>
          <div>
            <label className="block text-sm text-white/70 mb-1">Entry fee or prize (optional)</label>
            <input
              className={inputClass}
              placeholder="e.g. 20 per player or Free"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm text-white/70 mb-1">Player capacity (optional)</label>
            <input className={inputClass} type="number" min="1" max="1000" step="1" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </div>
        </div>
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
