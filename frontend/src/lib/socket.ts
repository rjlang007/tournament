import { io, Socket } from "socket.io-client";
import { API_URL } from "./api";
import { useEffect, useRef } from "react";

let socket: Socket | null = null;

export function getSocket() {
  if (!socket) socket = io(API_URL);
  return socket;
}

/** Joins the tournament's room and re-runs `onEvent` for any of the given events. */
export function useTournamentSocket(tournamentId: string | undefined, events: string[], onEvent: (payload?: unknown) => void) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!tournamentId) return;
    const s = getSocket();
    let refreshTimer: number | undefined;
    const joinRoom = () => s.emit("join-tournament", tournamentId);
    const scheduleRefresh = () => {
      if (refreshTimer !== undefined) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined;
        onEventRef.current();
      }, 100);
    };

    if (s.connected) joinRoom();
    s.on("connect", joinRoom);
    events.forEach((e) => s.on(e, scheduleRefresh));
    return () => {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      s.off("connect", joinRoom);
      events.forEach((e) => s.off(e, scheduleRefresh));
    };
  }, [tournamentId, events.join(",")]);
}
