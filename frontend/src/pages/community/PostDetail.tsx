import { useEffect, useState, FormEvent } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { api, fileUrl, PostDetail as PostDetailType } from "../../lib/api";

export default function PostDetail() {
  const { postId } = useParams();
  const navigate = useNavigate();
  const [post, setPost] = useState<PostDetailType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [registering, setRegistering] = useState(false);
  const [registerMsg, setRegisterMsg] = useState<string | null>(null);
  const [morePhotos, setMorePhotos] = useState<FileList | null>(null);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);

  function load() {
    if (!postId) return;
    api
      .get<PostDetailType>(`/posts/${postId}`)
      .then(({ data }) => {
        setPost(data);
        if (data.myRegistration?.answers) setAnswers(data.myRegistration.answers);
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
      await api.post(`/posts/${postId}/register`, { answers });
      setRegisterMsg("You're registered!");
      load();
    } catch (err: any) {
      setRegisterMsg(err?.response?.data?.error || "Couldn't register. Please try again.");
    } finally {
      setRegistering(false);
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

  return (
    <div className="max-w-2xl">
      <Link to="/community" className="text-sm text-white/50 hover:text-white">
        ← Back to tournaments
      </Link>

      <div className="flex items-start justify-between mt-3">
        <h1 className="font-display text-3xl font-bold text-white">{post.title}</h1>
        {post.isOwner && (
          <button onClick={onDelete} className="text-sm text-advance hover:underline">
            Delete post
          </button>
        )}
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
        {post.amount && (
          <p className="text-white/80">
            <span className="text-white/50">💰 Entry / prize:</span> {post.amount}
          </p>
        )}
        <p className="text-white/80">
          <span className="text-white/50">👥 Registered:</span> {post.registrationCount}
        </p>
      </div>

      <p className="text-white/80 whitespace-pre-wrap mb-4">{post.description}</p>
      {post.details && (
        <>
          <h3 className="font-display font-semibold text-white mb-1">Details</h3>
          <p className="text-white/70 whitespace-pre-wrap mb-4">{post.details}</p>
        </>
      )}

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

      {post.registrationFields.length > 0 && (
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
              disabled={registering}
              className="rounded-lg bg-ball text-neutral-900 font-display font-semibold px-4 py-2 disabled:opacity-50"
            >
              {post.myRegistration ? "Update registration" : registering ? "Registering…" : "Register"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
