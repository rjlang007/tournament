import axios from "axios";

export const API_URL = import.meta.env.VITE_API_URL || window.location.origin;

export const api = axios.create({
  baseURL: `${API_URL}/api`,
  withCredentials: true,
});

export function fileUrl(path: string | null | undefined): string {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_URL}${path}`;
}

export type SkillLevel = "BEGINNER" | "AVERAGE" | "ADVANCE";

export type PublicProfile = {
  id: string;
  username: string;
  bio: string;
  avatarUrl: string;
  role: "SUPERADMIN" | "ADMIN" | "PLAYER";
  trialStartedAt?: string | null;
  subscriptionExpiresAt?: string | null;
  subscriptionStatus?: "TRIAL" | "ACTIVE" | "EXPIRED" | "SUSPENDED" | null;
  createdAt?: string | Date;
  memberSince?: string | Date;
};

export type RegistrationFieldType = "text" | "textarea" | "number" | "email" | "phone";

export type RegistrationField = {
  label: string;
  type: RegistrationFieldType;
  required?: boolean;
};

export type PostHost = {
  id: string;
  username: string;
  avatarUrl: string;
};

export type PostSummary = {
  id: string;
  title: string;
  description: string;
  location: string;
  amount?: string | null;
  createdAt: string;
  host: PostHost;
  photos: string[];
  registrationCount: number;
};

export type PostDetail = {
  photoPolicyNote: string;
  id: string;
  title: string;
  description: string;
  details?: string | null;
  location: string;
  amount?: string | null;
  registrationLink?: string | null;
  registrationFields: RegistrationField[];
  createdAt: string;
  host: PostHost;
  isOwner: boolean;
  photos: { id: string; url: string; uploadedAt: string }[];
  registrationCount: number;
  myRegistration?: {
    answers: Record<string, string>;
    submittedAt: string;
  } | null;
};

export type Player = {
  id: string;
  name: string;
  contact?: string | null;
  skillLevel: SkillLevel;
  status: string;
  tournamentId: string;
  joinStatus?: "PENDING" | "APPROVED" | "REJECTED";
  arrivalAt?: string;
  gamesPlayed?: number;
};

export type Court = {
  id: string;
  label: string;
  isEnabled: boolean;
  tournamentId: string;
  games?: Game[];
};

export type GamePlayer = { id: string; team: "A" | "B"; player: Player };

export type Game = {
  id: string;
  status: "UPCOMING" | "READY" | "IN_PROGRESS" | "PAUSED" | "FINISHED" | "CANCELLED";
  courtId?: string | null;
  court?: Court | null;
  durationSeconds: number;
  remainingSeconds: number;
  players: GamePlayer[];
  winningTeam?: "A" | "B" | null;
  isTiebreaker?: boolean;
};

export type Tournament = {
  id: string;
  name: string;
  type: "RANDOM_PAIRING" | "FIXED_BRACKET";
  status: "SETUP" | "ACTIVE" | "COMPLETED";
  ownerId?: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  locationName?: string | null;
  locationAddress?: string | null;
  locationLatitude?: number | null;
  locationLongitude?: number | null;
  resultsFinalizedAt?: string | null;
  myMembership?: { joinStatus: "PENDING" | "APPROVED" | "REJECTED"; status: string } | null;
};

export type LeaderboardRow = {
  playerId: string;
  name: string;
  skillLevel: SkillLevel;
  wins: number;
  losses: number;
  gamesPlayed: number;
  winPct: number;
  pointDiff: number;
  pointsFor: number;
  pointsAgainst: number;
  lossPoints: number;
};

export type TieGroup = {
  rank: number;
  rows: LeaderboardRow[];
};

export type FinalizeCheck = {
  standings: LeaderboardRow[];
  ties: TieGroup[];
  unfinishedGames: number;
};

export type RaffleDraw = {
  id: string;
  prizeDescription: string;
  winnerName: string;
  participantNames: string[];
  createdAt: string;
};

export type RaffleResponse = {
  participants: { id: string; name: string }[];
  latestDraw: RaffleDraw | null;
};