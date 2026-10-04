import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
};

export default function Notifications() {
  const [notifications, setNotifications] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  useEffect(() => {
    api.get<NotificationItem[]>("/notifications")
      .then(({ data }) => setNotifications(data))
      .catch((err) => setError(err?.response?.data?.error || "Couldn't load notifications."));
  }, []);

  async function markRead(notification: NotificationItem) {
    if (notification.readAt) return;
    await api.patch(`/notifications/${notification.id}/read`);
    setNotifications((rows) => rows?.map((item) => item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item) ?? null);
  }

  async function markAllRead() {
    setMarkingAll(true);
    try {
      await api.patch("/notifications/read-all");
      const readAt = new Date().toISOString();
      setNotifications((rows) => rows?.map((item) => ({ ...item, readAt: item.readAt ?? readAt })) ?? null);
    } finally {
      setMarkingAll(false);
    }
  }

  const unreadCount = notifications?.filter((item) => !item.readAt).length ?? 0;

  return (
    <main>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Notifications</h1>
          <p className="mt-1 text-sm text-white/50">{unreadCount} unread</p>
        </div>
        {unreadCount > 0 && <button type="button" onClick={markAllRead} disabled={markingAll} className="rounded-lg border border-white/15 px-3 py-2 text-sm text-white/70 hover:bg-white/5 disabled:opacity-50">{markingAll ? "Marking…" : "Mark all read"}</button>}
      </div>

      {error && <p className="text-sm text-advance">{error}</p>}
      {notifications === null && !error && <p className="text-sm text-white/50">Loading notifications…</p>}
      {notifications?.length === 0 && <p className="border-y border-white/10 py-6 text-sm text-white/50">You’re all caught up.</p>}

      {notifications && notifications.length > 0 && <div className="divide-y divide-white/10 border-y border-white/10">
        {notifications.map((notification) => <article key={notification.id} className={`flex flex-wrap items-start justify-between gap-3 py-4 ${notification.readAt ? "" : "bg-white/[0.025]"}`}>
          <div className="flex min-w-0 gap-3">
            <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${notification.readAt ? "bg-white/15" : "bg-ball"}`} />
            <div className="min-w-0">
              <h2 className="font-display font-semibold text-white">{notification.title}</h2>
              <p className="mt-1 text-sm text-white/65">{notification.message}</p>
              <time className="mt-2 block text-xs text-white/35" dateTime={notification.createdAt}>{new Date(notification.createdAt).toLocaleString()}</time>
            </div>
          </div>
          <div className="ml-5 flex shrink-0 gap-3 text-sm">
            {notification.actionUrl && <Link to={notification.actionUrl} onClick={() => void markRead(notification)} className="text-ball hover:underline">Open event</Link>}
            {!notification.readAt && !notification.actionUrl && <button type="button" onClick={() => void markRead(notification)} className="text-white/50 hover:text-white">Mark read</button>}
          </div>
        </article>)}
      </div>}
    </main>
  );
}
