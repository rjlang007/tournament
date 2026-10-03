import { Router } from "express";
import path from "path";
import fs from "fs/promises";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { attachUser, requireAuth, AuthedRequest } from "../lib/auth";
import { uploadTournamentPhotos, uploadPaymentProof, TOURNAMENT_PHOTO_DIR } from "../lib/uploads";
import { defaultAvatarUrl } from "../lib/defaultAvatars";
import { PHOTO_LIFETIME_DAYS } from "../lib/cleanup";
import { enqueuePlayer } from "../lib/queue";

export const postsRouter = Router();

async function requireAdmin(req: AuthedRequest, res: any) {
  const user = req.userId ? await prisma.user.findUnique({ where: { id: req.userId }, select: { role: true } }) : null;
  if (!user || !["ADMIN", "SUPERADMIN"].includes(user.role)) {
    res.status(403).json({ error: "Only tournament administrators can publish or manage tournament posts." });
    return false;
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
  details: z.string().max(3000).optional(),
  location: z.string().min(1, "Location is required.").max(200),
  amount: z.string().max(80).optional(),
  registrationLink: z.string().url("Registration link must be a valid URL.").max(500).optional().or(z.literal("")),
  registrationFields: z.array(registrationFieldSchema).max(20).optional(),
  tournamentId: z.string().uuid().optional(),
});

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
      _count: { select: { submissions: true } },
    },
  });

  res.json({
    photoPolicyNote: PHOTO_POLICY_NOTE,
    posts: posts.map((p: any) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      location: p.location,
      amount: p.amount,
      createdAt: p.createdAt,
      host: hostSummary(p.host),
      photos: p.photos.map((ph: any) => ph.url),
      registrationCount: p._count.submissions,
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
      _count: { select: { submissions: true } },
    },
  });
  if (!post) return res.status(404).json({ error: "Tournament post not found." });

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
    location: post.location,
    amount: post.amount,
    registrationLink: post.registrationLink,
    registrationFields: post.registrationFields ?? [],
    createdAt: post.createdAt,
    host: hostSummary(post.host),
    isOwner: post.hostId === req.userId,
    photos: post.photos.map((ph: any) => ({ id: ph.id, url: ph.url, uploadedAt: ph.uploadedAt })),
    registrationCount: post._count.submissions,
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
  if (data.tournamentId) {
    const tournament = await prisma.tournament.findFirst({ where: { id: data.tournamentId, ownerId: req.userId! } });
    if (!tournament) return res.status(403).json({ error: "You can only publish tournaments you own." });
  }

  const post = await prisma.tournamentPost.create({
    data: {
      hostId: req.userId!,
      title: data.title,
      description: data.description,
      details: data.details,
      location: data.location,
      amount: data.amount,
      registrationLink: data.registrationLink || null,
      registrationFields: data.registrationFields ?? undefined,
      tournamentId: data.tournamentId,
    },
  });

  res.status(201).json({ id: post.id });
});

postsRouter.patch("/:id", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const post = await prisma.tournamentPost.findUnique({ where: { id: req.params.id } });
  if (!post) return res.status(404).json({ error: "Tournament post not found." });
  if (post.hostId !== req.userId) return res.status(403).json({ error: "Only the host can edit this post." });

  const parsed = postSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  if (parsed.data.tournamentId) {
    const tournament = await prisma.tournament.findFirst({ where: { id: parsed.data.tournamentId, ownerId: req.userId! } });
    if (!tournament) return res.status(403).json({ error: "You can only link tournaments you own." });
  }

  const updated = await prisma.tournamentPost.update({
    where: { id: post.id },
    data: {
      ...parsed.data,
      registrationLink: parsed.data.registrationLink === "" ? null : parsed.data.registrationLink,
    },
  });
  res.json({ id: updated.id });
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

  const submission = await prisma.registrationSubmission.upsert({
    where: { postId_userId: { postId: post.id, userId: req.userId! } },
    update: { answers, applicantName, skillLevel, contact, status: "PENDING" },
    create: { postId: post.id, userId: req.userId!, answers, applicantName, skillLevel, contact },
  });

  res.status(201).json({ ok: true, submittedAt: submission.submittedAt });
});

postsRouter.post("/:id/register/payment-proof", attachUser, requireAuth, uploadPaymentProof.single("proof"), async (req: AuthedRequest, res) => {
  const submission = await prisma.registrationSubmission.findUnique({ where: { postId_userId: { postId: req.params.id, userId: req.userId! } }, include: { post: true } });
  if (!submission) return res.status(404).json({ error: "Submit your registration details first." });
  if (!req.file) return res.status(400).json({ error: "Payment proof image is required." });
  const updated = await prisma.registrationSubmission.update({ where: { id: submission.id }, data: { paymentProofStoredFile: req.file.filename, paymentProofUrl: null, status: "PENDING" } });
  res.json({ hasPaymentProof: !!updated.paymentProofStoredFile, status: updated.status });
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
    await tx.notification.create({ data: { userId: submission.userId, type: `REGISTRATION_${status}`, title: `Tournament request ${status.toLowerCase()}`, message: status === "APPROVED" ? `Your payment was approved for ${post.title}. You are now in the player roster.` : `Your payment request for ${post.title} was rejected. Contact the tournament admin for details.` } });
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
