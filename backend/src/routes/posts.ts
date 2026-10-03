import { Router } from "express";
import path from "path";
import fs from "fs/promises";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { attachUser, requireAuth, refreshSubscriptionStatus, AuthedRequest } from "../lib/auth";
import { uploadTournamentPhotos, uploadPaymentProof, TOURNAMENT_PHOTO_DIR } from "../lib/uploads";
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

const postSchema = z.object({
  title: z.string().min(1, "Title is required.").max(120),
  description: z.string().min(1, "Description is required.").max(3000),
  details: z.string().max(3000).nullable().optional(),
  paymentInstructions: z.string().max(3000).nullable().optional(),
  location: z.string().min(1, "Location is required.").max(200),
  amount: z.string().max(80).optional(),
  capacity: z.number().int().min(1).max(1000).nullable().optional(),
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
      ...(search ? { OR: [{ title: { contains: search, mode: "insensitive" } }, { description: { contains: search, mode: "insensitive" } }] } : {}),
      ...(location ? { location: { contains: location, mode: "insensitive" } } : {}),
      ...(amount ? { amount: { contains: amount, mode: "insensitive" } } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      host: true,
      photos: { orderBy: { uploadedAt: "asc" } },
      tournament: { select: { scheduledStart: true, scheduledEnd: true } },
    },
  });
  const registrationCounts = await prisma.registrationSubmission.groupBy({
    by: ["postId"],
    where: { postId: { in: posts.map((post) => post.id) }, status: { in: ["PENDING", "APPROVED"] } },
    _count: { _all: true },
  });
  const countsByPost = new Map(registrationCounts.map((row) => [row.postId, row._count._all]));

  res.json({
    photoPolicyNote: PHOTO_POLICY_NOTE,
    posts: posts.map((p: any) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      location: p.location,
      amount: p.amount,
      capacity: p.capacity,
      scheduledStart: p.tournament?.scheduledStart ?? null,
      scheduledEnd: p.tournament?.scheduledEnd ?? null,
      createdAt: p.createdAt,
      host: hostSummary(p.host),
      photos: p.photos.map((ph: any) => ph.url),
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
      tournament: { select: { scheduledStart: true, scheduledEnd: true } },
    },
  });
  if (!post) return res.status(404).json({ error: "Tournament post not found." });
  const registrationCount = await prisma.registrationSubmission.count({
    where: { postId: post.id, status: { in: ["PENDING", "APPROVED"] } },
  });

  const mySubmission = req.userId
    ? await prisma.registrationSubmission.findUnique({
      where: { postId_userId: { postId: post.id, userId: req.userId } },
    })
    : null;

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
    scheduledStart: post.tournament?.scheduledStart ?? null,
    scheduledEnd: post.tournament?.scheduledEnd ?? null,
    registrationLink: post.registrationLink,
    registrationFields: post.registrationFields ?? [],
    createdAt: post.createdAt,
    host: hostSummary(post.host),
    isOwner: post.hostId === req.userId,
    photos: post.photos.map((ph: any) => ({ id: ph.id, url: ph.url, uploadedAt: ph.uploadedAt })),
    registrationCount,
    tournamentId: post.tournamentId,
    myRegistration: mySubmission ? { answers: mySubmission.answers, submittedAt: mySubmission.submittedAt, status: mySubmission.status, applicantName: mySubmission.applicantName, skillLevel: mySubmission.skillLevel, hasPaymentProof: !!mySubmission.paymentProofStoredFile } : null,
  });
});

postsRouter.post("/", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const parsed = postSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const data = parsed.data;
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
    if (!tournamentId) {
      const tournament = await tx.tournament.create({
        data: { name: data.title, type: data.tournamentType, ownerId: req.userId!, locationName: data.location, scheduledStart, scheduledEnd },
      });
      tournamentId = tournament.id;
    } else if (data.scheduledStart !== undefined || data.scheduledEnd !== undefined) {
      await tx.tournament.update({ where: { id: tournamentId }, data: { scheduledStart, scheduledEnd } });
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
        capacity: data.capacity,
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

  const scheduledStart = parsed.data.scheduledStart === undefined ? undefined : parsed.data.scheduledStart ? new Date(parsed.data.scheduledStart) : null;
  const scheduledEnd = parsed.data.scheduledEnd === undefined ? undefined : parsed.data.scheduledEnd ? new Date(parsed.data.scheduledEnd) : null;
  const effectiveStart = scheduledStart === undefined ? post.tournament?.scheduledStart ?? null : scheduledStart;
  const effectiveEnd = scheduledEnd === undefined ? post.tournament?.scheduledEnd ?? null : scheduledEnd;
  if (effectiveEnd && (!effectiveStart || effectiveEnd <= effectiveStart)) {
    return res.status(400).json({ error: "Event end time must be after its start time." });
  }
  const { scheduledStart: _scheduledStart, scheduledEnd: _scheduledEnd, ...postFields } = parsed.data;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "TournamentPost" WHERE "id" = ${post.id} FOR UPDATE`;
    if (parsed.data.capacity !== undefined && parsed.data.capacity !== null) {
      const activeCount = await tx.registrationSubmission.count({
        where: { postId: post.id, status: { in: ["PENDING", "APPROVED"] } },
      });
      if (parsed.data.capacity < activeCount) return { capacityConflict: true as const };
    }
    const updatedPost = await tx.tournamentPost.update({
      where: { id: post.id },
      data: {
        ...postFields,
        registrationLink: parsed.data.registrationLink === "" ? null : parsed.data.registrationLink,
      },
    });
    const tournamentId = parsed.data.tournamentId ?? post.tournamentId;
    const tournamentChanges: { name?: string; locationName?: string; scheduledStart?: Date | null; scheduledEnd?: Date | null } = {};
    if (parsed.data.title !== undefined) tournamentChanges.name = parsed.data.title;
    if (parsed.data.location !== undefined) tournamentChanges.locationName = parsed.data.location;
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
  await prisma.tournamentPost.delete({ where: { id: post.id } });
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

    const created = await prisma.$transaction(
      files.map((file) =>
        prisma.tournamentPhoto.create({
          data: {
            postId: post.id,
            storedFile: file.filename,
            url: `/uploads/tournaments/${file.filename}`,
          },
        })
      )
    );

    res.status(201).json({
      photoPolicyNote: PHOTO_POLICY_NOTE,
      photos: created.map((p: any) => ({ id: p.id, url: p.url, uploadedAt: p.uploadedAt })),
    });
  }
);

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
  const skillLevel = req.body?.skillLevel;
  const contact = typeof req.body?.contact === "string" ? req.body.contact.trim() : null;
  if (applicantName.length < 2 || applicantName.length > 80 || !["BEGINNER", "AVERAGE", "ADVANCE"].includes(skillLevel)) {
    return res.status(400).json({ error: "Name and valid skill level are required." });
  }
  if (!post.tournamentId) return res.status(400).json({ error: "This post is not linked to a tournament yet." });

  for (const field of fields) {
    if (field.required && !String(answers[field.label] ?? "").trim()) {
      return res.status(400).json({ error: `"${field.label}" is required.` });
    }
  }

  const registration = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "TournamentPost" WHERE "id" = ${post.id} FOR UPDATE`;
    const existing = await tx.registrationSubmission.findUnique({
      where: { postId_userId: { postId: post.id, userId: req.userId! } },
    });
    if (existing?.status === "APPROVED") return { kind: "already-approved" as const };

    const activeCount = await tx.registrationSubmission.count({
      where: { postId: post.id, status: { in: ["PENDING", "APPROVED"] } },
    });
    if ((!existing || existing.status === "REJECTED") && post.capacity !== null && activeCount >= post.capacity) return { kind: "full" as const };

    const submission = await tx.registrationSubmission.upsert({
      where: { postId_userId: { postId: post.id, userId: req.userId! } },
      update: { answers, applicantName, skillLevel, contact, ...(existing?.status === "REJECTED" ? { status: "PENDING" as const } : {}) },
      create: { postId: post.id, userId: req.userId!, answers, applicantName, skillLevel, contact },
    });
    return { kind: "submitted" as const, submission };
  });

  if (registration.kind === "already-approved") return res.status(409).json({ error: "You are already confirmed for this event." });
  if (registration.kind === "full") return res.status(409).json({ error: "This event has no open spots remaining." });
  const { submission } = registration;

  res.status(201).json({ ok: true, submittedAt: submission.submittedAt });
});

postsRouter.post("/:id/register/payment-proof", attachUser, requireAuth, uploadPaymentProof.single("proof"), async (req: AuthedRequest, res) => {
  const submission = await prisma.registrationSubmission.findUnique({ where: { postId_userId: { postId: req.params.id, userId: req.userId! } }, include: { post: true } });
  if (!submission) return res.status(404).json({ error: "Submit your registration details first." });
  if (!req.file) return res.status(400).json({ error: "Payment proof image is required." });
  const updated = await prisma.registrationSubmission.update({ where: { id: submission.id }, data: { paymentProofStoredFile: req.file.filename, paymentProofUrl: null } });
  res.json({ hasPaymentProof: !!updated.paymentProofStoredFile, status: updated.status });
});

postsRouter.delete("/:id/register", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  const submission = await prisma.registrationSubmission.findUnique({
    where: { postId_userId: { postId: req.params.id, userId: req.userId! } },
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
  const submissions = await prisma.registrationSubmission.findMany({ where: { postId: post.id }, orderBy: { submittedAt: "desc" }, include: { user: { select: { username: true, avatarUrl: true, defaultAvatarKey: true } } } });
  res.json(submissions);
});

postsRouter.patch("/:id/submissions/:submissionId", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  const post = await prisma.tournamentPost.findUnique({ where: { id: req.params.id } });
  if (!post || post.hostId !== req.userId) return res.status(403).json({ error: "Only the tournament admin can review requests." });
  const status = req.body?.status;
  if (!["APPROVED", "REJECTED"].includes(status)) return res.status(400).json({ error: "Invalid review status." });
  const submission = await prisma.registrationSubmission.findUnique({ where: { id: req.params.submissionId } });
  if (!submission || submission.postId !== post.id) return res.status(404).json({ error: "Registration request not found." });
  if (!post.tournamentId) return res.status(400).json({ error: "This post is not linked to a tournament." });
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.registrationSubmission.update({ where: { id: submission.id }, data: { status } });
    if (status === "APPROVED") {
      const player = await tx.player.upsert({
        where: { tournamentId_userId: { tournamentId: post.tournamentId!, userId: submission.userId } },
        update: { name: submission.applicantName, skillLevel: submission.skillLevel, contact: submission.contact, joinStatus: "APPROVED", status: "WAITING" },
        create: { tournamentId: post.tournamentId!, userId: submission.userId, name: submission.applicantName, skillLevel: submission.skillLevel, contact: submission.contact, joinStatus: "APPROVED" },
      });
      await tx.queueEntry.deleteMany({ where: { tournamentId: post.tournamentId!, playerId: player.id } });
    }
    await tx.notification.create({ data: { userId: submission.userId, type: `REGISTRATION_${status}`, title: `Event request ${status.toLowerCase()}`, message: status === "APPROVED" ? `Your registration for ${post.title} is confirmed.` : `Your registration request for ${post.title} was not approved. Contact the event organizer for details.` } });
    return updated;
  });
  if (status === "APPROVED") {
    const player = await prisma.player.findUnique({ where: { tournamentId_userId: { tournamentId: post.tournamentId!, userId: submission.userId } } });
    if (player) await enqueuePlayer(post.tournamentId!, player.id);
  }
  res.json(result);
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
