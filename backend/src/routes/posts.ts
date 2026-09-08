import { Router } from "express";
import path from "path";
import fs from "fs/promises";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { attachUser, requireAuth, AuthedRequest } from "../lib/auth";
import { uploadTournamentPhotos, TOURNAMENT_PHOTO_DIR } from "../lib/uploads";
import { defaultAvatarUrl } from "../lib/defaultAvatars";
import { PHOTO_LIFETIME_DAYS } from "../lib/cleanup";

export const postsRouter = Router();

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

postsRouter.get("/", attachUser, requireAuth, async (_req, res) => {
  const posts = await prisma.tournamentPost.findMany({
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
    })),
  });
});

postsRouter.get("/:id", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  const post = await prisma.tournamentPost.findUnique({
    where: { id: req.params.id },
    include: {
      host: true,
      photos: { orderBy: { uploadedAt: "asc" } },
      _count: { select: { submissions: true } },
    },
  });
  if (!post) return res.status(404).json({ error: "Tournament post not found." });

  const mySubmission = await prisma.registrationSubmission.findUnique({
    where: { postId_userId: { postId: post.id, userId: req.userId! } },
  });

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
    myRegistration: mySubmission ? { answers: mySubmission.answers, submittedAt: mySubmission.submittedAt } : null,
  });
});

postsRouter.post("/", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  const parsed = postSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const data = parsed.data;

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
    },
  });

  res.status(201).json({ id: post.id });
});

postsRouter.patch("/:id", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  const post = await prisma.tournamentPost.findUnique({ where: { id: req.params.id } });
  if (!post) return res.status(404).json({ error: "Tournament post not found." });
  if (post.hostId !== req.userId) return res.status(403).json({ error: "Only the host can edit this post." });

  const parsed = postSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
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

  for (const field of fields) {
    if (field.required && !String(answers[field.label] ?? "").trim()) {
      return res.status(400).json({ error: `"${field.label}" is required.` });
    }
  }

  const submission = await prisma.registrationSubmission.upsert({
    where: { postId_userId: { postId: post.id, userId: req.userId! } },
    update: { answers },
    create: { postId: post.id, userId: req.userId!, answers },
  });

  res.status(201).json({ ok: true, submittedAt: submission.submittedAt });
});

async function unlinkTournamentPhoto(storedFile: string) {
  try {
    await fs.unlink(path.join(TOURNAMENT_PHOTO_DIR, storedFile));
  } catch (err: any) {
    if (err?.code !== "ENOENT") console.error("Failed to delete tournament photo:", err);
  }
}
