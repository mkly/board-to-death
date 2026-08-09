CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'RETRY_SCHEDULED', 'DELIVERED', 'FAILED');

CREATE TABLE "api_tokens" (
  "id" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "prefix" TEXT NOT NULL,
  "secretHash" TEXT NOT NULL,
  "scopes" JSONB NOT NULL,
  "lastUsedAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "webhook_endpoints" (
  "id" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "signingSecret" TEXT NOT NULL,
  "events" JSONB NOT NULL,
  "disabledAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "webhook_deliveries" (
  "id" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "endpointId" UUID NOT NULL,
  "eventType" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(3),
  "responseStatus" INTEGER,
  "error" TEXT,
  "deliveredAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "api_tokens_secretHash_key" ON "api_tokens"("secretHash");
CREATE UNIQUE INDEX "api_tokens_eventId_id_key" ON "api_tokens"("eventId", "id");
CREATE INDEX "api_tokens_eventId_revokedAt_createdAt_idx" ON "api_tokens"("eventId", "revokedAt", "createdAt");
CREATE UNIQUE INDEX "webhook_endpoints_eventId_id_key" ON "webhook_endpoints"("eventId", "id");
CREATE INDEX "webhook_endpoints_eventId_disabledAt_createdAt_idx" ON "webhook_endpoints"("eventId", "disabledAt", "createdAt");
CREATE INDEX "webhook_deliveries_eventId_createdAt_idx" ON "webhook_deliveries"("eventId", "createdAt");
CREATE INDEX "webhook_deliveries_status_nextAttemptAt_idx" ON "webhook_deliveries"("status", "nextAttemptAt");

ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_eventId_endpointId_fkey" FOREIGN KEY ("eventId", "endpointId") REFERENCES "webhook_endpoints"("eventId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
