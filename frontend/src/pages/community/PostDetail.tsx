import { useEffect, useState, FormEvent } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { API_URL, api, fileUrl, PostDetail as PostDetailType } from "../../lib/api";
import type { EventDivisionName, EventPaymentMethod, SkillLevel } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import TournamentLocationMap from "../../components/TournamentLocationMap";

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
  const [division, setDivision] = useState<EventDivisionName | "">("");
  const [paymentMethod, setPaymentMethod] = useState<EventPaymentMethod>("IN_PERSON");
  const [contact, setContact] = useState("");
  const [skillLevel, setSkillLevel] = useState<SkillLevel>("BEGINNER");
  const [participantMode, setParticipantMode] = useState<"self" | "account" | "manual">("self");
  const [playerSearch, setPlayerSearch] = useState("");
  const [matchingPlayers, setMatchingPlayers] = useState<{ id: string; username: string }[]>([]);
  const [participantUserId, setParticipantUserId] = useState("");
  const [paymentProof, setPaymentProof] = useState<File | null>(null);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [withdrawing, setWithdrawing] = useState(false);
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [payoutAccountConfigured, setPayoutAccountConfigured] = useState(false);
  const [payoutAccount, setPayoutAccount] = useState({ number: "", name: "", bic: "" });
  const [payoutAccountMessage, setPayoutAccountMessage] = useState("");

  function load() {
    if (!postId) return;
    api
      .get<PostDetailType>(`/posts/${postId}`)
      .then(({ data }) => {
        setPost(data);
        if (data.myRegistration?.answers) setAnswers(data.myRegistration.answers);
        if (data.myRegistration) {
          setApplicantName(data.myRegistration.applicantName);
        }
        setDivision(data.myRegistration?.division ?? data.divisions[0]?.name ?? "");
        setPaymentMethod(data.myRegistration?.paymentMethod ?? data.paymentMethods[0] ?? "IN_PERSON");
        if (data.isOwner) {
          api.get(`/posts/${postId}/submissions`).then(({ data: rows }) => setSubmissions(rows));
          api.get<{ configured: boolean }>("/payments/payout-account").then(({ data: account }) => setPayoutAccountConfigured(account.configured));
        }
      })
      .catch((err) => setError(err?.response?.data?.error || "Couldn't load this tournament."));
  }

  useEffect(load, [postId]);

  useEffect(() => {
    if (!postId || !user || participantMode !== "account" || playerSearch.trim().length < 2) {
      setMatchingPlayers([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      api.get<{ id: string; username: string }[]>(`/posts/${postId}/player-search`, { params: { query: playerSearch } })
        .then(({ data }) => active && setMatchingPlayers(data))
        .catch(() => active && setMatchingPlayers([]));
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [postId, user, participantMode, playerSearch]);

  async function onRegister(e: FormEvent) {
    e.preventDefault();
    if (!postId) return;
    setRegistering(true);
    setRegisterMsg(null);
    try {
      const participant = participantMode === "self" ? user?.id : participantMode === "account" ? participantUserId : null;
      if (participantMode === "account" && !participantUserId) throw new Error("Select a player account from the search results.");
      const { data: registration } = await api.post<{ id: string; status: string }>(`/posts/${postId}/register`, {
        answers,
        applicantName,
        contact,
        division,
        paymentMethod,
        skillLevel,
        participantUserId: participant,
      });
      if (paymentProof) {
        const form = new FormData();
        form.append("proof", paymentProof);
        form.append("submissionId", registration.id);
        await api.post(`/posts/${postId}/register/payment-proof`, form, { headers: { "Content-Type": "multipart/form-data" } });
      }
      if (paymentMethod === "PAYMONGO" && registration.status !== "INVITED") {
        await startCheckout(registration.id);
        return;
      }
      setRegisterMsg(registration.status === "INVITED" ? "Invitation sent. The selected player must accept it before payment and organizer review." : "Registration submitted. Complete payment to secure your request.");
      setApplicantName("");
      setContact("");
      setParticipantUserId("");
      setPlayerSearch("");
      load();
    } catch (err: any) {
      setRegisterMsg(err?.response?.data?.error || err.message || "Couldn't register. Please try again.");
    } finally {
      setRegistering(false);
    }
  }

  async function startCheckout(submissionId: string) {
    setStartingCheckout(true);
    setRegisterMsg(null);
    try {
      const { data } = await api.post<{ checkoutUrl: string }>(`/payments/events/${submissionId}/checkout`);
      window.location.assign(data.checkoutUrl);
    } catch (err: any) {
      setRegisterMsg(err?.response?.data?.error || "Could not start online checkout. Try again.");
    } finally {
      setStartingCheckout(false);
    }
  }

  async function reviewSubmission(id: string, status: "APPROVED" | "REJECTED" | "RESERVED" | "PENDING") {
    await api.patch(`/posts/${postId}/submissions/${id}`, { status });
    setSubmissions((rows) => rows.map((row) => row.id === id ? { ...row, status } : row));
    load();
  }

  async function verifyPayment(submission: any) {
    const method = submission.paymentMethod === "IN_PERSON" ? "in-person payment" : "uploaded payment proof";
    if (!confirm(`Confirm that you received and verified this ${method}?`)) return;
    await api.patch(`/posts/${postId}/submissions/${submission.id}/verify-payment`);
    setSubmissions((rows) => rows.map((row) => row.id === submission.id ? { ...row, paymentStatus: "VERIFIED" } : row));
    load();
  }

  async function acceptInvitation() {
    if (!postId || !post?.myRegistration) return;
    await api.post(`/posts/${postId}/register/${post.myRegistration.id}/accept`);
    if (post.myRegistration.paymentMethod === "PAYMONGO") {
      await startCheckout(post.myRegistration.id);
      return;
    }
    load();
  }

  async function savePayoutAccount(event: FormEvent) {
    event.preventDefault();
    setPayoutAccountMessage("");
    try {
      await api.put("/payments/payout-account", payoutAccount);
      setPayoutAccountConfigured(true);
      setPayoutAccount({ number: "", name: "", bic: "" });
      setPayoutAccountMessage("Encrypted payout details saved. For security, the saved account number is not displayed.");
    } catch (err: any) {
      setPayoutAccountMessage(err?.response?.data?.error || "Could not save payout details.");
    }
  }

  async function withdrawRequest() {
    if (!postId || !post) return;
    setWithdrawing(true);
    try {
      await api.delete(`/posts/${postId}/register`);
      setPost({ ...post, myRegistration: null, registrationCount: Math.max(0, post.registrationCount - 1) });
      setRegisterMsg("Your request was withdrawn.");
      load();
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
  const existingActiveRequest = ["PENDING", "APPROVED", "INVITED", "RESERVED"].includes(post.myRegistration?.status ?? "");
  const isExistingSelf = participantMode === "self" && existingActiveRequest;
  const eventFull = post.capacity != null && post.registrationCount - (isExistingSelf ? 1 : 0) >= post.capacity;
  const selectedDivision = post.divisions.find((item) => item.name === division);
  const divisionOwnRequest = isExistingSelf && post.myRegistration?.division === division;
  const divisionFull = !!selectedDivision && selectedDivision.registered - (divisionOwnRequest ? 1 : 0) >= selectedDivision.capacity;
  const participantGroups = [
    { title: "Joined / approved", players: post.participants.filter((participant) => participant.status === "APPROVED") },
    { title: "Waitlist", players: post.participants.filter((participant) => participant.status === "PENDING" && !participant.isPlusOne) },
    { title: "Invited / +1", players: post.participants.filter((participant) => participant.status === "INVITED" || (participant.isPlusOne && participant.status !== "APPROVED" && participant.status !== "RESERVED")) },
    { title: "Reserved", players: post.participants.filter((participant) => participant.status === "RESERVED") },
  ];

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
        {post.locationAddress && <p className="text-white/80"><span className="text-white/50">Address:</span> {post.locationAddress}</p>}
        {post.scheduledStart && <p className="text-white/80"><span className="text-white/50">🗓 Starts:</span> {new Date(post.scheduledStart).toLocaleString()}</p>}
        {post.scheduledEnd && <p className="text-white/80"><span className="text-white/50">Ends:</span> {new Date(post.scheduledEnd).toLocaleString()}</p>}
        {post.amount && (
          <p className="text-white/80">
            <span className="text-white/50">💰 Entry / prize:</span> {post.amount}
          </p>
        )}
        {post.entryFeeCents != null && post.entryFeeCents > 0 && <p className="text-white/80"><span className="text-white/50">🎟 Entry fee:</span> ₱{(post.entryFeeCents / 100).toFixed(2)} per registration</p>}
        <p className="text-white/80">
          <span className="text-white/50">👥 Registered:</span> {post.registrationCount}
        </p>
        {post.capacity != null && <p className="text-white/80"><span className="text-white/50">Open spots:</span> {Math.max(0, post.capacity - post.registrationCount)}</p>}
        {post.divisions.length > 0 && <div className="border-t border-white/10 pt-2"><p className="mb-1 text-white/50">Player divisions</p><div className="grid gap-1 sm:grid-cols-2">{post.divisions.map((item) => <p key={item.name} className="text-white/75">{divisionLabel(item.name)}: {item.registered}/{item.capacity} players</p>)}</div></div>}
        <p className="text-white/80"><span className="text-white/50">Payment options:</span> {post.paymentMethods.map((method) => method === "PAYMONGO" ? "Secure Playwell checkout" : method === "QR" ? "QR / e-wallet" : "Pay in person").join(" · ")}</p>
      </div>

      <section className="mb-6 space-y-4">
        {participantGroups.map((group) => <div key={group.title}>
          <h3 className="mb-1 font-display font-semibold text-white">{group.title} <span className="text-sm font-normal text-white/40">{group.players.length}</span></h3>
          <div className="divide-y divide-white/10 border-y border-white/10">
            {group.players.length === 0 ? <p className="py-2 text-xs text-white/35">No players</p> : group.players.map((participant) => <div key={participant.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <span className="text-white">{participant.name}</span>
              {participant.isPlusOne && <span className="text-xs text-ball">+1</span>}
              {participant.division && <span className="text-xs text-white/45">{divisionLabel(participant.division)}</span>}
              <span className={`text-xs ${participant.status === "APPROVED" ? "text-emerald-300" : participant.status === "INVITED" ? "text-ball" : participant.status === "RESERVED" ? "text-sky-300" : "text-white/50"}`}>{registrationStatusLabel(participant.status)}</span>
              {participant.addedBy && <span className="ml-auto text-xs text-white/40">Added by @{participant.addedBy}</span>}
            </div>)}
          </div>
        </div>)}
      </section>

      {post.locationLatitude != null && post.locationLongitude != null && <section className="mb-5 space-y-2"><h3 className="font-display font-semibold text-white">Venue map</h3><div className="overflow-hidden rounded-lg border border-white/10"><TournamentLocationMap latitude={post.locationLatitude} longitude={post.locationLongitude} /></div></section>}

      <p className="text-white/80 whitespace-pre-wrap mb-4">{post.description}</p>
      {post.details && (
        <>
          <h3 className="font-display font-semibold text-white mb-1">Details</h3>
          <p className="text-white/70 whitespace-pre-wrap mb-4">{post.details}</p>
        </>
      )}
      {post.paymentInstructions && <div className="mb-6"><h3 className="font-display font-semibold text-white mb-1">Payment instructions</h3><p className="text-white/70 whitespace-pre-wrap">{post.paymentInstructions}</p></div>}
      {post.isOwner && post.entryFeeCents != null && post.entryFeeCents > 0 && post.paymentMethods.includes("PAYMONGO") && <form onSubmit={savePayoutAccount} className="mb-6 space-y-3 rounded-xl border border-white/10 p-4">
        <h3 className="font-display font-semibold text-white">Organizer payout account</h3>
        <p className="text-xs text-white/50">{payoutAccountConfigured ? "A payout account is saved securely. Enter new details only if you want to replace it." : "Save your bank account details before payouts can be issued. Details are encrypted and never shown back."}</p>
        <input className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white" placeholder="Account holder name" value={payoutAccount.name} onChange={(event) => setPayoutAccount({ ...payoutAccount, name: event.target.value })} required />
        <input className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white" placeholder="Bank account number" value={payoutAccount.number} onChange={(event) => setPayoutAccount({ ...payoutAccount, number: event.target.value })} required />
        <input className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white" placeholder="Bank BIC (e.g. BNORPHMM)" value={payoutAccount.bic} onChange={(event) => setPayoutAccount({ ...payoutAccount, bic: event.target.value.toUpperCase() })} required />
        {payoutAccountMessage && <p className="text-xs text-ball">{payoutAccountMessage}</p>}
        <button className="rounded-lg border border-white/20 px-3 py-2 text-sm text-white">Save encrypted payout details</button>
      </form>}
      {post.paymentMethods.includes("QR") && post.paymentQrUrl && <div className="mb-6"><h3 className="mb-2 font-display font-semibold text-white">Scan to pay</h3><img src={fileUrl(post.paymentQrUrl)} alt={`Payment QR for ${post.title}`} className="max-h-72 w-full rounded-lg border border-white/10 bg-white object-contain p-3 sm:w-auto" /></div>}

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

      {user && post.tournamentId && <div className="mt-4 rounded-xl border border-white/10 p-4">
        {post.myRegistration?.status === "APPROVED" && <p className="mb-3 text-sm text-emerald-300">Your place is confirmed.</p>}
        {post.myRegistration?.paymentMethod === "PAYMONGO" && <div className="mb-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm">
          <p className="text-white/80">Payment status: <span className={post.myRegistration.paymentStatus === "PAID" || post.myRegistration.paymentStatus === "VERIFIED" ? "text-emerald-300" : post.myRegistration.paymentStatus === "FAILED" ? "text-advance" : "text-ball"}>{post.myRegistration.paymentStatus?.toLowerCase() ?? "pending"}</span></p>
          {["PENDING", "FAILED"].includes(post.myRegistration.paymentStatus ?? "") && <button type="button" disabled={startingCheckout} onClick={() => startCheckout(post.myRegistration!.id)} className="mt-2 rounded-lg bg-ball px-3 py-1.5 text-sm font-semibold text-neutral-900 disabled:opacity-50">{startingCheckout ? "Opening checkout…" : "Continue to secure payment"}</button>}
        </div>}
        {post.myRegistration?.status === "INVITED" && <div className="mb-4 rounded-lg border border-ball/30 bg-ball/5 p-3">
          <p className="mb-2 text-sm text-white">You have been invited to this tournament.</p>
          <button type="button" onClick={acceptInvitation} className="rounded-lg bg-ball px-3 py-1.5 text-sm font-semibold text-neutral-900">Accept invitation</button>
          <button type="button" onClick={withdrawRequest} disabled={withdrawing} className="ml-3 text-sm text-white/50 hover:text-white">Decline</button>
        </div>}
        <h3 className="font-display font-semibold text-white mb-1">Register participants</h3>
        <p className="mb-3 text-xs text-white/50">Add yourself, another player account, or a guest. Account invitations must be accepted before organizer review.</p>
        {eventFull && !existingActiveRequest && <p className="mb-3 text-sm text-advance">This event has no open spots remaining.</p>}
        <form onSubmit={onRegister} className="space-y-3">
          <label className="block text-sm text-white/70">Registering
            <select className="mt-1 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white" value={participantMode} onChange={(event) => { setParticipantMode(event.target.value as typeof participantMode); setParticipantUserId(""); setPlayerSearch(""); setApplicantName(""); }}>
              <option value="self">Myself</option>
              <option value="account">Another player account</option>
              <option value="manual">A guest without an account</option>
            </select>
          </label>
          {participantMode === "account" && <div>
            <label className="block text-sm text-white/70">Search player account<input className="mt-1 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white" placeholder="Type at least 2 username characters" value={playerSearch} onChange={(event) => { setPlayerSearch(event.target.value); setParticipantUserId(""); }} /></label>
            {matchingPlayers.length > 0 && <div className="mt-1 divide-y divide-white/10 rounded-lg border border-white/15 bg-neutral-900">{matchingPlayers.map((player) => <button key={player.id} type="button" onClick={() => { setParticipantUserId(player.id); setPlayerSearch(player.username); }} className={`block w-full px-3 py-2 text-left text-sm hover:bg-white/10 ${participantUserId === player.id ? "text-ball" : "text-white"}`}>@{player.username}</button>)}</div>}
            {playerSearch.trim().length >= 2 && matchingPlayers.length === 0 && <p className="mt-1 text-xs text-white/45">No matching player accounts.</p>}
            {participantUserId && <p className="mt-1 text-xs text-ball">Selected @{playerSearch}</p>}
          </div>}
          {post.divisions.length > 0 ? <label className="block text-sm text-white/70">Division<select className="mt-1 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white" value={division} onChange={(event) => setDivision(event.target.value as EventDivisionName)} required><option value="" disabled>Select a division</option>{post.divisions.map((item) => { const spotsLeft = item.capacity - item.registered + (participantMode === "self" && post.myRegistration?.division === item.name && existingActiveRequest ? 1 : 0); return <option key={item.name} value={item.name} disabled={spotsLeft <= 0}>{divisionLabel(item.name)} · {Math.max(0, spotsLeft)} spots left</option>; })}</select></label> : <label className="block text-sm text-white/70">Skill level<select className="mt-1 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white" value={skillLevel} onChange={(event) => setSkillLevel(event.target.value as SkillLevel)}><option value="BEGINNER">Beginner</option><option value="AVERAGE">Average</option><option value="ADVANCE">Advanced</option></select></label>}
          <input className="w-full rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-white" placeholder={participantMode === "self" ? "Your full name" : "Participant's full name"} value={applicantName} onChange={(e) => setApplicantName(e.target.value)} required />
          <input className="w-full rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-white" placeholder="Contact number" value={contact} onChange={(e) => setContact(e.target.value)} />
          {post.paymentMethods.length > 1 && <label className="block text-sm text-white/70">How will you pay?<select className="mt-1 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as EventPaymentMethod)}>{post.paymentMethods.map((method) => <option key={method} value={method}>{method === "PAYMONGO" ? "Secure Playwell checkout" : method === "QR" ? "QR / e-wallet" : "Pay in person"}</option>)}</select></label>}
          {post.paymentMethods.includes("QR") && paymentMethod === "QR" && <label className="block text-sm text-white/70">Payment receipt (optional until payment is made)<input type="file" accept="image/*" onChange={(e) => setPaymentProof(e.target.files?.[0] ?? null)} className="mt-1 block text-sm text-white/70" /></label>}
          {post.registrationFields.map((field) => <div key={field.label}><label className="mb-1 block text-sm text-white/70">{field.label}{field.required && <span className="text-advance"> *</span>}</label>{field.type === "textarea" ? <textarea className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white" value={answers[field.label] || ""} onChange={(event) => setAnswers({ ...answers, [field.label]: event.target.value })} required={field.required} /> : <input type={field.type === "number" ? "number" : field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"} className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white" value={answers[field.label] || ""} onChange={(event) => setAnswers({ ...answers, [field.label]: event.target.value })} required={field.required} />}</div>)}
          {post.myRegistration && <p className="text-xs text-white/50">Your status: {registrationStatusLabel(post.myRegistration.status)}</p>}
          {post.myRegistration?.status === "PENDING" && <button type="button" onClick={withdrawRequest} disabled={withdrawing} className="text-sm text-white/50 hover:text-white disabled:opacity-50">{withdrawing ? "Withdrawing…" : "Withdraw request"}</button>}
          {registerMsg && <p className="text-sm text-white/70">{registerMsg}</p>}
          <button type="submit" disabled={registering || (participantMode === "account" && !participantUserId) || (participantMode === "self" && existingActiveRequest) || ((eventFull || divisionFull) && !(participantMode === "self" && existingActiveRequest))} className="rounded-lg bg-ball text-neutral-900 font-display font-semibold px-4 py-2 disabled:opacity-50">{registering ? "Submitting…" : participantMode === "self" && existingActiveRequest ? "Already registered" : participantMode === "self" ? "Request a spot" : "Add participant"}</button>
        </form>
      </div>}

      {post.isOwner && post.tournamentId && <div className="mt-6 rounded-xl border border-white/10 p-4">
        <h3 className="font-display font-semibold text-white mb-3">Entry requests</h3>
        <div className="space-y-2">{submissions.map((submission) => <div key={submission.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-white/[0.03] p-3 text-sm">
          <div className="min-w-0">
            <div className="text-white">{submission.applicantName} {submission.participantUser && <span className="text-xs text-ball">for @{submission.participantUser.username}</span>} <span className="text-xs text-white/40">added by @{submission.user?.username}</span></div>
            <div className="text-xs text-white/50">{submission.division ? divisionLabel(submission.division) : submission.skillLevel} · {submission.paymentMethod === "PAYMONGO" ? "Playwell online checkout" : submission.paymentMethod === "QR" ? "QR / e-wallet" : "Pay in person"} · {registrationStatusLabel(submission.status)}{post.entryFeeCents ? ` · payment ${String(submission.paymentStatus ?? "PENDING").toLowerCase()}` : ""} · {submission.contact || "No contact provided"} · {new Date(submission.submittedAt).toLocaleString()}</div>
            {Object.entries(submission.answers ?? {}).map(([label, answer]) => <div key={label} className="mt-1 text-xs text-white/60">{label}: {String(answer)}</div>)}
            <div className="mt-1 text-xs">{submission.paymentMethod === "PAYMONGO"
              ? <span className="text-white/40">Online payment is tracked automatically.</span>
              : submission.paymentProofStoredFile
                ? <a className="text-ball" href={`${API_URL}/api/posts/${postId}/submissions/${submission.id}/payment-proof`} target="_blank" rel="noreferrer">View payment proof</a>
                : submission.paymentMethod === "QR"
                  ? <span className="text-white/40">Payment proof is required for QR payment verification.</span>
                  : <span className="text-white/40">No proof required for in-person payment; the organizer must verify it.</span>}</div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {submission.status === "PENDING" && <>
              <button disabled={post.entryFeeCents != null && post.entryFeeCents > 0 && !["PAID", "VERIFIED"].includes(submission.paymentStatus)} onClick={() => reviewSubmission(submission.id, "APPROVED")} className="secondary-button px-2 py-1 text-xs text-emerald-300 disabled:opacity-40">Approve</button>
              <button onClick={() => reviewSubmission(submission.id, "RESERVED")} className="secondary-button px-2 py-1 text-xs text-sky-300">Reserve</button>
              {!["PAID", "VERIFIED"].includes(submission.paymentStatus) && <button onClick={() => reviewSubmission(submission.id, "REJECTED")} className="secondary-button px-2 py-1 text-xs text-red-300">Reject</button>}
            </>}
            {submission.status === "RESERVED" && <>
              <button disabled={post.entryFeeCents != null && post.entryFeeCents > 0 && !["PAID", "VERIFIED"].includes(submission.paymentStatus)} onClick={() => reviewSubmission(submission.id, "APPROVED")} className="secondary-button px-2 py-1 text-xs text-emerald-300 disabled:opacity-40">Approve</button>
              <button onClick={() => reviewSubmission(submission.id, "PENDING")} className="secondary-button px-2 py-1 text-xs text-white/60">Return to waitlist</button>
              {!["PAID", "VERIFIED"].includes(submission.paymentStatus) && <button onClick={() => reviewSubmission(submission.id, "REJECTED")} className="secondary-button px-2 py-1 text-xs text-red-300">Reject</button>}
            </>}
            {post.entryFeeCents != null && post.entryFeeCents > 0 && submission.paymentMethod !== "PAYMONGO" && !["PAID", "VERIFIED"].includes(submission.paymentStatus) && <button onClick={() => verifyPayment(submission)} className="secondary-button px-2 py-1 text-xs text-ball">Verify payment</button>}
          </div>
        </div>)}</div>
      </div>}
    </div>
  );
}

function divisionLabel(name: string) {
  return name.toLowerCase().split("_").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
}

function registrationStatusLabel(status: string) {
  if (status === "PENDING") return "Waitlisted";
  if (status === "INVITED") return "Invited";
  if (status === "APPROVED") return "Approved";
  if (status === "RESERVED") return "Reserved";
  return "Declined";
}
