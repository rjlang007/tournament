import { io, Socket } from "socket.io-client";
import { API_URL } from "./api";
import { useEffect } from "react";

let socket: Socket | null = null;

export function getSocket() {
  if (!socket) socket = io(API_URL);
  return socket;
}

/** Joins the tournament's room and re-runs `onEvent` for any of the given events. */
export function useTournamentSocket(tournamentId: string | undefined, events: string[], onEvent: () => void) {
  useEffect(() => {
    if (!tournamentId) return;
    const s = getSocket();
    s.emit("join-tournament", tournamentId);
    events.forEach((e) => s.on(e, onEvent));
    return () => {
      events.forEach((e) => s.off(e, onEvent));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId, events.join(",")]);
}
