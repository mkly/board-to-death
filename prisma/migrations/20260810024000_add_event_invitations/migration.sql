CREATE TYPE "EventInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

CREATE TABLE "event_invitations" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "role" "EventMembershipRole" NOT NULL,
    "status" "EventInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "event_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "event_invitations_tokenHash_key" ON "event_invitations"("tokenHash");
CREATE INDEX "event_invitations_eventId_status_idx" ON "event_invitations"("eventId", "status");
CREATE INDEX "event_invitations_email_status_idx" ON "event_invitations"("email", "status");

ALTER TABLE "event_invitations"
ADD CONSTRAINT "event_invitations_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
