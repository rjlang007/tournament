# Dink Board — Pickleball Tournament System (Simplified)

A focused tournament management system for a single venue, with administrator
accounts, player accounts, community features, live matchmaking, and results.

- **Admin/staff side** (Registration, Court Control, Tournament Setup, Bracket):
  requires an authenticated administrator account. Admins manage their own
  tournaments; superadmins can manage all tournaments.
- **Player/customer side** (Kiosk, Leaderboard): read-only public views. Anyone
  can look at who's playing next, who's currently on court, final results, and
  the leaderboard. Players need an account only when joining a tournament.

## What it does
- Player registration with skill levels (Beginner / Average / Advance)
- Random-pairing matchmaking that enforces the skill rule (Advance↔Beginner, Average↔Average, Average↔Beginner)
- "Bunot-bunot" / spin-the-wheel draw animation for random pairings
- Fixed-bracket (single-elimination) tournaments for pre-registered pairs
- Per-court enable/disable, supports 2+ courts
- Staff court control: manual Start / Pause / Resume / Finish + editable game timer
- Live kiosk display (Now Playing / Up Next / Waiting pool) via Socket.IO — this is the public "who's playing next / who's winning" screen
- Leaderboard ranked by wins, loss-game points, total points, and point differential, with games-played count and live updates
- Open-play tournament finalization with shared placements for exact ties and arrival-aware matchmaking
- Congratulatory final-results page with PNG and JPEG downloads for everyone
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
| Tournament Setup / Registration | Admin | Yes |
| Court Control | Admin/staff | Yes |
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

## Production notes
- Keep `JWT_SECRET`, `DATABASE_URL`, and `CORS_ORIGIN` configured in the deployment
  environment. Do not use the sample Docker Compose database password publicly.
- Back up PostgreSQL and test restoring a backup before running a major event.
- Scheduled finalization waits until queued and active games are finished or
  cancelled, so late scores are not omitted from official standings.
- The finalizer detects podium ties and supports either a tiebreak game or manual
  ordering. Tiebreak games split the selected players into teams as evenly as possible.
- Uploaded files need a persistent Railway volume or external object storage.
