import { randomUUID } from "crypto";
import { Request, Response, Router } from "express";
import { prisma } from "../lib/prisma";
import { calculateCommissionCents, createPayMongoCheckout, isPayMongoConfigured, verifyPayMongoSignature } from "../lib/paymongo";
import { attachUser, AuthedRequest, requireAuth, requireSuperAdmin } from "../lib/auth";
import { z } from "zod";
import { timingSafeEqual } from "crypto";
import { createPayMongoTransfer, decryptPayoutAccount, encryptPayoutAccount, listPayMongoReceivingInstitutions } from "../lib/paymongo";

export const paymentsRouter = Router();

paymentsRouter.post("/events/:submissionId/checkout", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  if (!isPayMongoConfigured()) return res.status(503).json({ error: "Online payments are not configured. Please contact the platform administrator." });
  const submission = await prisma.registrationSubmission.findUnique({
    where: { id: req.params.submissionId },
    include: { post: { include: { tournament: true } } },
  });
  if (!submission || (submission.userId !== req.userId && submission.participantUserId !== req.userId)) return res.status(404).json({ error: "Registration not found." });
  const post = submission.post;
  if (!post.entryFeeCents || post.entryFeeCents < 1) return res.status(400).json({ error: "This event does not have an online entry fee." });
  if (submission.paymentMethod !== "PAYMONGO") return res.status(400).json({ error: "Select Playwell online checkout for this registration before starting payment." });
  if (post.tournament?.resultsFinalizedAt) return res.status(409).json({ error: "This event has finished and is no longer accepting payments." });
  if (submission.status === "REJECTED" || submission.status === "INVITED") return res.status(409).json({ error: "Accept the invitation or contact the organizer before paying." });
  if (submission.paymentStatus === "PAID" || submission.paymentStatus === "VERIFIED") return res.status(409).json({ error: "This registration is already marked as paid." });
  const setting = await prisma.platformSetting.findUnique({ where: { id: "platform" }, select: { eventCommissionBps: true } });
  const commissionBps = setting?.eventCommissionBps ?? 500;
  const commissionCents = calculateCommissionCents(post.entryFeeCents, commissionBps);
  const referenceNumber = `evt-${randomUUID().replace(/-/g, "")}`;
  const paymentOrExisting = await prisma.$transaction(async (tx) => {
    const registrations = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "RegistrationSubmission" WHERE "id" = ${submission.id} FOR UPDATE`;
    if (registrations.length === 0) return { registrationMissing: true as const, existingCheckoutUrl: null, payment: null };
    const openCheckout = await tx.eventPayment.findFirst({
      where: { registrationId: submission.id, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      select: { id: true, providerCheckoutUrl: true },
    });
    if (openCheckout) return { registrationMissing: false as const, existingCheckoutUrl: openCheckout.providerCheckoutUrl, payment: null };
    const payment = await tx.eventPayment.create({
      data: {
        registrationId: submission.id,
        referenceNumber,
        grossAmountCents: post.entryFeeCents!,
        commissionCents,
        currency: "PHP",
        status: "PENDING",
      },
    });
    return { registrationMissing: false as const, existingCheckoutUrl: null, payment };
  });
  if (paymentOrExisting.registrationMissing) return res.status(404).json({ error: "Registration not found." });
  if (!paymentOrExisting.payment) {
    if (paymentOrExisting.existingCheckoutUrl) return res.json({ checkoutUrl: paymentOrExisting.existingCheckoutUrl });
    return res.status(409).json({ error: "Checkout is already being prepared. Please try again in a moment." });
  }
  const payment = paymentOrExisting.payment;

  const appUrl = process.env.PUBLIC_APP_URL;
  if (!appUrl) {
    await prisma.eventPayment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
    return res.status(503).json({ error: "Online checkout return URLs are not configured." });
  }
  let baseUrl: URL;
  try {
    baseUrl = new URL(appUrl);
  } catch {
    await prisma.eventPayment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
    return res.status(503).json({ error: "Online checkout return URLs are not configured correctly." });
  }
  if (process.env.NODE_ENV === "production" && baseUrl.protocol !== "https:") {
    await prisma.eventPayment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
    return res.status(503).json({ error: "Online checkout requires a secure HTTPS app URL." });
  }
  const successUrl = new URL(`/community/${post.id}?payment=success`, baseUrl).toString();
  const cancelUrl = new URL(`/community/${post.id}?payment=cancelled`, baseUrl).toString();

  try {
    const checkout = await createPayMongoCheckout({
      amountCents: post.entryFeeCents,
      itemName: `${post.title} entry fee`,
      referenceNumber,
      successUrl,
      cancelUrl,
      metadata: { eventPaymentId: payment.id, registrationId: submission.id },
    });
    await prisma.eventPayment.update({ where: { id: payment.id }, data: { providerCheckoutId: checkout.checkoutId, providerCheckoutUrl: checkout.checkoutUrl } });
    await prisma.registrationSubmission.update({ where: { id: submission.id }, data: { paymentStatus: "PENDING" } });
    res.json({ checkoutUrl: checkout.checkoutUrl });
  } catch (error) {
    await prisma.eventPayment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
    console.error("Could not create PayMongo checkout", error);
    res.status(502).json({ error: error instanceof Error ? error.message : "Could not start online checkout." });
  }
});

type PayMongoCheckoutEvent = {
  type?: string;
  data?: {
    id?: string;
    attributes?: {
      status?: string;
      amount?: number;
      net_amount?: number;
      fee?: number;
      reference_number?: string;
      payments?: { id?: string; attributes?: { amount?: number; fee?: number; net_amount?: number; status?: string } }[];
    };
  };
};

function checkoutEvent(payload: unknown): PayMongoCheckoutEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const outer = payload as { data?: unknown };
  if (!outer.data || typeof outer.data !== "object") return null;
  const event = outer.data as { attributes?: unknown };
  if (!event.attributes || typeof event.attributes !== "object") return null;
  const attributes = event.attributes as { type?: unknown; data?: unknown };
  if (typeof attributes.type !== "string") return null;
  const resource = (attributes.data && typeof attributes.data === "object" ? attributes.data : null) as PayMongoCheckoutEvent["data"] | null;
  return { type: attributes.type, data: resource ?? undefined };
}

async function updatePayoutFromProvider(transferId: string, status: string) {
  return prisma.$transaction(async (tx) => {
    const payout = await tx.organizerPayout.findUnique({ where: { providerTransferId: transferId } });
    if (!payout) return false;
    if (payout.status === "PAID" || payout.status === "FAILED") return true;
    const successful = ["success", "successful", "paid", "completed"].includes(status);
    const failed = ["failed", "cancelled", "canceled"].includes(status);
    if (!successful && !failed) return true;
    const updated = await tx.organizerPayout.updateMany({
      where: { id: payout.id, status: "PROCESSING" },
      data: successful ? { status: "PAID", paidAt: new Date() } : { status: "FAILED", failureReason: `PayMongo transfer ${status}` },
    });
    if (!updated.count || !successful) return true;
    await tx.paymentLedgerEntry.createMany({
      data: [
        { idempotencyKey: `payout:${payout.id}:organizer`, type: "ORGANIZER_PAYOUT", amountCents: -payout.amountCents, description: `Organizer payout for tournament ${payout.tournamentId}`, payoutId: payout.id },
        ...(payout.transferFeeCents ? [{ idempotencyKey: `payout:${payout.id}:transfer-fee`, type: "PROCESSING_FEE" as const, amountCents: -payout.transferFeeCents, description: "PayMongo organizer transfer fee", payoutId: payout.id }] : []),
      ],
      skipDuplicates: true,
    });
    return true;
  });
}

export async function payMongoWebhook(req: Request, res: Response) {
  const secret = process.env.PAYMONGO_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: "Payment webhook is not configured." });
  if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: "Invalid webhook body." });
  if (!verifyPayMongoSignature(req.body, req.header("X-Paymongo-Signature"), secret)) {
    return res.status(401).json({ error: "Invalid webhook signature." });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(req.body.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid webhook JSON." });
  }
  const event = checkoutEvent(payload);
  if (!event) return res.status(400).json({ error: "Invalid payment event." });
  if (event.type?.includes("transfer")) {
    const transferId = event.data?.id;
    const status = event.data?.attributes?.status?.toLowerCase();
    if (!transferId || !status) return res.status(400).json({ error: "Transfer event is missing required identifiers." });
    if (!await updatePayoutFromProvider(transferId, status)) return res.status(404).json({ error: "Payout transfer not found." });
    return res.sendStatus(200);
  }
  if (event.type === "checkout_session.payment.failed") {
    const checkoutId = event.data?.id;
    if (!checkoutId) return res.status(400).json({ error: "Failed payment event is missing its checkout identifier." });
    const failed = await prisma.eventPayment.findFirst({ where: { providerCheckoutId: checkoutId, status: "PENDING" } });
    if (failed) {
      await prisma.$transaction([
        prisma.eventPayment.update({ where: { id: failed.id }, data: { status: "FAILED" } }),
        prisma.registrationSubmission.updateMany({ where: { id: failed.registrationId, paymentStatus: "PENDING" }, data: { paymentStatus: "FAILED" } }),
      ]);
    }
    return res.sendStatus(200);
  }
  if (event.type !== "checkout_session.payment.paid") return res.sendStatus(200);
  const checkoutId = event.data?.id;
  const referenceNumber = event.data?.attributes?.reference_number;
  const providerPayment = event.data?.attributes?.payments?.find((payment) => payment.attributes?.status === "paid");
  if (!checkoutId || !referenceNumber || !providerPayment?.id) {
    return res.status(400).json({ error: "Payment event is missing required identifiers." });
  }

  const payment = await prisma.eventPayment.findFirst({
    where: { referenceNumber, providerCheckoutId: checkoutId },
    include: { registration: { include: { post: true } } },
  });
  if (!payment) return res.status(404).json({ error: "Payment reference not found." });
  if (payment.status === "PAID") return res.sendStatus(200);
  const fee = providerPayment.attributes?.fee ?? 0;
  const expectedTotal = payment.grossAmountCents;
  const providerAttributes = providerPayment.attributes;
  const receivedAmount = providerAttributes?.amount
    ?? (providerAttributes?.net_amount !== undefined ? providerAttributes.net_amount + fee : undefined);
  if (receivedAmount === undefined) return res.status(400).json({ error: "Payment event is missing the amount needed for verification." });
  if (receivedAmount !== expectedTotal) return res.status(409).json({ error: "Payment amount does not match the registration amount." });
  const organizerNet = payment.grossAmountCents - payment.commissionCents - fee;
  if (organizerNet < 0) return res.status(409).json({ error: "Payment fees exceed the amount collected." });

  await prisma.$transaction(async (tx) => {
    const updated = await tx.eventPayment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: { status: "PAID", providerPaymentId: providerPayment.id, processingFeeCents: fee, paidAt: new Date() },
    });
    if (!updated.count) return;
    await tx.registrationSubmission.updateMany({
      where: { id: payment.registrationId, status: { not: "REJECTED" }, paymentStatus: { notIn: ["PAID", "VERIFIED"] } },
      data: { paymentStatus: "PAID", paymentVerifiedAt: new Date(), paymentVerificationNote: "PayMongo online payment" },
    });
    await tx.paymentLedgerEntry.createMany({
      data: [
        { idempotencyKey: `event:${payment.id}:gross`, type: "EVENT_PAYMENT", amountCents: payment.grossAmountCents, description: `Event payment ${payment.referenceNumber}`, eventPaymentId: payment.id },
        { idempotencyKey: `event:${payment.id}:commission`, type: "PLATFORM_COMMISSION", amountCents: payment.commissionCents, description: `Platform commission (${payment.commissionCents} cents)`, eventPaymentId: payment.id },
        ...(fee ? [{ idempotencyKey: `event:${payment.id}:processing-fee`, type: "PROCESSING_FEE" as const, amountCents: -fee, description: "PayMongo processing fee", eventPaymentId: payment.id }] : []),
      ],
      skipDuplicates: true,
    });
  });
  res.sendStatus(200);
}

export async function payMongoPayoutCallback(req: Request, res: Response) {
  const configuredToken = process.env.PAYMONGO_PAYOUT_CALLBACK_TOKEN;
  const suppliedToken = typeof req.params.token === "string" ? req.params.token : "";
  if (!configuredToken || Buffer.byteLength(configuredToken) !== Buffer.byteLength(suppliedToken)
    || !timingSafeEqual(Buffer.from(configuredToken), Buffer.from(suppliedToken))) {
    return res.status(401).json({ error: "Invalid payout callback token." });
  }
  if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: "Invalid transfer callback body." });
  let payload: unknown;
  try {
    payload = JSON.parse(req.body.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid transfer callback JSON." });
  }
  const transfer = payload && typeof payload === "object"
    ? (("data" in payload && payload.data && typeof payload.data === "object") ? payload.data : payload) as { id?: unknown; status?: unknown; attributes?: { status?: unknown } }
    : null;
  const transferId = typeof transfer?.id === "string" ? transfer.id : null;
  const statusValue = transfer?.attributes?.status ?? transfer?.status;
  const status = typeof statusValue === "string" ? statusValue.toLowerCase() : "";
  if (!transferId || !status) return res.status(400).json({ error: "Transfer callback is missing its status or identifier." });
  if (!await updatePayoutFromProvider(transferId, status)) return res.status(404).json({ error: "Payout transfer not found." });
  res.sendStatus(200);
}

paymentsRouter.get("/ledger", attachUser, requireSuperAdmin, async (req, res) => {
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : undefined;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
    return res.status(400).json({ error: "Choose valid date filters." });
  }
  const entries = await prisma.paymentLedgerEntry.findMany({
    where: { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } },
    orderBy: { createdAt: "desc" },
    take: 500,
    include: {
      eventPayment: { select: { referenceNumber: true } },
      payout: { include: { organizer: { select: { username: true } }, tournament: { select: { name: true } } } },
    },
  });
  const grouped = await prisma.paymentLedgerEntry.groupBy({
    by: ["type"],
    where: { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } },
    _sum: { amountCents: true },
  });
  const totals = Object.fromEntries(grouped.map((item) => [item.type, item._sum.amountCents ?? 0]));
  const payouts = await prisma.organizerPayout.findMany({
    where: { status: { in: ["PENDING", "PROCESSING", "FAILED"] } },
    orderBy: { requestedAt: "desc" },
    include: { organizer: { select: { username: true } }, tournament: { select: { name: true } } },
  });
  const finalizedEvents = await prisma.tournament.findMany({
    where: {
      resultsFinalizedAt: { not: null },
      ownerId: { not: null },
      organizerPayout: null,
      posts: { some: { submissions: { some: { payments: { some: { status: "PAID" } } } } } },
    },
    select: { id: true, name: true, ownerId: true, owner: { select: { username: true, payoutAccountEncrypted: true } } },
    orderBy: { resultsFinalizedAt: "desc" },
    take: 100,
  });
  const eligiblePayouts = await Promise.all(finalizedEvents.map(async (event) => {
    const [payments, pendingRegistrationCount] = await Promise.all([
      prisma.eventPayment.findMany({
        where: {
          status: "PAID",
          registration: {
            post: { tournamentId: event.id },
            status: "APPROVED",
            paymentStatus: { in: ["PAID", "VERIFIED"] },
          },
        },
        select: { grossAmountCents: true, commissionCents: true, processingFeeCents: true },
      }),
      prisma.registrationSubmission.count({
        where: {
          post: { tournamentId: event.id },
          status: { not: "REJECTED" },
          OR: [
            { status: { notIn: ["APPROVED", "REJECTED"] } },
            { paymentStatus: { notIn: ["PAID", "VERIFIED"] } },
          ],
        },
      }),
    ]);
    return {
      id: event.id,
      name: event.name,
      organizer: event.owner?.username ?? "Unknown",
      payoutAccountConfigured: !!event.owner?.payoutAccountEncrypted,
      pendingRegistrationCount,
      amountCents: payments.reduce((sum, payment) => sum + payment.grossAmountCents - payment.commissionCents - payment.processingFeeCents, 0),
    };
  }));
  res.json({ entries, totals, payouts, eligiblePayouts, currency: "PHP" });
});

const payoutAccountSchema = z.object({
  number: z.string().trim().min(6).max(32),
  name: z.string().trim().min(2).max(100),
  bic: z.string().trim().min(8).max(11).regex(/^[A-Za-z0-9]+$/),
});

paymentsRouter.get("/payout-account", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { payoutAccountEncrypted: true } });
  res.json({ configured: !!user?.payoutAccountEncrypted });
});

paymentsRouter.put("/payout-account", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  const parsed = payoutAccountSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  let encrypted: string;
  try {
    encrypted = encryptPayoutAccount(parsed.data);
  } catch (error) {
    return res.status(503).json({ error: error instanceof Error ? error.message : "Payout details could not be saved." });
  }
  await prisma.user.update({ where: { id: req.userId! }, data: { payoutAccountEncrypted: encrypted } });
  res.json({ configured: true });
});

paymentsRouter.get("/receiving-institutions", attachUser, requireAuth, async (req, res) => {
  const provider = req.query.provider === "pesonet" ? "pesonet" : "instapay";
  try {
    res.json({ institutions: await listPayMongoReceivingInstitutions(provider) });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Could not load supported banks." });
  }
});

paymentsRouter.post("/tournaments/:tournamentId/payout", attachUser, requireSuperAdmin, async (req, res) => {
  const tournament = await prisma.tournament.findUnique({
    where: { id: req.params.tournamentId },
    select: { id: true, name: true, ownerId: true, resultsFinalizedAt: true },
  });
  if (!tournament) return res.status(404).json({ error: "Tournament not found." });
  if (!tournament.resultsFinalizedAt) return res.status(409).json({ error: "Finalize the tournament results before requesting an organizer payout." });
  if (!tournament.ownerId) return res.status(409).json({ error: "This tournament has no organizer account to pay." });
  const existing = await prisma.organizerPayout.findUnique({ where: { tournamentId: tournament.id } });
  if (existing) return res.status(409).json({ error: `A payout already exists for this event (${existing.status.toLowerCase()}).` });
  const unpaid = await prisma.registrationSubmission.count({
    where: {
      post: { tournamentId: tournament.id },
      status: { not: "REJECTED" },
      OR: [
        { status: { notIn: ["APPROVED", "REJECTED"] } },
        { paymentStatus: { notIn: ["PAID", "VERIFIED"] } },
      ],
    },
  });
  if (unpaid > 0) return res.status(409).json({ error: "Resolve all pending registration payments before paying out this event." });
  const payments = await prisma.eventPayment.findMany({
    where: {
      status: "PAID",
      registration: {
        post: { tournamentId: tournament.id },
        status: "APPROVED",
        paymentStatus: { in: ["PAID", "VERIFIED"] },
      },
    },
    select: { grossAmountCents: true, commissionCents: true, processingFeeCents: true },
  });
  const amountCents = payments.reduce((sum, payment) => sum + payment.grossAmountCents - payment.commissionCents - payment.processingFeeCents, 0);
  if (amountCents <= 0) return res.status(409).json({ error: "There is no positive PayMongo balance to pay out for this event." });
  const organizer = await prisma.user.findUnique({ where: { id: tournament.ownerId }, select: { payoutAccountEncrypted: true } });
  if (!organizer?.payoutAccountEncrypted) return res.status(409).json({ error: "The organizer must save payout bank details before payout." });
  const callbackUrl = process.env.PAYMONGO_PAYOUT_CALLBACK_URL;
  const callbackToken = process.env.PAYMONGO_PAYOUT_CALLBACK_TOKEN;
  if (!callbackUrl || !/^https:\/\//i.test(callbackUrl) || !callbackToken || callbackToken.length < 32) {
    return res.status(503).json({ error: "Secure PayMongo payout webhook configuration is required." });
  }
  let destinationAccount;
  try {
    destinationAccount = decryptPayoutAccount(organizer.payoutAccountEncrypted);
  } catch (error) {
    return res.status(503).json({ error: error instanceof Error ? error.message : "Saved payout details could not be read." });
  }
  const payout = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Tournament" WHERE "id" = ${tournament.id} FOR UPDATE`;
    const alreadyCreated = await tx.organizerPayout.findUnique({ where: { tournamentId: tournament.id }, select: { id: true } });
    if (alreadyCreated) return null;
    return tx.organizerPayout.create({
      data: { organizerId: tournament.ownerId!, tournamentId: tournament.id, amountCents, status: "PROCESSING" },
    });
  });
  if (!payout) return res.status(409).json({ error: "A payout request was already started for this event." });
  try {
    const transfer = await createPayMongoTransfer({
      amountCents,
      referenceNumber: `playwell-${payout.id}`,
      destinationAccount,
      callbackUrl: `${callbackUrl.replace(/\/+$/, "")}/${encodeURIComponent(callbackToken)}`,
    });
    await prisma.organizerPayout.update({
      where: { id: payout.id },
      data: { providerTransferId: transfer.transferId, transferFeeCents: transfer.feeCents },
    });
    await updatePayoutFromProvider(transfer.transferId, transfer.status.toLowerCase());
    const isTerminal = ["success", "successful", "paid", "completed", "failed", "cancelled", "canceled"].includes(transfer.status.toLowerCase());
    res.status(202).json({
      id: payout.id,
      status: transfer.status,
      amountCents,
      message: isTerminal ? "PayMongo returned a final transfer status. Refresh finance to see the reconciled result." : "PayMongo is processing the organizer payout. Status updates arrive through the configured callback.",
    });
  } catch (error) {
    await prisma.organizerPayout.update({
      where: { id: payout.id },
      data: { status: "FAILED", failureReason: error instanceof Error ? error.message.slice(0, 250) : "PayMongo transfer failed." },
    });
    console.error("Organizer payout request failed", error);
    res.status(502).json({ error: "PayMongo could not confirm the payout request. The payout is locked for reconciliation; do not retry until the provider status is checked." });
  }
});
