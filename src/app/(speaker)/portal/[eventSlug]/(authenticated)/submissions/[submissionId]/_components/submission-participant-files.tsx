"use client";

import { SpeakerFileControl } from "../../../_components/speaker-file-control";
import { removeSubmissionFile, uploadSubmissionFile } from "../actions";

export function SubmissionParticipantFiles({
  eventSlug,
  submissionId,
  slidesObjectKey,
  supportingDocumentObjectKey,
}: {
  readonly eventSlug: string;
  readonly submissionId: string;
  readonly slidesObjectKey: string | null;
  readonly supportingDocumentObjectKey: string | null;
}) {
  const base = `/portal/${encodeURIComponent(eventSlug)}/submissions/${encodeURIComponent(submissionId)}/files`;

  return (
    <div className="flex flex-col gap-3">
      <SpeakerFileControl
        id="submission-file-slides"
        label="Slides"
        description="PDF or PPTX, up to 50 MB."
        accept="application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        hasFile={Boolean(slidesObjectKey)}
        downloadHref={`${base}/slides`}
        uploadAction={uploadSubmissionFile.bind(null, eventSlug, submissionId, "slides")}
        removeAction={removeSubmissionFile.bind(null, eventSlug, submissionId, "slides")}
      />
      <SpeakerFileControl
        id="submission-file-supporting-document"
        label="Supporting document"
        description="PDF, DOCX, or plain text, up to 20 MB."
        accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
        hasFile={Boolean(supportingDocumentObjectKey)}
        downloadHref={`${base}/supportingDocument`}
        uploadAction={uploadSubmissionFile.bind(null, eventSlug, submissionId, "supportingDocument")}
        removeAction={removeSubmissionFile.bind(null, eventSlug, submissionId, "supportingDocument")}
      />
    </div>
  );
}
