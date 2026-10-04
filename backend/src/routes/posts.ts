import { Router } from "express";
import path from "path";
import fs from "fs/promises";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { attachUser, requireAuth, refreshSubscriptionStatus, AuthedRequest } from "../lib/auth";
import { uploadTournamentPhotos, uploadPaymentProof, uploadPaymentQr, PAYMENT_QR_DIR, TOURNAMENT_PHOTO_DIR } from "../lib/uploads";
import { defaultAvatarUrl } from "../lib/defaultAvatars";
import { PHOTO_LIFETIME_DAYS } from "../lib/cleanup";
import { enqueuePlayer } from "../lib/queue";

export const postsRouter = Router();

async function requireAdmin(req: AuthedRequest, res: any) {
  const user = req.userId ? await prisma.user.findUnique({ where: { id: req.userId }, select: { role: true, subscriptionExpiresAt: true, subscriptionStatus: true } }) : null;
  if (!user || !["ADMIN", "SUPERADMIN"].includes(user.role)) {
    res.status(403).json({ error: "Only tournament administrators can publish or manage tournament posts." });
    return false;
  }
  if (user.role === "ADMIN") {
    const subscription = await refreshSubscriptionStatus({ id: req.userId!, role: user.role, subscriptionExpiresAt: user.subscriptionExpiresAt, subscriptionStatus: user.subscriptionStatus });
    if (subscription.subscriptionStatus === "SUSPENDED") {
      res.status(402).json({ error: "Organizer subscription expired. Renew your plan to continue.", subscriptionExpired: true, expiresAt: user.subscriptionExpiresAt });
      return false;
    }
  }
  return true;
}

const registrationFieldSchema = z.object({
  label: z.string().min(1).max(80),
  type: z.enum(["text", "textarea", "number", "email", "phone"]),
  required: z.boolean().optional().default(false),
});

const DIVISION_NAMES = ["BEGINNER", "NOVICE", "LOW_INTERMEDIATE", "HIGH_INTERMEDIATE"] as const;
const divisionSchema = z.object({
  name: z.enum(DIVISION_NAMES),
  capacity: z.number().int().min(1).max(1000),
});
const divisionsSchema = z.array(divisionSchema).max(4).superRefine((divisions, context) => {
  if (new Set(divisions.map((division) => division.name)).size !== divisions.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Each player division can only be added once." });
  }
});

const postSchema = z.object({
  title: z.string().min(1, "Title is required.").max(120),
  description: z.string().min(1, "Description is required.").max(3000),
  details: z.string().max(3000).nullable().optional(),
  paymentInstructions: z.string().max(3000).nullable().optional(),
  location: z.string().min(1, "Location is required.").max(200),
  amount: z.string().max(80).optional(),
  capacity: z.number().int().min(1).max(1000).nullable().optional(),
  divisions: divisionsSchema.default([]),
  paymentMethods: z.array(z.enum(["QR", "IN_PERSON"])).min(1).max(2).default(["IN_PERSON"]),
  locationAddress: z.string().max(300).nullable().optional(),
  locationLatitude: z.number().min(-90).max(90).nullable().optional(),
  locationLongitude: z.number().min(-180).max(180).nullable().optional(),
  scheduledStart: z.string().datetime().nullable().optional(),
  scheduledEnd: z.string().datetime().nullable().optional(),
  registrationLink: z.string().url("Registration link must be a valid URL.").max(500).optional().or(z.literal("")),
  registrationFields: z.array(registrationFieldSchema).max(20).optional(),
  tournamentId: z.string().uuid().optional(),
  tournamentType: z.enum(["RANDOM_PAIRING", "FIXED_BRACKET"]).default("RANDOM_PAIRING"),
});
const postUpdateSchema = postSchema.omit({ tournamentType: true }).partial();

function hostSummary(user: { id: string; username: string; avatarUrl: string | null; defaultAvatarKey: string }) {
  return {
    id: user.id,
    username: user.username,
    avatarUrl: user.avatarUrl ?? defaultAvatarUrl(user.defaultAvatarKey as any),
  };
}

// Every user (including the host) sees tournament photos disappear 14 days
// after upload - this note ships with every response so the frontend can
// always show it, per how the photos are actually handled server-side.
const PHOTO_POLICY_NOTE = `Tournament photos are automatically deleted ${PHOTO_LIFETIME_DAYS} days after upload. Profile pictures are not affected.`;

postsRouter.get("/", attachUser, async (_req, res) => {
  const { search, location, amount } = _req.query as { search?: string; location?: string; amount?: string };
  const posts = await prisma.tournamentPost.findMany({
    where: {
      AND: [
        {
          OR: [
            { tournamentId: null },
            { tournament: { is: { status: { not: "COMPLETED" } } } },
          ],
        },
        ...(search ? [{ OR: [{ title: { contains: search, mode: "insensitive" as const } }, { description: { contains: search, mode: "insensitive" as const } }] }] : []),
        ...(location ? [{ location: { contains: location, mode: "insensitive" as const } }] : []),
        ...(amount ? [{ amount: { contains: amount, mode: "insensitive" as const } }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    include: {
      host: true,
      photos: { orderBy: { uploadedAt: "asc" } },
      tournament: { select: { status: true, scheduledStart: true, scheduledEnd: true, locationAddress: true, locationLatitude: true, locationLongitude: true } },
    },
  });
  const registrationCounts = await prisma.registrationSubmission.groupBy({
    by: ["postId"],
    where: { postId: { in: posts.map((post) => post.id) }, status: { in: ["PENDING", "APPROVED", "INVITED", "RESERVED"] } },
    _count: { _all: true },
  });
  const countsByPost = new Map(registrationCounts.map((row) => [row.postId, row._count._all]));
  const divisionCounts = await prisma.registrationSubmission.groupBy({
    by: ["postId", "division"],
    where: { postId: { in: posts.map((post) => post.id) }, status: { in: ["PENDING", "APPROVED", "INVITED", "RESERVED"] } },
    _count: { _all: true },
  });
  const countsByDivision = new Map(divisionCounts.map((row) => [`${row.postId}:${row.division ?? ""}`, row._count._all]));

  res.json({
    photoPolicyNote: PHOTO_POLICY_NOTE,
    posts: posts.map((p: any) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      location: p.location,
      amount: p.amount,
      capacity: p.capacity,
      divisions: (Array.isArray(p.divisions) ? p.divisions : []).map((division: { name: string; capacity: number }) => ({
        ...division,
        registered: countsByDivision.get(`${p.id}:${division.name}`) ?? 0,
      })),
      paymentMethods: Array.isArray(p.paymentMethods) ? p.paymentMethods : ["IN_PERSON"],
      paymentQrUrl: p.paymentQrStoredFile ? `/uploads/payment-qrs/${p.paymentQrStoredFile}` : null,
      scheduledStart: p.tournament?.scheduledStart ?? null,
      scheduledEnd: p.tournament?.scheduledEnd ?? null,
      locationAddress: p.tournament?.locationAddress ?? null,
      locationLatitude: p.tournament?.locationLatitude ?? null,
      locationLongitude: p.tournament?.locationLongitude ?? null,
      createdAt: p.createdAt,
      host: hostSummary(p.host),
      photos: p.photos.map((ph: any) => `/api/posts/${p.id}/photos/${ph.id}/image`),
      registrationCount: countsByPost.get(p.id) ?? 0,
      tournamentId: p.tournamentId,
    })),
  });
});

postsRouter.get("/:id", attachUser, async (req: AuthedRequest, res) => {
  const post = await prisma.tournamentPost.findUnique({
    where: { id: req.params.id },
    include: {
      host: true,
      photos: { orderBy: { uploadedAt: "asc" } },
      tournament: { select: { scheduledStart: true, scheduledEnd: true, locationAddress: true, locationLatitude: true, locationLongitude: true } },
    },
  });
  if (!post) return res.status(404).json({ error: "Tournament post not found." });
  const registrationCount = await prisma.registrationSubmission.count({
    where: { postId: post.id, status: { in: ["PENDING", "APPROVED", "INVITED", "RESERVED"] } },
  });
  const divisionCounts = await prisma.registrationSubmission.groupBy({
    by: ["division"],
    where: { postId: post.id, status: { in: ["PENDING", "APPROVED", "INVITED", "RESERVED"] } },
    _count: { _all: true },
  });
  const countsByDivision = new Map(divisionCounts.map((row) => [row.division ?? "", row._count._all]));

  const mySubmission = req.userId
    ? await prisma.registrationSubmission.findUnique({
      where: { postId_participantUserId: { postId: post.id, participantUserId: req.userId } },
    })
    : null;
  const participants = await prisma.registrationSubmission.findMany({
    where: { postId: post.id, status: { in: ["PENDING", "APPROVED", "INVITED", "RESERVED"] } },
    orderBy: { submittedAt: "asc" },
    include: { user: { select: { username: true } }, participantUser: { select: { username: true } } },
  });

  res.json({
    photoPolicyNote: PHOTO_POLICY_NOTE,
    id: post.id,
    title: post.title,
    description: post.description,
    details: post.details,
    paymentInstructions: post.paymentInstructions,
    location: post.location,
    amount: post.amount,
    capacity: post.capacity,
    divisions: (Array.isArray(post.divisions) ? post.divisions as unknown as { name: string; capacity: number }[] : []).map((division) => ({
      ...division,
      registered: countsByDivision.get(division.name) ?? 0,
    })),
    paymentMethods: Array.isArray(post.paymentMethods) ? post.paymentMethods : ["IN_PERSON"],
    paymentQrUrl: post.paymentQrStoredFile ? `/uploads/payment-qrs/${post.paymentQrStoredFile}` : null,
    locationAddress: post.tournament?.locationAddress ?? null,
    locationLatitude: post.tournament?.locationLatitude ?? null,
    locationLongitude: post.tournament?.locationLongitude ?? null,
    scheduledStart: post.tournament?.scheduledStart ?? null,
    scheduledEnd: post.tournament?.scheduledEnd ?? null,
    registrationLink: post.registrationLink,
    registrationFields: post.registrationFields ?? [],
    createdAt: post.createdAt,
    host: hostSummary(post.host),
    isOwner: post.hostId === req.userId,
    photos: post.photos.map((ph: any) => ({ id: ph.id, url: `/api/posts/${post.id}/photos/${ph.id}/image`, uploadedAt: ph.uploadedAt })),
    participants: participants.map((participant) => ({
      id: participant.id,
      name: participant.applicantName,
      status: participant.status,
      division: participant.division,
      isPlusOne: participant.participantUserId === null,
      addedBy: participant.participantUserId === participant.userId ? null : participant.user.username,
    })),
    registrationCount,
    tournamentId: post.tournamentId,
    myRegistration: mySubmission ? { id: mySubmission.id, answers: mySubmission.answers, submittedAt: mySubmission.submittedAt, status: mySubmission.status, applicantName: mySubmission.applicantName, skillLevel: mySubmission.skillLevel, hasPaymentProof: !!mySubmission.paymentProofStoredFile, division: mySubmission.division, paymentMethod: mySubmission.paymentMethod } : null,
  });
});

postsRouter.post("/", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const parsed = postSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const data = parsed.data;
  const hasLatitude = typeof data.locationLatitude === "number";
  const hasLongitude = typeof data.locationLongitude === "number";
  if (hasLatitude !== hasLongitude) return res.status(400).json({ error: "Choose both map coordinates together." });
  const scheduledStart = data.scheduledStart ? new Date(data.scheduledStart) : null;
  const scheduledEnd = data.scheduledEnd ? new Date(data.scheduledEnd) : null;
  if (scheduledEnd && (!scheduledStart || scheduledEnd <= scheduledStart)) {
    return res.status(400).json({ error: "Event end time must be after its start time." });
  }
  if (data.tournamentId) {
    const tournament = await prisma.tournament.findFirst({ where: { id: data.tournamentId, ownerId: req.userId! } });
    if (!tournament) return res.status(403).json({ error: "You can only publish tournaments you own." });
  }

  const post = await prisma.$transaction(async (tx) => {
    let tournamentId = data.tournamentId;
    const capacity = data.divisions.length > 0
      ? data.divisions.reduce((total, division) => total + division.capacity, 0)
      : data.capacity;
    if (!tournamentId) {
      const tournament = await tx.tournament.create({
        data: {
          name: data.title,
          type: data.tournamentType,
          ownerId: req.userId!,
          locationName: data.location,
          locationAddress: data.locationAddress,
          locationLatitude: data.locationLatitude,
          locationLongitude: data.locationLongitude,
          scheduledStart,
          scheduledEnd,
        },
      });
      tournamentId = tournament.id;
    } else {
      await tx.tournament.update({
        where: { id: tournamentId },
        data: {
          locationName: data.location,
          locationAddress: data.locationAddress,
          locationLatitude: data.locationLatitude,
          locationLongitude: data.locationLongitude,
          scheduledStart,
          scheduledEnd,
        },
      });
    }
    return tx.tournamentPost.create({
      data: {
        hostId: req.userId!,
        title: data.title,
        description: data.description,
        details: data.details,
        paymentInstructions: data.paymentInstructions,
        location: data.location,
        amount: data.amount,
        capacity,
        divisions: data.divisions.length ? data.divisions as Prisma.InputJsonValue : Prisma.DbNull,
        paymentMethods: data.paymentMethods as Prisma.InputJsonValue,
        registrationLink: data.registrationLink || null,
        registrationFields: data.registrationFields ?? undefined,
        tournamentId,
      },
    });
  });

  res.status(201).json({ id: post.id });
});

postsRouter.patch("/:id", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const post = await prisma.tournamentPost.findUnique({ where: { id: req.params.id }, include: { tournament: true } });
  if (!post) return res.status(404).json({ error: "Tournament post not found." });
  if (post.hostId !== req.userId) return res.status(403).json({ error: "Only the host can edit this post." });

  const parsed = postUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  if (parsed.data.tournamentId) {
    const tournament = await prisma.tournament.findFirst({ where: { id: parsed.data.tournamentId, ownerId: req.userId! } });
    if (!tournament) return res.status(403).json({ error: "You can only link tournaments you own." });
  }

  const hasLatitude = parsed.data.locationLatitude === undefined ? undefined : typeof parsed.data.locationLatitude === "number";
  const hasLongitude = parsed.data.locationLongitude === undefined ? undefined : typeof parsed.data.locationLongitude === "number";
  if (hasLatitude !== undefined && hasLongitude !== undefined && hasLatitude !== hasLongitude) {
    return res.status(400).json({ error: "Choose both map coordinates together." });
  }
  const scheduledStart = parsed.data.scheduledStart === undefined ? undefined : parsed.data.scheduledStart ? new Date(parsed.data.scheduledStart) : null;
  const scheduledEnd = parsed.data.scheduledEnd === undefined ? undefined : parsed.data.scheduledEnd ? new Date(parsed.data.scheduledEnd) : null;
  const effectiveStart = scheduledStart === undefined ? post.tournament?.scheduledStart ?? null : scheduledStart;
  const effectiveEnd = scheduledEnd === undefined ? post.tournament?.scheduledEnd ?? null : scheduledEnd;
  if (effectiveEnd && (!effectiveStart || effectiveEnd <= effectiveStart)) {
    return res.status(400).json({ error: "Event end time must be after its start time." });
  }
  const divisions = parsed.data.divisions;
  const capacity = divisions === undefined
    ? parsed.data.capacity
    : divisions.length > 0 ? divisions.reduce((total, division) => total + division.capacity, 0) : null;
  const { scheduledStart: _scheduledStart, scheduledEnd: _scheduledEnd, locationAddress: _locationAddress, locationLatitude: _locationLatitude, locationLongitude: _locationLongitude, ...postFields } = parsed.data;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "TournamentPost" WHERE "id" = ${post.id} FOR UPDATE`;
    if (capacity !== undefined && capacity !== null) {
      const activeCount = await tx.registrationSubmission.count({
        where: { postId: post.id, status: { in: ["PENDING", "APPROVED", "INVITED", "RESERVED"] } },
      });
      if (capacity < activeCount) return { capacityConflict: true as const };
    }
    const updatedPost = await tx.tournamentPost.update({
      where: { id: post.id },
      data: {
        ...postFields,
        capacity,
        divisions: divisions === undefined ? undefined : divisions.length ? divisions as Prisma.InputJsonValue : Prisma.DbNull,
        paymentMethods: parsed.data.paymentMethods as Prisma.InputJsonValue | undefined,
        registrationLink: parsed.data.registrationLink === "" ? null : parsed.data.registrationLink,
      },
    });
    const tournamentId = parsed.data.tournamentId ?? post.tournamentId;
    const tournamentChanges: { name?: string; locationName?: string; locationAddress?: string | null; locationLatitude?: number | null; locationLongitude?: number | null; scheduledStart?: Date | null; scheduledEnd?: Date | null } = {};
    if (parsed.data.title !== undefined) tournamentChanges.name = parsed.data.title;
    if (parsed.data.location !== undefined) tournamentChanges.locationName = parsed.data.location;
    if (parsed.data.locationAddress !== undefined) tournamentChanges.locationAddress = parsed.data.locationAddress;
    if (parsed.data.locationLatitude !== undefined) tournamentChanges.locationLatitude = parsed.data.locationLatitude;
    if (parsed.data.locationLongitude !== undefined) tournamentChanges.locationLongitude = parsed.data.locationLongitude;
    if (scheduledStart !== undefined) tournamentChanges.scheduledStart = scheduledStart;
    if (scheduledEnd !== undefined) tournamentChanges.scheduledEnd = scheduledEnd;
    if (tournamentId && Object.keys(tournamentChanges).length > 0) {
      await tx.tournament.update({
        where: { id: tournamentId },
        data: tournamentChanges,
      });
    }
    return { capacityConflict: false as const, post: updatedPost };
  });
  if (updated.capacityConflict) return res.status(409).json({ error: "Capacity cannot be lower than the number of pending and confirmed players." });
  res.json({ id: updated.post.id });
});

postsRouter.delete("/:id", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const post = await prisma.tournamentPost.findUnique({
    where: { id: req.params.id },
    include: { photos: true },
  });
  if (!post) return res.status(404).json({ error: "Tournament post not found." });
  if (post.hostId !== req.userId) return res.status(403).json({ error: "Only the host can delete this post." });

  for (const photo of post.photos) {
    await unlinkTournamentPhoto(photo.storedFile);
  }
  if (post.paymentQrStoredFile) await unlinkPaymentQr(post.paymentQrStoredFile);
  await prisma.tournamentPost.delete({ where: { id: post.id } });
  res.json({ ok: true });
});

postsRouter.post("/:id/payment-qr", attachUser, requireAuth, uploadPaymentQr.single("qr"), async (req: AuthedRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const post = await prisma.tournamentPost.findUnique({ where: { id: req.params.id } });
  if (!post) {
    if (req.file) await unlinkPaymentQr(req.file.filename);
    return res.status(404).json({ error: "Event not found." });
  }
  if (post.hostId !== req.userId) {
    if (req.file) await unlinkPaymentQr(req.file.filename);
    return res.status(403).json({ error: "Only the event host can manage its payment QR." });
  }
  if (!req.file) return res.status(400).json({ error: "Choose a QR image to upload." });

  const updated = await prisma.tournamentPost.update({ where: { id: post.id }, data: { paymentQrStoredFile: req.file.filename } });
  if (post.paymentQrStoredFile) await unlinkPaymentQr(post.paymentQrStoredFile);
  res.json({ paymentQrUrl: `/uploads/payment-qrs/${updated.paymentQrStoredFile}` });
});

postsRouter.delete("/:id/payment-qr", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const post = await prisma.tournamentPost.findUnique({ where: { id: req.params.id } });
  if (!post) return res.status(404).json({ error: "Event not found." });
  if (post.hostId !== req.userId) return res.status(403).json({ error: "Only the event host can manage its payment QR." });
  if (post.paymentQrStoredFile) await unlinkPaymentQr(post.paymentQrStoredFile);
  await prisma.tournamentPost.update({ where: { id: post.id }, data: { paymentQrStoredFile: null } });
  res.json({ ok: true });
});

// Up to 8 photos per upload call. Stored on local disk; auto-deleted after
// 14 days by the cleanup job regardless of how many times this is called.
postsRouter.post(
  "/:id/photos",
  attachUser,
  requireAuth,
  uploadTournamentPhotos.array("photos", 8),
  async (req: AuthedRequest, res) => {
    if (!(await requireAdmin(req, res))) return;
    const post = await prisma.tournamentPost.findUnique({ where: { id: req.params.id } });
    if (!post) return res.status(404).json({ error: "Tournament post not found." });
    if (post.hostId !== req.userId) return res.status(403).json({ error: "Only the host can add photos." });

    const files = (req.files as Express.Multer.File[]) ?? [];
    if (files.length === 0) return res.status(400).json({ error: "No image files were uploaded." });

    const imageFiles = await Promise.all(files.map(async (file) => ({ file, data: await fs.readFile(file.path) })));
    const created = await prisma.$transaction(
      imageFiles.map(({ file, data }) =>
        prisma.tournamentPhoto.create({
          data: {
            postId: post.id,
            storedFile: file.filename,
            url: `/uploads/tournaments/${file.filename}`,
            data,
            mimeType: file.mimetype,
          },
        })
      )
    );

    res.status(201).json({
      photoPolicyNote: PHOTO_POLICY_NOTE,
      photos: created.map((p: any) => ({ id: p.id, url: `/api/posts/${post.id}/photos/${p.id}/image`, uploadedAt: p.uploadedAt })),
    });
  }
);

postsRouter.get("/:id/photos/:photoId/image", async (req, res) => {
  const photo = await prisma.tournamentPhoto.findFirst({ where: { id: req.params.photoId, postId: req.params.id } });
  if (!photo) return res.status(404).json({ error: "Photo not found." });
  res.setHeader("Cache-Control", "public, max-age=86400");
  if (photo.data) {
    res.type(photo.mimeType ?? "application/octet-stream").send(Buffer.from(photo.data));
    return;
  }
  res.sendFile(path.join(TOURNAMENT_PHOTO_DIR, photo.storedFile));
});

postsRouter.get("/:id/player-search", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
  if (query.length < 2) return res.json([]);
  const users = await prisma.user.findMany({
    where: { role: "PLAYER", username: { contains: query, mode: "insensitive" } },
    select: { id: true, username: true },
    orderBy: { username: "asc" },
    take: 10,
  });
  res.json(users);
});

postsRouter.delete("/:id/photos/:photoId", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const post = await prisma.tournamentPost.findUnique({ where: { id: req.params.id } });
  if (!post) return res.status(404).json({ error: "Tournament post not found." });
  if (post.hostId !== req.userId) return res.status(403).json({ error: "Only the host can remove photos." });

  const photo = await prisma.tournamentPhoto.findUnique({ where: { id: req.params.photoId } });
  if (!photo || photo.postId !== post.id) return res.status(404).json({ error: "Photo not found." });

  await unlinkTournamentPhoto(photo.storedFile);
  await prisma.tournamentPhoto.delete({ where: { id: photo.id } });
  res.json({ ok: true });
});

// Register for a tournament. If the host defined custom fields, `answers`
// must be an object keyed by field label; otherwise it's just a join.
postsRouter.post("/:id/register", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  const post = await prisma.tournamentPost.findUnique({ where: { id: req.params.id } });
  if (!post) return res.status(404).json({ error: "Tournament post not found." });

  const fields = ((post.registrationFields as any[]) ?? []) as { label: string; required?: boolean }[];
  const answers = req.body?.answers && typeof req.body.answers === "object" ? req.body.answers : {};
  const applicantName = typeof req.body?.applicantName === "string" ? req.body.applicantName.trim() : "";
  const contact = typeof req.body?.contact === "string" ? req.body.contact.trim() : null;
  const division = typeof req.body?.division === "string" ? req.body.division : null;
  const paymentMethod = req.body?.paymentMethod;
  const participantUserId = req.body?.participantUserId === undefined ? req.userId! : req.body.participantUserId;
  const divisions = Array.isArray(post.divisions) ? post.divisions as unknown as { name: string; capacity: number }[] : [];
  const divisionSkillLevels: Record<string, "BEGINNER" | "AVERAGE" | "ADVANCE"> = {
    BEGINNER: "BEGINNER",
    NOVICE: "BEGINNER",
    LOW_INTERMEDIATE: "AVERAGE",
    HIGH_INTERMEDIATE: "ADVANCE",
  };
  const skillLevel = division ? divisionSkillLevels[division] : req.body?.skillLevel;
  if (applicantName.length < 2 || applicantName.length > 80 || !["BEGINNER", "AVERAGE", "ADVANCE"].includes(skillLevel)) {
    return res.status(400).json({ error: "Name and valid skill level are required." });
  }
  if (!post.tournamentId) return res.status(400).json({ error: "This post is not linked to a tournament yet." });
  if (participantUserId !== null && typeof participantUserId !== "string") return res.status(400).json({ error: "Choose a valid player account or enter the player manually." });
  if (typeof participantUserId === "string") {
    const participantUser = await prisma.user.findFirst({ where: { id: participantUserId, role: "PLAYER" }, select: { id: true } });
    if (!participantUser) return res.status(400).json({ error: "That player account could not be found." });
  }
  const paymentMethods = Array.isArray(post.paymentMethods) ? post.paymentMethods as string[] : ["IN_PERSON"];
  if (divisions.length > 0 && !divisions.some((eventDivision) => eventDivision.name === division)) {
    return res.status(400).json({ error: "Choose one of the divisions offered for this event." });
  }
  if (!paymentMethods.includes(paymentMethod)) {
    return res.status(400).json({ error: "Choose a payment method offered for this event." });
  }

  for (const field of fields) {
    if (field.required && !String(answers[field.label] ?? "").trim()) {
      return res.status(400).json({ error: `"${field.label}" is required.` });
    }
  }

  const registration = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "TournamentPost" WHERE "id" = ${post.id} FOR UPDATE`;
    const existing = participantUserId
      ? await tx.registrationSubmission.findUnique({
        where: { postId_participantUserId: { postId: post.id, participantUserId } },
      })
      : null;
    if (existing && existing.status !== "REJECTED") return { kind: "already-registered" as const };

    const activeCount = await tx.registrationSubmission.count({
      where: { postId: post.id, status: { in: ["PENDING", "APPROVED", "INVITED", "RESERVED"] } },
    });
    if (post.capacity !== null && activeCount >= post.capacity) return { kind: "full" as const };
    const selectedDivision = divisions.find((eventDivision) => eventDivision.name === division);
    if (selectedDivision) {
      const divisionCount = await tx.registrationSubmission.count({
        where: { postId: post.id, division, status: { in: ["PENDING", "APPROVED", "INVITED", "RESERVED"] } },
      });
      if (divisionCount >= selectedDivision.capacity) return { kind: "division-full" as const };
    }

    const status = participantUserId && participantUserId !== req.userId ? "INVITED" as const : "PENDING" as const;
    const values = { answers, applicantName, skillLevel, contact, division, paymentMethod, participantUserId };
    const submission = existing
      ? await tx.registrationSubmission.update({ where: { id: existing.id }, data: { ...values, status } })
      : await tx.registrationSubmission.create({ data: { postId: post.id, userId: req.userId!, status, ...values } });
    return { kind: "submitted" as const, submission };
  });

  if (registration.kind === "already-registered") return res.status(409).json({ error: "This player already has a registration for this event." });
  if (registration.kind === "full") return res.status(409).json({ error: "This event has no open spots remaining." });
  if (registration.kind === "division-full") return res.status(409).json({ error: "That division is full. Choose another division if places are available." });
  const { submission } = registration;
  if (submission.status === "INVITED" && submission.participantUserId) {
    await prisma.notification.create({
      data: {
        userId: submission.participantUserId,
        type: "EVENT_INVITATION",
        title: "Tournament invitation",
        message: `You were added to ${post.title}. Accept the invitation to send your registration for review.`,
        actionUrl: `/community/${post.id}`,
      },
    });
  }

  res.status(201).json({ id: submission.id, status: submission.status, ok: true, submittedAt: submission.submittedAt });
});

postsRouter.post("/:id/register/:submissionId/accept", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  const submission = await prisma.registrationSubmission.findFirst({
    where: { id: req.params.submissionId, postId: req.params.id, participantUserId: req.userId!, status: "INVITED" },
    include: { post: true },
  });
  if (!submission) return res.status(404).json({ error: "Invitation not found." });
  const accepted = await prisma.registrationSubmission.update({ where: { id: submission.id }, data: { status: "PENDING" } });
  await prisma.notification.create({
    data: {
      userId: submission.userId,
      type: "EVENT_INVITATION_ACCEPTED",
      title: "Tournament invitation accepted",
      message: `${submission.applicantName} accepted the invitation to ${submission.post.title}.`,
      actionUrl: `/community/${submission.postId}`,
    },
  });
  res.json({ id: accepted.id, status: accepted.status });
});

postsRouter.post("/:id/register/payment-proof", attachUser, requireAuth, uploadPaymentProof.single("proof"), async (req: AuthedRequest, res) => {
  const submissionId = typeof req.body?.submissionId === "string" ? req.body.submissionId : "";
  const submission = await prisma.registrationSubmission.findFirst({ where: { id: submissionId, postId: req.params.id, userId: req.userId! }, include: { post: true } });
  if (!submission) return res.status(404).json({ error: "Submit your registration details first." });
  if (!req.file) return res.status(400).json({ error: "Payment proof image is required." });
  const updated = await prisma.registrationSubmission.update({ where: { id: submission.id }, data: { paymentProofStoredFile: req.file.filename, paymentProofUrl: null } });
  res.json({ hasPaymentProof: !!updated.paymentProofStoredFile, status: updated.status });
});

postsRouter.delete("/:id/register", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  const submission = await prisma.registrationSubmission.findFirst({
    where: { postId: req.params.id, participantUserId: req.userId! },
  });
  if (!submission) return res.status(404).json({ error: "Registration request not found." });
  if (submission.status === "APPROVED") return res.status(409).json({ error: "Contact the organizer to cancel a confirmed place." });

  await prisma.registrationSubmission.delete({ where: { id: submission.id } });
  if (submission.paymentProofStoredFile) await unlinkPaymentProof(submission.paymentProofStoredFile);
  res.json({ ok: true });
});

postsRouter.delete("/:id/register/:submissionId", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  const submission = await prisma.registrationSubmission.findFirst({
    where: { id: req.params.submissionId, postId: req.params.id, userId: req.userId! },
  });
  if (!submission) return res.status(404).json({ error: "Registration request not found." });
  if (submission.status === "APPROVED") return res.status(409).json({ error: "Contact the organizer to cancel a confirmed place." });
  await prisma.registrationSubmission.delete({ where: { id: submission.id } });
  if (submission.paymentProofStoredFile) await unlinkPaymentProof(submission.paymentProofStoredFile);
  res.json({ ok: true });
});

postsRouter.get("/:id/submissions/:submissionId/payment-proof", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  const submission = await prisma.registrationSubmission.findUnique({ where: { id: req.params.submissionId }, include: { post: true } });
  if (!submission || submission.postId !== req.params.id || !submission.paymentProofStoredFile) return res.status(404).json({ error: "Payment proof not found." });
  if (submission.userId !== req.userId && submission.post.hostId !== req.userId) return res.status(403).json({ error: "You cannot view this payment proof." });
  return res.sendFile(path.join(path.dirname(TOURNAMENT_PHOTO_DIR), "payments", submission.paymentProofStoredFile));
});

postsRouter.get("/:id/submissions", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  const post = await prisma.tournamentPost.findUnique({ where: { id: req.params.id } });
  if (!post) return res.status(404).json({ error: "Tournament post not found." });
  if (post.hostId !== req.userId) return res.status(403).json({ error: "Only the tournament admin can review requests." });
  const submissions = await prisma.registrationSubmission.findMany({ where: { postId: post.id }, orderBy: { submittedAt: "desc" }, include: { user: { select: { username: true, avatarUrl: true, defaultAvatarKey: true } }, participantUser: { select: { username: true } } } });
  res.json(submissions);
});

postsRouter.patch("/:id/submissions/:submissionId", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  const post = await prisma.tournamentPost.findUnique({ where: { id: req.params.id } });
  if (!post || post.hostId !== req.userId) return res.status(403).json({ error: "Only the tournament admin can review requests." });
  const status = req.body?.status;
  if (!["APPROVED", "REJECTED", "RESERVED", "PENDING"].includes(status)) return res.status(400).json({ error: "Invalid review status." });
  const submission = await prisma.registrationSubmission.findUnique({ where: { id: req.params.submissionId } });
  if (!submission || submission.postId !== post.id) return res.status(404).json({ error: "Registration request not found." });
  if (!post.tournamentId) return res.status(400).json({ error: "This post is not linked to a tournament." });
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.registrationSubmission.update({ where: { id: submission.id }, data: { status } });
    let playerId: string | null = null;
    if (status === "APPROVED") {
      const player = submission.participantUserId
        ? await tx.player.upsert({
          where: { tournamentId_userId: { tournamentId: post.tournamentId!, userId: submission.participantUserId } },
          update: { name: submission.applicantName, skillLevel: submission.skillLevel, contact: submission.contact, joinStatus: "APPROVED", status: "WAITING" },
          create: { tournamentId: post.tournamentId!, userId: submission.participantUserId, name: submission.applicantName, skillLevel: submission.skillLevel, contact: submission.contact, joinStatus: "APPROVED" },
        })
        : await tx.player.create({ data: { tournamentId: post.tournamentId!, name: submission.applicantName, skillLevel: submission.skillLevel, contact: submission.contact, joinStatus: "APPROVED" } });
      await tx.queueEntry.deleteMany({ where: { tournamentId: post.tournamentId!, playerId: player.id } });
      playerId = player.id;
    }
    const notificationUserId = submission.participantUserId ?? submission.userId;
    const message = status === "APPROVED"
      ? `Your registration for ${post.title} is confirmed.`
      : status === "RESERVED"
        ? `A place for ${submission.applicantName} has been reserved at ${post.title}.`
        : status === "PENDING"
          ? `Your registration for ${post.title} is back on the waitlist.`
          : `Your registration request for ${post.title} was not approved. Contact the event organizer for details.`;
    await tx.notification.create({ data: { userId: notificationUserId, type: `REGISTRATION_${status}`, title: `Event request ${status.toLowerCase()}`, message, actionUrl: `/community/${post.id}` } });
    return { updated, playerId };
  });
  if (result.playerId) await enqueuePlayer(post.tournamentId!, result.playerId);
  res.json(result.updated);
});

async function unlinkTournamentPhoto(storedFile: string) {
  try {
    await fs.unlink(path.join(TOURNAMENT_PHOTO_DIR, storedFile));
  } catch (err: any) {
    if (err?.code !== "ENOENT") console.error("Failed to delete tournament photo:", err);
  }
}

async function unlinkPaymentProof(storedFile: string) {
  try {
    await fs.unlink(path.join(path.dirname(TOURNAMENT_PHOTO_DIR), "payments", storedFile));
  } catch (err: any) {
    if (err?.code !== "ENOENT") console.error("Failed to delete payment proof:", err);
  }
}

async function unlinkPaymentQr(storedFile: string) {
  try {
    await fs.unlink(path.join(PAYMENT_QR_DIR, storedFile));
  } catch (err: any) {
    if (err?.code !== "ENOENT") console.error("Failed to delete event payment QR:", err);
  }
}
