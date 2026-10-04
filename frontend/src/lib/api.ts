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
  playerStats?: PlayerLeaderboardRow;
  visitors?: ProfileVisitor[];
  matchHistory?: PlayerMatchHistory[];
};

export type ProfileVisitor = {
  id: string | null;
  username: string | null;
  avatarUrl: string | null;
  anonymous: boolean;
  visitedAt: string;
};

export type PlayerMatchHistory = {
  id: string;
  tournamentName: string;
  tournamentType: "RANDOM_PAIRING" | "FIXED_BRACKET";
  playedAt: string;
  result: "WIN" | "LOSS";
  ownScore: number | null;
  opponentScore: number | null;
  teammates: string[];
  opponents: string[];
};

export type PlayerLeaderboardRow = {
  userId: string;
  username: string;
  avatarUrl: string | null;
  openPlayPoints: number;
  tournamentPoints: number;
  overallPoints: number;
  wins: number;
  losses: number;
  gamesPlayed: number;
  winRate: number;
  podiums: number;
  eventsPlayed: number;
  championships: number;
  rankTier: string;
  badges: string[];
};

export type GlobalLeaderboards = {
  selectedSeason: number | null;
  seasons: number[];
  openPlay: PlayerLeaderboardRow[];
  tournaments: PlayerLeaderboardRow[];
  overall: PlayerLeaderboardRow[];
};

export type RegistrationFieldType = "text" | "textarea" | "number" | "email" | "phone";

export type RegistrationField = {
  label: string;
  type: RegistrationFieldType;
  required?: boolean;
};

export type EventDivisionName = "BEGINNER" | "NOVICE" | "LOW_INTERMEDIATE" | "HIGH_INTERMEDIATE";
export type EventDivision = { name: EventDivisionName; capacity: number; registered: number };
export type EventPaymentMethod = "QR" | "IN_PERSON";

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
  capacity?: number | null;
  divisions?: EventDivision[];
  paymentMethods?: EventPaymentMethod[];
  paymentQrUrl?: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  locationAddress?: string | null;
  locationLatitude?: number | null;
  locationLongitude?: number | null;
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
  paymentInstructions?: string | null;
  location: string;
  amount?: string | null;
  capacity?: number | null;
  divisions: EventDivision[];
  paymentMethods: EventPaymentMethod[];
  paymentQrUrl?: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  locationAddress?: string | null;
  locationLatitude?: number | null;
  locationLongitude?: number | null;
  registrationLink?: string | null;
  registrationFields: RegistrationField[];
  createdAt: string;
  host: PostHost;
  isOwner: boolean;
  photos: { id: string; url: string; uploadedAt: string }[];
  participants: {
    id: string;
    name: string;
    status: "PENDING" | "APPROVED" | "INVITED" | "RESERVED";
    division?: string | null;
    isPlusOne: boolean;
    addedBy: string | null;
  }[];
  registrationCount: number;
  myRegistration?: {
    id: string;
    answers: Record<string, string>;
    submittedAt: string;
    status: "PENDING" | "APPROVED" | "REJECTED" | "INVITED" | "RESERVED";
    applicantName: string;
    skillLevel: SkillLevel;
    hasPaymentProof: boolean;
    division?: EventDivisionName | null;
    paymentMethod?: EventPaymentMethod | null;
  } | null;
  tournamentId?: string | null;
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
  scoreA?: number | null;
  scoreB?: number | null;
  finishedAt?: string | null;
  resultHistory?: GameResultRevision[];
  isTiebreaker?: boolean;
};

export type GameResultRevision = {
  id: string;
  winningTeam: "A" | "B";
  scoreA: number;
  scoreB: number;
  reason?: string | null;
  createdAt: string;
  actor?: { username: string } | null;
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