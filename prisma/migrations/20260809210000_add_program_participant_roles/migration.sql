CREATE TYPE "ProgramSessionParticipantRole" AS ENUM ('SPEAKER', 'MODERATOR', 'CHAIRPERSON');

ALTER TABLE "program_session_participants"
ADD COLUMN "role" "ProgramSessionParticipantRole" NOT NULL DEFAULT 'SPEAKER';

CREATE INDEX "program_session_participants_eventId_role_idx"
ON "program_session_participants"("eventId", "role");
