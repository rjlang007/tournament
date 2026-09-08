# Dink Board — Pickleball Tournament System (Simplified)

A focused tournament management system for a single venue. No player accounts,
no logins, no community board — just the game and the matchmaking.

- **Admin/staff side** (Registration, Court Control, Tournament Setup, Bracket):
  open on your venue's laptop/network, no login required — you control access
  simply by not exposing those pages/URLs publicly.
- **Player/customer side** (Kiosk, Leaderboard): read-only public views. Anyone
  can look at these to see who's playing next, who's currently on court, results,
  and the leaderboard (wins, losses, games played) — no account needed.

## What it does
- Player registration with skill levels (Beginner / Average / Advance)
- Random-pairing matchmaking that enforces the skill rule (Advance↔Beginner, Average↔Average, Average↔Beginner)
- "Bunot-bunot" / spin-the-wheel draw animation for random pairings
- Fixed-bracket (single-elimination) tournaments for pre-registered pairs
- Per-court enable/disable, supports 2+ courts
- Staff court control: manual Start / Pause / Resume / Finish + editable game timer
- Live kiosk display (Now Playing / Up Next / Waiting pool) via Socket.IO — this is the public "who's playing next / who's winning" screen
- Leaderboard ranked by wins, with games-played count, for random-pairing tournaments
- Editable rosters/brackets for substitutions (player leaves, emergency, etc.)

## Stack
PostgreSQL · Node.js/Express/TypeScript · Prisma · Socket.IO · React/Vite/TypeScript · Tailwind CSS · Docker Compose

## Quick start (local, no Docker)

### 1. Database
Install PostgreSQL locally, or just run:
```bash
docker run --name pickleball-db -e POSTGRES_USER=pickleball -e POSTGRES_PASSWORD=pickleball -e POSTGRES_DB=pickleball -p 5432:5432 -d postgres:16-alpine
```

### 2. Backend
```bash
cd backend
cp .env.example .env
npm install
npx prisma migrate dev --name init
npm run dev                          # http://localhost:4000
```

### 3. Frontend
```bash
cd frontend
cp .env.example .env
npm install
npm run dev                          # http://localhost:5173
```

Open `http://localhost:5173`, create a tournament, and you're off. Open the
Kiosk tab on a second monitor/TV as the public "what's happening now" board —
that's the screen players/customers look at.

## Docker Compose
```bash
docker compose up --build
```
Backend on :4000, frontend on :5173, Postgres on :5432.

## Deploy on Railway

The root `Dockerfile` deploys the backend and the built frontend as one Railway
service. Add a PostgreSQL service to the same Railway project, then deploy this
repository as a Dockerfile service using the root directory.

Set these variables on the app service:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
NODE_ENV=production
CORS_ORIGIN=https://<your-app-domain>
```

Replace `Postgres` with the exact name of the Railway PostgreSQL service if it
has a different name. Railway runs `prisma migrate deploy` before starting the
server. The health check is `GET /health`.

Create a Railway volume mounted at `/app/backend/uploads` if uploaded avatars
and tournament photos must survive redeploys. Without that volume, the app
still works but uploaded files are ephemeral.

After deployment, open the generated app domain and confirm `/health` returns
`{"ok":true}`. The frontend, API, cookies, and Socket.IO updates all use that
same domain.

## Who sees what
| Screen | Who it's for | Needs login? |
|---|---|---|
| Tournament Setup / Registration | Admin | No — just don't share the URL |
| Court Control | Admin/staff | No — just don't share the URL |
| Bracket | Admin (edit) / anyone (view) | No |
| Kiosk (Now Playing / Up Next) | Players & customers | No |
| Leaderboard (wins, games played) | Players & customers | No |

If you want the admin pages locked down with a real login later, that's a
small, separate addition (a single admin password gate) — happy to add it
whenever you want, but it's not part of this simplified version.

## How the skill-pairing rule works
Implemented in `backend/src/lib/matchmaking.ts` (`isEligiblePair`):
- Advance ↔ Beginner — allowed
- Average ↔ Average — allowed
- Average ↔ Beginner — allowed
- Advance ↔ Advance, Advance ↔ Average, Beginner ↔ Beginner — **not allowed**

The draw (`drawEligiblePairs` / `buildDoublesGame`) shuffles the waiting pool
(Fisher-Yates) and greedily builds valid doubles games from it. Anyone who
can't be validly matched this round stays in the queue for the next draw.

## Where things live
- `backend/prisma/schema.prisma` — data model (players, courts, games, queue, brackets)
- `backend/src/lib/matchmaking.ts` — skill rule + bunot-bunot shuffle
- `backend/src/lib/queue.ts` — fills the "next 4-6 games" preview, seats free courts
- `backend/src/lib/bracket.ts` — single-elimination bracket generation + winner advancement
- `backend/src/lib/leaderboard.ts` — wins/losses/games-played standings
- `backend/src/index.ts` — server-side 1-second timer tick, broadcasts to all clients
- `frontend/src/pages/CourtControl.tsx` — staff screen (start/pause/finish, timers, draw button)
- `frontend/src/pages/Kiosk.tsx` — public read-only live board
- `frontend/src/pages/Leaderboard.tsx` — public read-only leaderboard
- `frontend/src/components/SpinWheel.tsx` — the reveal animation

## Notes / next steps you may want
- Everything is currently open on the network the app runs on — fine for a
  single venue laptop + LAN. Add a simple admin password before exposing it publicly.
- The "Finish game" flow currently uses a browser `prompt()` for entering the
  winning team — swap for a proper score-entry modal for a nicer staff UX.
- Consider adding point/score tracking per game if you want tiebreakers beyond win count.
