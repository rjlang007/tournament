import { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";

let io: SocketIOServer | null = null;

export function initSocket(httpServer: HttpServer) {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || "http://localhost:5173",
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    // Clients join a room per tournament so multiple tournaments can run
    // (or be set up) without cross-talk.
    socket.on("join-tournament", (tournamentId: string) => {
      socket.join(`tournament:${tournamentId}`);
    });
  });

  return io;
}

/** Call after any mutation that the kiosk / court-control screens care about. */
export function broadcastTournamentUpdate(tournamentId: string, event: string, payload?: unknown) {
  io?.to(`tournament:${tournamentId}`).emit(event, payload ?? {});
}

export function getIO() {
  if (!io) throw new Error("Socket.io not initialized yet");
  return io;
}
