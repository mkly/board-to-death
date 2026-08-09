import {
  CfpPolicyStatus,
  CfpSubmissionKind,
  CfpSubmissionRevisionKind,
  CfpSubmissionStatus,
  EventType,
  type PrismaClient,
  ProgramSessionKind,
  SpeakerTaskAssignmentStatus,
} from "../../generated/prisma/client.ts";

/**
 * The seeded profile the performance budgets are measured against.
 *
 * `performance/budgets.json` records the same numbers; a budget measured at one
 * profile says nothing about another, so the two move together or not at all.
 */
export const BENCHMARK_PROFILE = {
  eventSlug: "board-to-death-benchmark",
  speakers: 1_000,
  submissions: 10_000,
  sessions: 500,
  rooms: 20,
  tracks: 20,
  resourcePages: 8,
  /** Sessions scheduled per room per day; 20 rooms × 9 × 3 days covers 500. */
  slotsPerDay: 9,
  days: 3,
} as const;

/** Rows per `createMany` call. Large enough to stay cheap, small enough to stay under parameter limits. */
const BATCH_SIZE = 1_000;

/**
 * Deterministic UUIDs, namespaced per entity so a rerun produces byte-identical
 * identifiers and two entities can never collide. The `2` prefix keeps the whole
 * benchmark event clear of `representative-fixtures.ts`, which owns `0`.
 */
function uuid(namespace: number, index: number): string {
  return `2${namespace.toString().padStart(3, "0")}0000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

const NS = {
  event: 1,
  room: 2,
  track: 3,
  form: 4,
  formVersion: 5,
  formStep: 6,
  question: 7,
  category: 8,
  policy: 9,
  taskDefinition: 10,
  taskDefinitionVersion: 11,
  speaker: 12,
  profileVersion: 13,
  submission: 14,
  revision: 15,
  answer: 16,
  session: 17,
  sessionVersion: 18,
  placement: 19,
  taskAssignment: 20,
  resourcePage: 21,
  resourcePageVersion: 22,
} as const;

const EVENT_ID = uuid(NS.event, 1);
const FORM_VERSION_ID = uuid(NS.formVersion, 1);
const CATEGORY_ID = uuid(NS.category, 1);
const TASK_DEFINITION_ID = uuid(NS.taskDefinition, 1);
const TASK_DEFINITION_VERSION_ID = uuid(NS.taskDefinitionVersion, 1);
const POLICY_PUBLIC_ID = uuid(NS.policy, 2);

/** Day 0 of the benchmark event. UTC throughout so slot arithmetic needs no zone rules. */
const EVENT_START = new Date("2027-06-01T09:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1_000;
const SESSION_MINUTES = 45;

export interface BenchmarkFixtureResult {
  readonly eventId: string;
  readonly eventSlug: string;
  readonly cfpPublicId: string;
  readonly speakerIds: readonly string[];
  readonly counts: {
    readonly speakers: number;
    readonly submissions: number;
    readonly sessions: number;
  };
}

/** Start of a placement: 20 rooms fill each hour slot, so index / rooms picks the slot. */
function placementStart(index: number): Date {
  const slot = Math.floor(index / BENCHMARK_PROFILE.rooms);
  const day = Math.floor(slot / BENCHMARK_PROFILE.slotsPerDay);
  const hour = slot % BENCHMARK_PROFILE.slotsPerDay;
  return new Date(EVENT_START.getTime() + day * DAY_MS + hour * 60 * 60 * 1_000);
}

async function insertBatched<T>(rows: readonly T[], insert: (batch: T[]) => Promise<unknown>): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    await insert(rows.slice(offset, offset + BATCH_SIZE));
  }
}

/**
 * Seeds the benchmark event: 1000 speakers, 10000 submissions with answers and
 * uploaded-file keys, 500 scheduled sessions, and the speaker tasks and resource
 * pages the portal renders.
 *
 * The schedule is laid out so it contains no agenda conflicts — one room and one
 * track per concurrent placement, one session per speaker — because a conflict
 * storm would measure the conflict renderer rather than the read path.
 *
 * Re-running deletes and recreates the event, so the profile is reproducible.
 */
export async function createBenchmarkFixtures(client: PrismaClient): Promise<BenchmarkFixtureResult> {
  const { speakers, submissions, sessions, rooms, tracks, resourcePages } = BENCHMARK_PROFILE;

  const existing = await client.event.findUnique({
    where: { slug: BENCHMARK_PROFILE.eventSlug },
    select: { id: true },
  });
  if (existing) await client.event.delete({ where: { id: existing.id } });

  await client.event.create({
    data: {
      id: EVENT_ID,
      name: "Board to Death Benchmark 2027",
      slug: BENCHMARK_PROFILE.eventSlug,
      type: EventType.CONFERENCE,
      location: "Benchmark Hall",
      timezone: "UTC",
      startsAt: EVENT_START,
      endsAt: new Date(EVENT_START.getTime() + (BENCHMARK_PROFILE.days - 1) * DAY_MS + 12 * 60 * 60 * 1_000),
      theme: "Reads that stay flat as the program grows",
      rooms: {
        create: Array.from({ length: rooms }, (_unused, index) => ({
          id: uuid(NS.room, index + 1),
          name: `Room ${index + 1}`,
          sortOrder: index,
        })),
      },
      tracks: {
        create: Array.from({ length: tracks }, (_unused, index) => ({
          id: uuid(NS.track, index + 1),
          name: `Track ${index + 1}`,
          color: "blue",
          sortOrder: index,
        })),
      },
      cfpCategories: {
        create: { id: CATEGORY_ID, key: "benchmark", label: "Benchmark", description: "The benchmark category." },
      },
      cfpForms: {
        create: {
          id: uuid(NS.form, 1),
          key: "benchmark-cfp",
          versions: {
            create: {
              id: FORM_VERSION_ID,
              versionNumber: 1,
              schemaVersion: 1,
              title: "Board to Death Benchmark call for proposals",
              description: "The form the benchmark submissions answer.",
              customTypes: [],
              categories: [{ id: "benchmark", label: "Benchmark" }],
              steps: {
                create: [
                  {
                    id: uuid(NS.formStep, 1),
                    key: "speaker",
                    kind: "speaker",
                    title: "Speaker",
                    sortOrder: 0,
                    questions: {
                      create: {
                        id: uuid(NS.question, 1),
                        key: "speaker-name",
                        type: "short_text",
                        label: "Full name",
                        required: true,
                        constraints: { minLength: 2, maxLength: 100 },
                        sortOrder: 0,
                      },
                    },
                  },
                  {
                    id: uuid(NS.formStep, 2),
                    key: "proposal",
                    kind: "questions",
                    title: "Proposal",
                    sortOrder: 1,
                    questions: {
                      create: [
                        {
                          id: uuid(NS.question, 2),
                          key: "abstract",
                          type: "long_text",
                          label: "Abstract",
                          required: true,
                          constraints: { minLength: 20, maxLength: 1_500 },
                          sortOrder: 0,
                        },
                        {
                          id: uuid(NS.question, 3),
                          key: "audience",
                          type: "short_text",
                          label: "Intended audience",
                          required: true,
                          constraints: { minLength: 2, maxLength: 200 },
                          sortOrder: 1,
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      },
      speakerTaskDefinitions: {
        create: {
          id: TASK_DEFINITION_ID,
          key: "confirm-details",
          versions: {
            create: {
              id: TASK_DEFINITION_VERSION_ID,
              versionNumber: 1,
              sortOrder: 0,
              title: "Confirm your session details",
              description: "Check the title, abstract, and scheduling shown to attendees.",
              applicability: { sessionKinds: [ProgramSessionKind.PROMOTED] },
              defaultDueOffsetDays: 14,
              responseRequired: false,
            },
          },
        },
      },
    },
  });

  await client.cfpPolicy.create({
    data: {
      id: uuid(NS.policy, 1),
      eventId: EVENT_ID,
      key: "benchmark-policy",
      publicId: POLICY_PUBLIC_ID,
      status: CfpPolicyStatus.PUBLISHED,
      publishedFormVersionId: FORM_VERSION_ID,
    },
  });

  const speakerIds = Array.from({ length: speakers }, (_unused, index) => uuid(NS.speaker, index + 1));

  await insertBatched(
    speakerIds.map((id, index) => ({ id, eventId: EVENT_ID, normalizedEmail: `speaker-${index + 1}@example.test` })),
    (batch) => client.speaker.createMany({ data: batch }),
  );

  await insertBatched(
    speakerIds.map((speakerId, index) => ({
      id: uuid(NS.profileVersion, index + 1),
      speakerId,
      versionNumber: 1,
      email: `speaker-${index + 1}@example.test`,
      givenName: `Speaker${index + 1}`,
      familyName: "Benchmark",
      preferredName: `Speaker ${index + 1}`,
      organization: `Studio ${(index % 50) + 1}`,
      jobTitle: "Game designer",
      biography: `Speaker ${index + 1} builds tabletop systems and writes about play testing them.`,
      consentToPublishProfile: true,
      consentToReceiveEmail: true,
      consentedAt: EVENT_START,
    })),
    (batch) => client.speakerProfileVersion.createMany({ data: batch }),
  );

  // Every fifth submission stays in review and every tenth is rejected, so the
  // admin table's status filters and counts have something to do.
  const statusFor = (index: number): CfpSubmissionStatus => {
    if (index < sessions) return CfpSubmissionStatus.ACCEPTED;
    if (index % 10 === 0) return CfpSubmissionStatus.REJECTED;
    if (index % 5 === 0) return CfpSubmissionStatus.UNDER_REVIEW;
    return CfpSubmissionStatus.SUBMITTED;
  };

  // `cfp_submissions_status_timestamps` requires each status to carry exactly
  // the timestamps that status implies, so they are derived from it.
  const REVIEWED = new Set<CfpSubmissionStatus>([
    CfpSubmissionStatus.UNDER_REVIEW,
    CfpSubmissionStatus.ACCEPTED,
    CfpSubmissionStatus.REJECTED,
  ]);
  const DECIDED = new Set<CfpSubmissionStatus>([CfpSubmissionStatus.ACCEPTED, CfpSubmissionStatus.REJECTED]);

  await insertBatched(
    Array.from({ length: submissions }, (_unused, index) => {
      const status = statusFor(index);
      const submittedAt = new Date(EVENT_START.getTime() - (submissions - index) * 60_000);
      return {
        id: uuid(NS.submission, index + 1),
        eventId: EVENT_ID,
        formVersionId: FORM_VERSION_ID,
        kind: CfpSubmissionKind.ABSTRACT,
        status,
        submittedAt,
        reviewStartedAt: REVIEWED.has(status) ? new Date(submittedAt.getTime() + 60_000) : null,
        decidedAt: DECIDED.has(status) ? new Date(submittedAt.getTime() + 120_000) : null,
      };
    }),
    (batch) => client.cfpSubmission.createMany({ data: batch }),
  );

  await insertBatched(
    Array.from({ length: submissions }, (_unused, index) => ({
      id: uuid(NS.revision, index + 1),
      submissionId: uuid(NS.submission, index + 1),
      versionNumber: 1,
      kind: CfpSubmissionRevisionKind.FINAL,
      formVersionId: FORM_VERSION_ID,
      definitionSnapshot: { title: "Board to Death Benchmark call for proposals", schemaVersion: 1 },
    })),
    (batch) => client.cfpSubmissionRevision.createMany({ data: batch }),
  );

  await insertBatched(
    Array.from({ length: submissions }, (_unused, index) => index).flatMap((index) => [
      {
        id: uuid(NS.answer, index * 2 + 1),
        revisionId: uuid(NS.revision, index + 1),
        questionId: "abstract",
        sortOrder: 0,
        value: `Proposal ${index + 1}: a playtest-first method for teaching an asymmetric system in one session.`,
      },
      {
        id: uuid(NS.answer, index * 2 + 2),
        revisionId: uuid(NS.revision, index + 1),
        questionId: "audience",
        sortOrder: 1,
        value: "Designers who have shipped at least one game.",
      },
    ]),
    (batch) => client.cfpSubmissionAnswer.createMany({ data: batch }),
  );

  await insertBatched(
    Array.from({ length: submissions }, (_unused, index) => ({
      eventId: EVENT_ID,
      submissionId: uuid(NS.submission, index + 1),
      speakerId: speakerIds[index % speakers] as string,
      sortOrder: 0,
      // Representative uploads: the object keys the file storage layer stores,
      // never file contents.
      slidesObjectKey: `events/${EVENT_ID}/submissions/${index + 1}/slides.pdf`,
      supportingDocumentObjectKey: index % 3 === 0 ? `events/${EVENT_ID}/submissions/${index + 1}/notes.pdf` : null,
    })),
    (batch) => client.cfpSubmissionParticipant.createMany({ data: batch }),
  );

  await insertBatched(
    Array.from({ length: submissions }, (_unused, index) => ({
      eventId: EVENT_ID,
      submissionId: uuid(NS.submission, index + 1),
      categoryId: CATEGORY_ID,
      sortOrder: 0,
    })),
    (batch) => client.cfpSubmissionCategory.createMany({ data: batch }),
  );

  await insertBatched(
    Array.from({ length: sessions }, (_unused, index) => ({
      id: uuid(NS.session, index + 1),
      eventId: EVENT_ID,
      kind: ProgramSessionKind.PROMOTED,
      sourceSubmissionId: uuid(NS.submission, index + 1),
    })),
    (batch) => client.programSession.createMany({ data: batch }),
  );

  await insertBatched(
    Array.from({ length: sessions }, (_unused, index) => ({
      id: uuid(NS.sessionVersion, index + 1),
      eventId: EVENT_ID,
      sessionId: uuid(NS.session, index + 1),
      versionNumber: 1,
      title: `Session ${index + 1}: teaching an asymmetric system`,
      description: "A playtesting-first walk through one system, its failure modes, and its fixes.",
      durationMinutes: SESSION_MINUTES,
      // One track per concurrent placement keeps the schedule conflict-free.
      trackId: uuid(NS.track, (index % tracks) + 1),
    })),
    (batch) => client.programSessionVersion.createMany({ data: batch }),
  );

  await insertBatched(
    Array.from({ length: sessions }, (_unused, index) => ({
      eventId: EVENT_ID,
      sessionVersionId: uuid(NS.sessionVersion, index + 1),
      speakerId: speakerIds[index % speakers] as string,
      sortOrder: 0,
    })),
    (batch) => client.programSessionParticipant.createMany({ data: batch }),
  );

  await insertBatched(
    Array.from({ length: sessions }, (_unused, index) => {
      const startsAt = placementStart(index);
      return {
        id: uuid(NS.placement, index + 1),
        eventId: EVENT_ID,
        sessionId: uuid(NS.session, index + 1),
        roomId: uuid(NS.room, (index % rooms) + 1),
        startsAt,
        endsAt: new Date(startsAt.getTime() + SESSION_MINUTES * 60_000),
      };
    }),
    (batch) => client.agendaPlacement.createMany({ data: batch }),
  );

  await insertBatched(
    Array.from({ length: sessions }, (_unused, index) => ({
      eventId: EVENT_ID,
      placementId: uuid(NS.placement, index + 1),
      trackId: uuid(NS.track, (index % tracks) + 1),
      sortOrder: 0,
    })),
    (batch) => client.agendaPlacementTrack.createMany({ data: batch }),
  );

  await insertBatched(
    Array.from({ length: sessions }, (_unused, index) => ({
      eventId: EVENT_ID,
      placementId: uuid(NS.placement, index + 1),
      speakerId: speakerIds[index % speakers] as string,
      sortOrder: 0,
    })),
    (batch) => client.agendaPlacementSpeaker.createMany({ data: batch }),
  );

  await insertBatched(
    // `speaker_task_assignments_due_after_assignment` requires dueAt >= assignedAt,
    // and `speaker_task_assignments_status_timestamps` requires an APPROVED row to
    // carry both submittedAt and completedAt.
    speakerIds.map((speakerId, index) => {
      const approved = index % 4 === 0;
      return {
        id: uuid(NS.taskAssignment, index + 1),
        eventId: EVENT_ID,
        definitionId: TASK_DEFINITION_ID,
        definitionVersionId: TASK_DEFINITION_VERSION_ID,
        speakerId,
        status: approved ? SpeakerTaskAssignmentStatus.APPROVED : SpeakerTaskAssignmentStatus.PENDING,
        assignedAt: new Date(EVENT_START.getTime() - 30 * DAY_MS),
        dueAt: new Date(EVENT_START.getTime() - 7 * DAY_MS),
        ...(approved
          ? {
              submittedAt: new Date(EVENT_START.getTime() - 14 * DAY_MS),
              completedAt: new Date(EVENT_START.getTime() - 10 * DAY_MS),
            }
          : {}),
      };
    }),
    (batch) => client.speakerTaskAssignment.createMany({ data: batch }),
  );

  await client.speakerResourcePage.createMany({
    data: Array.from({ length: resourcePages }, (_unused, index) => ({
      id: uuid(NS.resourcePage, index + 1),
      eventId: EVENT_ID,
      key: `resource-${index + 1}`,
    })),
  });

  await client.speakerResourcePageVersion.createMany({
    data: Array.from({ length: resourcePages }, (_unused, index) => ({
      id: uuid(NS.resourcePageVersion, index + 1),
      eventId: EVENT_ID,
      pageId: uuid(NS.resourcePage, index + 1),
      versionNumber: 1,
      slug: `resource-${index + 1}`,
      title: `Speaker resource ${index + 1}`,
      summary: "What speakers need before the event.",
      bodyMarkdown: "## Before you arrive\n\nCheck your session time, upload your slides, and confirm your travel.",
      sortOrder: index,
      publishedAt: EVENT_START,
    })),
  });

  return {
    eventId: EVENT_ID,
    eventSlug: BENCHMARK_PROFILE.eventSlug,
    cfpPublicId: POLICY_PUBLIC_ID,
    speakerIds,
    counts: { speakers, submissions, sessions },
  };
}
