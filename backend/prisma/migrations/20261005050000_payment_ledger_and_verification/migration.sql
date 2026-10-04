CREATE TYPE "EventPaymentStatus" AS ENUM ('UNPAID', 'PENDING', 'PAID', 'VERIFIED', 'FAILED', 'REFUNDED');
CREATE TYPE "PaymentLedgerType" AS ENUM ('EVENT_PAYMENT', 'PLATFORM_COMMISSION', 'PROCESSING_FEE', 'ORGANIZER_PAYOUT', 'SUBSCRIPTION_PAYMENT', 'REFUND');
CREATE TYPE "OrganizerPayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'FAILED');
ALTER TYPE "PaymentLedgerType" ADD VALUE 'OFFLINE_EVENT_PAYMENT';
ALTER TYPE "PaymentLedgerType" ADD VALUE 'ACCRUED_PLATFORM_COMMISSION';

ALTER TABLE "PlatformSetting" ADD COLUMN "eventCommissionBps" INTEGER NOT NULL DEFAULT 500;
ALTER TABLE "User" ADD COLUMN "payoutAccountEncrypted" TEXT;
ALTER TABLE "User" ADD COLUMN "subscriptionPaymentAmountCents" INTEGER;
ALTER TABLE "TournamentPost" ADD COLUMN "entryFeeCents" INTEGER;
ALTER TABLE "RegistrationSubmission"
    ADD COLUMN "paymentStatus" "EventPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    ADD COLUMN "paymentVerifiedAt" TIMESTAMP(3),
    ADD COLUMN "paymentVerifiedById" TEXT,
    ADD COLUMN "paymentVerificationNote" TEXT;

CREATE TABLE "EventPayment" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "referenceNumber" TEXT NOT NULL,
    "providerCheckoutId" TEXT,
    "providerCheckoutUrl" TEXT,
    "providerPaymentId" TEXT,
    "status" "EventPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "grossAmountCents" INTEGER NOT NULL,
    "commissionCents" INTEGER NOT NULL,
    "processingFeeCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EventPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganizerPayout" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "transferFeeCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "status" "OrganizerPayoutStatus" NOT NULL DEFAULT 'PENDING',
    "providerTransferId" TEXT,
    "failureReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    CONSTRAINT "OrganizerPayout_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentLedgerEntry" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "type" "PaymentLedgerType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "description" TEXT NOT NULL,
    "eventPaymentId" TEXT,
    "registrationId" TEXT,
    "payoutId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventPayment_referenceNumber_key" ON "EventPayment"("referenceNumber");
CREATE UNIQUE INDEX "EventPayment_providerCheckoutId_key" ON "EventPayment"("providerCheckoutId");
CREATE UNIQUE INDEX "EventPayment_providerPaymentId_key" ON "EventPayment"("providerPaymentId");
CREATE INDEX "EventPayment_registrationId_status_idx" ON "EventPayment"("registrationId", "status");
CREATE INDEX "EventPayment_status_createdAt_idx" ON "EventPayment"("status", "createdAt");
CREATE UNIQUE INDEX "OrganizerPayout_tournamentId_key" ON "OrganizerPayout"("tournamentId");
CREATE UNIQUE INDEX "OrganizerPayout_providerTransferId_key" ON "OrganizerPayout"("providerTransferId");
CREATE INDEX "OrganizerPayout_organizerId_status_idx" ON "OrganizerPayout"("organizerId", "status");
CREATE UNIQUE INDEX "PaymentLedgerEntry_idempotencyKey_key" ON "PaymentLedgerEntry"("idempotencyKey");
CREATE INDEX "PaymentLedgerEntry_type_createdAt_idx" ON "PaymentLedgerEntry"("type", "createdAt");
CREATE INDEX "PaymentLedgerEntry_registrationId_idx" ON "PaymentLedgerEntry"("registrationId");

ALTER TABLE "RegistrationSubmission" ADD CONSTRAINT "RegistrationSubmission_paymentVerifiedById_fkey"
    FOREIGN KEY ("paymentVerifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EventPayment" ADD CONSTRAINT "EventPayment_registrationId_fkey"
    FOREIGN KEY ("registrationId") REFERENCES "RegistrationSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizerPayout" ADD CONSTRAINT "OrganizerPayout_organizerId_fkey"
    FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrganizerPayout" ADD CONSTRAINT "OrganizerPayout_tournamentId_fkey"
    FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentLedgerEntry" ADD CONSTRAINT "PaymentLedgerEntry_eventPaymentId_fkey"
    FOREIGN KEY ("eventPaymentId") REFERENCES "EventPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentLedgerEntry" ADD CONSTRAINT "PaymentLedgerEntry_registrationId_fkey"
    FOREIGN KEY ("registrationId") REFERENCES "RegistrationSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentLedgerEntry" ADD CONSTRAINT "PaymentLedgerEntry_payoutId_fkey"
    FOREIGN KEY ("payoutId") REFERENCES "OrganizerPayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentLedgerEntry" ADD CONSTRAINT "PaymentLedgerEntry_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
