import { useEffect, useState, FormEvent } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { API_URL, api, fileUrl, PostDetail as PostDetailType } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";

export default function PostDetail() {
  const { user } = useAuth();
  const { postId } = useParams();
  const navigate = useNavigate();
  const [post, setPost] = useState<PostDetailType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [registering, setRegistering] = useState(false);
  const [registerMsg, setRegisterMsg] = useState<string | null>(null);
  const [morePhotos, setMorePhotos] = useState<FileList | null>(null);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [applicantName, setApplicantName] = useState("");
  const [skillLevel, setSkillLevel] = useState<"BEGINNER" | "AVERAGE" | "ADVANCE">("BEGINNER");
  const [contact, setContact] = useState("");
  const [paymentProof, setPaymentProof] = useState<File | null>(null);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [withdrawing, setWithdrawing] = useState(false);

  function load() {
    if (!postId) return;
    api
      .get<PostDetailType>(`/posts/${postId}`)
      .then(({ data }) => {
        setPost(data);
        if (data.myRegistration?.answers) setAnswers(data.myRegistration.answers);
        if (data.myRegistration) {
          setApplicantName(data.myRegistration.applicantName);
          setSkillLevel(data.myRegistration.skillLevel);
        }
        if (data.isOwner) api.get(`/posts/${postId}/submissions`).then(({ data: rows }) => setSubmissions(rows));
      })
      .catch((err) => setError(err?.response?.data?.error || "Couldn't load this tournament."));
  }

  useEffect(load, [postId]);

  async function onRegister(e: FormEvent) {
    e.preventDefault();
    if (!postId) return;
    setRegistering(true);
    setRegisterMsg(null);
    try {
      await api.post(`/posts/${postId}/register`, { answers, applicantName, skillLevel, contact });
      if (paymentProof) {
        const form = new FormData();
        form.append("proof", paymentProof);
        await api.post(`/posts/${postId}/register/payment-proof`, form, { headers: { "Content-Type": "multipart/form-data" } });
      }
      setRegisterMsg("Request submitted. The tournament admin will review your payment.");
      load();
    } catch (err: any) {
      setRegisterMsg(err?.response?.data?.error || "Couldn't register. Please try again.");
    } finally {
      setRegistering(false);
    }
  }

  async function reviewSubmission(id: string, status: "APPROVED" | "REJECTED") {
    await api.patch(`/posts/${postId}/submissions/${id}`, { status });
    setSubmissions((rows) => rows.map((row) => row.id === id ? { ...row, status } : row));
  }

  async function withdrawRequest() {
    if (!postId || !post) return;
    setWithdrawing(true);
    try {
      await api.delete(`/posts/${postId}/register`);
      setPost({ ...post, myRegistration: null, registrationCount: Math.max(0, post.registrationCount - 1) });
      setRegisterMsg("Your request was withdrawn.");
    } catch (err: any) {
      setRegisterMsg(err?.response?.data?.error || "Could not withdraw your request.");
    } finally {
      setWithdrawing(false);
    }
  }

  async function onDelete() {
    if (!postId || !confirm("Delete this tournament post? This can't be undone.")) return;
    await api.delete(`/posts/${postId}`);
    navigate("/community");
  }

  async function onAddPhotos() {
    if (!postId || !morePhotos || morePhotos.length === 0) return;
    setUploadingPhotos(true);
    try {
      const form = new FormData();
      Array.from(morePhotos).forEach((file) => form.append("photos", file));
      await api.post(`/posts/${postId}/photos`, form, { headers: { "Content-Type": "multipart/form-data" } });
      setMorePhotos(null);
      load();
    } finally {
      setUploadingPhotos(false);
    }
  }

  async function onDeletePhoto(photoId: string) {
    if (!postId) return;
    await api.delete(`/posts/${postId}/photos/${photoId}`);
    load();
  }

  if (error) return <p className="text-advance">{error}</p>;
  if (!post) return <p className="text-white/60">Loading…</p>;
  const eventFull = post.capacity != null && post.registrationCount >= post.capacity;

  return (
    <div className="max-w-2xl">
      <Link to="/community" className="text-sm text-white/50 hover:text-white">
        ← Back to tournaments
      </Link>

      <div className="flex items-start justify-between mt-3">
        <h1 className="font-display text-3xl font-bold text-white">{post.title}</h1>
        {post.isOwner && <div className="flex gap-3">
          <Link to={`/community/${post.id}/edit`} className="text-sm text-ball hover:underline">Edit event</Link>
          <button onClick={onDelete} className="text-sm text-advance hover:underline">Delete post</button>
        </div>}
      </div>

      <Link to={`/community/profile/${post.host.username}`} className="flex items-center gap-2 mt-2 mb-4 w-fit">
        <img src={fileUrl(post.host.avatarUrl)} alt="" className="w-6 h-6 rounded-full object-cover" />
        <span className="text-sm text-white/60">Hosted by {post.host.username}</span>
      </Link>

      {post.photos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
          {post.photos.map((p) => (
            <div key={p.id} className="relative aspect-square rounded-lg overflow-hidden bg-black/30">
              <img src={fileUrl(p.url)} alt="" className="w-full h-full object-cover" />
              {post.isOwner && (
                <button
                  onClick={() => onDeletePhoto(p.id)}
                  className="absolute top-1 right-1 bg-black/60 text-white text-xs rounded-full w-6 h-6"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {post.isOwner && (
        <div className="mb-6 flex items-center gap-2">
          <input type="file" accept="image/*" multiple onChange={(e) => setMorePhotos(e.target.files)} className="text-sm text-white/70" />
          <button
            onClick={onAddPhotos}
            disabled={uploadingPhotos || !morePhotos}
            className="rounded-lg bg-white/10 border border-white/20 text-white text-sm px-3 py-1.5 disabled:opacity-50"
          >
            {uploadingPhotos ? "Uploading…" : "Add photos"}
          </button>
        </div>
      )}

      <p className="text-xs text-white/40 mb-4">{post.photoPolicyNote}</p>

      <div className="rounded-xl bg-white/5 border border-white/10 p-4 mb-4 space-y-2 text-sm">
        <p className="text-white/80">
          <span className="text-white/50">📍 Location:</span> {post.location}
        </p>
        {post.scheduledStart && <p className="text-white/80"><span className="text-white/50">🗓 Starts:</span> {new Date(post.scheduledStart).toLocaleString()}</p>}
        {post.scheduledEnd && <p className="text-white/80"><span className="text-white/50">Ends:</span> {new Date(post.scheduledEnd).toLocaleString()}</p>}
        {post.amount && (
          <p className="text-white/80">
            <span className="text-white/50">💰 Entry / prize:</span> {post.amount}
          </p>
        )}
        <p className="text-white/80">
          <span className="text-white/50">👥 Registered:</span> {post.registrationCount}
        </p>
        {post.capacity != null && <p className="text-white/80"><span className="text-white/50">Open spots:</span> {Math.max(0, post.capacity - post.registrationCount)}</p>}
      </div>

      <p className="text-white/80 whitespace-pre-wrap mb-4">{post.description}</p>
      {post.details && (
        <>
          <h3 className="font-display font-semibold text-white mb-1">Details</h3>
          <p className="text-white/70 whitespace-pre-wrap mb-4">{post.details}</p>
        </>
      )}
      {post.paymentInstructions && <div className="mb-6"><h3 className="font-display font-semibold text-white mb-1">Payment instructions</h3><p className="text-white/70 whitespace-pre-wrap">{post.paymentInstructions}</p></div>}

      {post.registrationLink && (
        <a
          href={post.registrationLink}
          target="_blank"
          rel="noreferrer"
          className="inline-block rounded-lg bg-ball text-neutral-900 font-display font-semibold px-4 py-2 mb-6"
        >
          Register externally ↗
        </a>
      )}

      {!user && (post.tournamentId || post.registrationFields.length > 0) && (
        <div className="mb-6 rounded-xl border border-white/10 p-4">
          <p className="mb-3 text-sm text-white/70">Create a player account or sign in to register for this event.</p>
          <div className="flex gap-3">
            <Link to="/community/register" state={{ from: `/community/${post.id}` }} className="rounded-lg bg-ball px-4 py-2 font-display font-semibold text-neutral-900">Create account</Link>
            <Link to="/community/login" state={{ from: `/community/${post.id}` }} className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white">Sign in</Link>
          </div>
        </div>
      )}

      {user && post.tournamentId && post.registrationFields.length > 0 && post.myRegistration?.status !== "APPROVED" && (
        <div className="rounded-xl border border-white/10 p-4">
          <h3 className="font-display font-semibold text-white mb-3">Register for this tournament</h3>
          <form onSubmit={onRegister} className="space-y-3">
            {post.registrationFields.map((f) => (
              <div key={f.label}>
                <label className="block text-sm text-white/70 mb-1">
                  {f.label}
                  {f.required && <span className="text-advance"> *</span>}
                </label>
                {f.type === "textarea" ? (
                  <textarea
                    className="w-full rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-white outline-none focus:border-ball"
                    value={answers[f.label] || ""}
                    onChange={(e) => setAnswers({ ...answers, [f.label]: e.target.value })}
                    required={f.required}
                  />
                ) : (
                  <input
                    type={f.type === "number" ? "number" : f.type === "email" ? "email" : f.type === "phone" ? "tel" : "text"}
                    className="w-full rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-white outline-none focus:border-ball"
                    value={answers[f.label] || ""}
                    onChange={(e) => setAnswers({ ...answers, [f.label]: e.target.value })}
                    required={f.required}
                  />
                )}
              </div>
            ))}
            {registerMsg && <p className="text-sm text-white/70">{registerMsg}</p>}
            <button
              type="submit"
              disabled={registering || (eventFull && post.myRegistration?.status !== "PENDING")}
              className="rounded-lg bg-ball text-neutral-900 font-display font-semibold px-4 py-2 disabled:opacity-50"
            >
              {post.myRegistration ? "Update registration" : registering ? "Registering…" : "Register"}
            </button>
          </form>
        </div>
      )}

      {user && post.tournamentId && <div className="mt-4 rounded-xl border border-white/10 p-4">
        {post.myRegistration?.status === "APPROVED" ? <p className="text-sm text-emerald-300">Your place is confirmed.</p> : <>
        <h3 className="font-display font-semibold text-white mb-1">Request entry</h3>
        <p className="mb-3 text-xs text-white/50">Follow the payment instructions in the event details. Upload a receipt if you paid electronically; the organizer can also verify in-person payment.</p>
        {eventFull && post.myRegistration?.status !== "PENDING" && <p className="mb-3 text-sm text-advance">This event has no open spots remaining.</p>}
        <form onSubmit={onRegister} className="space-y-3">
          <input className="w-full rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-white" placeholder="Your full name" value={applicantName} onChange={(e) => setApplicantName(e.target.value)} required />
          <div className="grid grid-cols-2 gap-3"><select className="rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-white" value={skillLevel} onChange={(e) => setSkillLevel(e.target.value as typeof skillLevel)}><option value="BEGINNER">Beginner</option><option value="AVERAGE">Average</option><option value="ADVANCE">Advanced</option></select><input className="rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-white" placeholder="Contact" value={contact} onChange={(e) => setContact(e.target.value)} /></div>
          <input type="file" accept="image/*" onChange={(e) => setPaymentProof(e.target.files?.[0] ?? null)} className="text-sm text-white/70" />
          {post.myRegistration && <p className="text-xs text-white/50">Request status: {post.myRegistration.status}</p>}
          {post.myRegistration?.status === "PENDING" && <button type="button" onClick={withdrawRequest} disabled={withdrawing} className="text-sm text-white/50 hover:text-white disabled:opacity-50">{withdrawing ? "Withdrawing…" : "Withdraw request"}</button>}
          {registerMsg && <p className="text-sm text-white/70">{registerMsg}</p>}
          <button type="submit" disabled={registering || (eventFull && post.myRegistration?.status !== "PENDING")} className="rounded-lg bg-ball text-neutral-900 font-display font-semibold px-4 py-2 disabled:opacity-50">{registering ? "Submitting…" : post.myRegistration?.status === "REJECTED" ? "Resubmit request" : post.myRegistration ? "Update request" : "Submit request"}</button>
        </form>
        </>}
      </div>}

      {post.isOwner && post.tournamentId && <div className="mt-6 rounded-xl border border-white/10 p-4"><h3 className="font-display font-semibold text-white mb-3">Entry requests</h3><div className="space-y-2">{submissions.map((submission) => <div key={submission.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-white/[0.03] p-3 text-sm"><div className="min-w-0"><div className="text-white">{submission.applicantName} <span className="text-xs text-white/40">@{submission.user?.username}</span></div><div className="text-xs text-white/50">{submission.skillLevel} · {submission.status} · {submission.contact || "No contact provided"} · {new Date(submission.submittedAt).toLocaleString()}</div>{Object.entries(submission.answers ?? {}).map(([label, answer]) => <div key={label} className="mt-1 text-xs text-white/60">{label}: {String(answer)}</div>)}<div className="mt-1 text-xs">{submission.paymentProofStoredFile ? <a className="text-ball" href={`${API_URL}/api/posts/${postId}/submissions/${submission.id}/payment-proof`} target="_blank" rel="noreferrer">View payment proof</a> : <span className="text-white/40">No proof uploaded; verify in person if applicable</span>}</div></div>{submission.status === "PENDING" && <div className="flex shrink-0 gap-2"><button onClick={() => reviewSubmission(submission.id, "APPROVED")} className="secondary-button px-2 py-1 text-xs text-emerald-300">Approve</button><button onClick={() => reviewSubmission(submission.id, "REJECTED")} className="secondary-button px-2 py-1 text-xs text-red-300">Reject</button></div>}</div>)}</div></div>}
    </div>
  );
}
