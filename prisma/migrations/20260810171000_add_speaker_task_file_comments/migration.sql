CREATE TYPE "SpeakerTaskFileCommentAuthorRole" AS ENUM ('ORGANIZER', 'SPEAKER');

CREATE TABLE "speaker_task_file_comments" (
    "id" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "authorRole" "SpeakerTaskFileCommentAuthorRole" NOT NULL,
    "authorLabel" TEXT NOT NULL,
    "authorUserId" TEXT,
    "authorSpeakerId" UUID,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "speaker_task_file_comments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "speaker_task_file_comments_author_check" CHECK (
      ("authorRole" = 'ORGANIZER' AND "authorSpeakerId" IS NULL)
      OR ("authorRole" = 'SPEAKER' AND "authorUserId" IS NULL)
    )
);

CREATE INDEX "speaker_task_file_comments_submissionId_createdAt_idx"
ON "speaker_task_file_comments"("submissionId", "createdAt");
CREATE INDEX "speaker_task_file_comments_authorUserId_idx" ON "speaker_task_file_comments"("authorUserId");
CREATE INDEX "speaker_task_file_comments_authorSpeakerId_idx" ON "speaker_task_file_comments"("authorSpeakerId");

ALTER TABLE "speaker_task_file_comments" ADD CONSTRAINT "speaker_task_file_comments_submissionId_fkey"
FOREIGN KEY ("submissionId") REFERENCES "speaker_task_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "speaker_task_file_comments" ADD CONSTRAINT "speaker_task_file_comments_authorUserId_fkey"
FOREIGN KEY ("authorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "speaker_task_file_comments" ADD CONSTRAINT "speaker_task_file_comments_authorSpeakerId_fkey"
FOREIGN KEY ("authorSpeakerId") REFERENCES "speakers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
