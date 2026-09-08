-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "bio" TEXT DEFAULT '',
    "avatarUrl" TEXT,
    "defaultAvatarKey" TEXT NOT NULL DEFAULT 'panda',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentPost" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "details" TEXT,
    "location" TEXT NOT NULL,
    "amount" TEXT,
    "registrationLink" TEXT,
    "registrationFields" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentPhoto" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "storedFile" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationSubmission" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "answers" JSONB,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistrationSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "TournamentPhoto_postId_idx" ON "TournamentPhoto"("postId");

-- CreateIndex
CREATE INDEX "TournamentPhoto_uploadedAt_idx" ON "TournamentPhoto"("uploadedAt");

-- CreateIndex
CREATE INDEX "RegistrationSubmission_postId_idx" ON "RegistrationSubmission"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationSubmission_postId_userId_key" ON "RegistrationSubmission"("postId", "userId");

-- AddForeignKey
ALTER TABLE "TournamentPost" ADD CONSTRAINT "TournamentPost_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentPhoto" ADD CONSTRAINT "TournamentPhoto_postId_fkey" FOREIGN KEY ("postId") REFERENCES "TournamentPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationSubmission" ADD CONSTRAINT "RegistrationSubmission_postId_fkey" FOREIGN KEY ("postId") REFERENCES "TournamentPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationSubmission" ADD CONSTRAINT "RegistrationSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
