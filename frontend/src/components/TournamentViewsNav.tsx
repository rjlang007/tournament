import { NavLink } from "react-router-dom";

export default function TournamentViewsNav({ tournamentId }: { tournamentId: string }) {
  const views = [
    { label: "Bracket", path: "bracket" },
    { label: "Changes", path: "changes" },
    { label: "Results", path: "leaderboard" },
  ];

  return (
    <nav aria-label="Tournament views" className="mb-5 flex flex-wrap gap-2 border-b border-white/10 pb-3">
      {views.map((view) => <NavLink
        key={view.path}
        to={`/t/${tournamentId}/${view.path}`}
        className={({ isActive }) => `rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${isActive ? "bg-ball text-neutral-950" : "text-white/55 hover:bg-white/5 hover:text-white"}`}
      >{view.label}</NavLink>)}
    </nav>
  );
}
