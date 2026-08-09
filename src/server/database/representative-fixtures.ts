import {
  CfpSubmissionKind,
  CfpSubmissionRevisionKind,
  CfpSubmissionStatus,
  CfpSubmissionTransitionActor,
  EvaluationPlanVersionStatus,
  EvaluationReviewerStatus,
  EvaluationRoundStatus,
  EventType,
  IntegrationProvider,
  IntegrationRemoteRecordStatus,
  IntegrationSyncRecordStatus,
  IntegrationSyncRunStatus,
  type PrismaClient,
  ProgramSessionKind,
  ReviewerVisibility,
  SpeakerTaskAssignmentStatus,
} from "../../generated/prisma/client.ts";

const id = (suffix: number): string => `00000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;

export const representativeFixture = {
  eventId: id(1),
  eventSlug: "board-to-death-demo",
  roomId: id(2),
  formId: id(4),
  formVersionId: id(5),
  trackId: id(6),
  categoryId: id(8),
  speakerId: id(9),
  submissionId: id(11),
  sessionId: id(15),
  evaluationPlanId: id(17),
  reviewerId: id(21),
  taskDefinitionId: id(23),
  agendaPlacementId: id(31),
  integrationConfigurationId: id(32),
} as const;

export interface RepresentativeFixtureResult {
  readonly eventId: string;
  readonly eventSlug: string;
  readonly submissionId: string;
  readonly speakerId: string;
  readonly sessionId: string;
  readonly agendaPlacementId: string;
  readonly integrationConfigurationId: string;
}

export async function createRepresentativeFixtures(client: PrismaClient): Promise<RepresentativeFixtureResult> {
  const fixture = representativeFixture;

  await client.$transaction(async (transaction) => {
    const existingEvent = await transaction.event.findUnique({
      where: { slug: fixture.eventSlug },
      select: { id: true },
    });
    if (existingEvent) {
      await transaction.integrationSyncRecord.deleteMany({ where: { eventId: existingEvent.id } });
      await transaction.event.delete({ where: { id: existingEvent.id } });
    }

    await transaction.event.create({
      data: {
        id: fixture.eventId,
        name: "Board to Death Demo 2027",
        slug: fixture.eventSlug,
        type: EventType.CONFERENCE,
        websiteUrl: "https://example.test/board-to-death-demo",
        location: "Oakland, CA",
        timezone: "America/Los_Angeles",
        startsAt: new Date("2027-03-13T17:00:00.000Z"),
        endsAt: new Date("2027-03-15T00:00:00.000Z"),
        theme: "Designing memorable tabletop experiences",
        exhibitorsEnabled: true,
        sponsorsEnabled: true,
        rooms: {
          create: [
            { id: id(2), name: "Main Hall", sortOrder: 0 },
            { id: id(3), name: "Design Studio", sortOrder: 1 },
          ],
        },
        tracks: {
          create: [
            { id: id(6), name: "Game Design", color: "blue", sortOrder: 0 },
            { id: id(7), name: "Community", color: "violet", sortOrder: 1 },
          ],
        },
        cfpCategories: {
          create: {
            id: fixture.categoryId,
            key: "game-design",
            label: "Game design",
            description: "Mechanics, systems, playtesting, and iteration.",
          },
        },
        cfpForms: {
          create: {
            id: fixture.formId,
            key: "main-cfp",
            versions: {
              create: {
                id: fixture.formVersionId,
                versionNumber: 1,
                schemaVersion: 1,
                title: "Board to Death 2027 call for proposals",
                description: "Share a practical session for tabletop creators.",
                customTypes: [],
                categories: [{ id: "game-design", label: "Game design" }],
                steps: {
                  create: [
                    {
                      id: id(25),
                      key: "speaker",
                      kind: "speaker",
                      title: "Speaker",
                      sortOrder: 0,
                      questions: {
                        create: {
                          id: id(26),
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
                      id: id(27),
                      key: "proposal",
                      kind: "questions",
                      title: "Proposal",
                      sortOrder: 1,
                      questions: {
                        create: {
                          id: id(28),
                          key: "abstract",
                          type: "long_text",
                          label: "Abstract",
                          required: true,
                          constraints: { minLength: 20, maxLength: 1_500 },
                          sortOrder: 0,
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
        speakers: {
          create: {
            id: fixture.speakerId,
            normalizedEmail: "ada@example.test",
            profileVersions: {
              create: {
                id: id(10),
                versionNumber: 1,
                email: "ada@example.test",
                givenName: "Ada",
                familyName: "Lovelace",
                preferredName: "Ada",
                organization: "Analytical Games",
                jobTitle: "Systems designer",
                biography: "Ada designs games that make complex systems approachable.",
                websiteUrl: "https://example.test/speakers/ada",
                consentToPublishProfile: true,
                consentToReceiveEmail: true,
                consentedAt: new Date("2027-01-10T18:00:00.000Z"),
              },
            },
          },
        },
        evaluationPlans: {
          create: {
            id: fixture.evaluationPlanId,
            key: "main-evaluation",
            versions: {
              create: {
                id: id(18),
                versionNumber: 1,
                title: "Program review",
                description: "A concise, practical review rubric.",
                status: EvaluationPlanVersionStatus.DRAFT,
                rounds: {
                  create: {
                    id: id(19),
                    key: "program-fit",
                    title: "Program fit",
                    sortOrder: 0,
                    status: EvaluationRoundStatus.CLOSED,
                    reviewerVisibility: ReviewerVisibility.BLIND,
                    visibilitySnapshot: ReviewerVisibility.BLIND,
                    opensAt: new Date("2027-01-15T18:00:00.000Z"),
                    closesAt: new Date("2027-02-15T18:00:00.000Z"),
                    transitions: {
                      create: [
                        {
                          id: id(39),
                          toStatus: EvaluationRoundStatus.PLANNED,
                          occurredAt: new Date("2027-01-10T18:00:00.000Z"),
                        },
                        {
                          id: id(40),
                          fromStatus: EvaluationRoundStatus.PLANNED,
                          toStatus: EvaluationRoundStatus.OPEN,
                          occurredAt: new Date("2027-01-15T18:00:00.000Z"),
                        },
                        {
                          id: id(41),
                          fromStatus: EvaluationRoundStatus.OPEN,
                          toStatus: EvaluationRoundStatus.CLOSED,
                          occurredAt: new Date("2027-02-15T18:00:00.000Z"),
                        },
                      ],
                    },
                    criteria: {
                      create: {
                        id: id(20),
                        key: "clarity",
                        label: "Clarity",
                        description: "The audience and learning outcome are clear.",
                        sortOrder: 0,
                        weight: 1,
                        minimum: 1,
                        maximum: 5,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        evaluationReviewers: {
          create: {
            id: fixture.reviewerId,
            identityId: "demo-reviewer",
            email: "reviewer@example.test",
            displayName: "Grace Reviewer",
            status: EvaluationReviewerStatus.ACTIVE,
          },
        },
        speakerTaskDefinitions: {
          create: {
            id: fixture.taskDefinitionId,
            key: "publish-profile",
            versions: {
              create: {
                id: id(24),
                versionNumber: 1,
                sortOrder: 0,
                title: "Review your public profile",
                description: "Confirm the biography and publication consent shown to attendees.",
                applicability: { sessionKinds: [ProgramSessionKind.PROMOTED] },
                defaultDueOffsetDays: 14,
                responseRequired: true,
                responseSchema: { type: "object", required: ["approved"] },
              },
            },
          },
        },
      },
    });

    await transaction.evaluationPlanVersion.update({
      where: { id: id(18) },
      data: {
        status: EvaluationPlanVersionStatus.ACTIVE,
        activatedAt: new Date("2027-01-15T18:00:00.000Z"),
      },
    });

    await transaction.cfpSubmission.create({
      data: {
        id: fixture.submissionId,
        eventId: fixture.eventId,
        formVersionId: fixture.formVersionId,
        kind: CfpSubmissionKind.ABSTRACT,
        status: CfpSubmissionStatus.ACCEPTED,
        submittedAt: new Date("2027-01-20T18:00:00.000Z"),
        reviewStartedAt: new Date("2027-02-01T18:00:00.000Z"),
        decidedAt: new Date("2027-02-20T18:00:00.000Z"),
        revisions: {
          create: {
            id: id(12),
            versionNumber: 1,
            kind: CfpSubmissionRevisionKind.FINAL,
            formVersionId: fixture.formVersionId,
            definitionSnapshot: { title: "Board to Death 2027 call for proposals", schemaVersion: 1 },
            answers: {
              create: {
                id: id(13),
                questionId: "abstract",
                sortOrder: 0,
                value: "A practical method for iterating on asymmetric game systems.",
              },
            },
          },
        },
        categories: { create: { categoryId: fixture.categoryId, sortOrder: 0 } },
        participants: { create: { speakerId: fixture.speakerId, sortOrder: 0 } },
        transitions: {
          create: {
            id: id(14),
            fromStatus: CfpSubmissionStatus.SUBMITTED,
            toStatus: CfpSubmissionStatus.ACCEPTED,
            actor: CfpSubmissionTransitionActor.ADMIN,
            actorId: "demo-admin",
            note: "Selected for the representative program.",
            occurredAt: new Date("2027-02-20T18:00:00.000Z"),
          },
        },
      },
    });

    await transaction.programSession.create({
      data: {
        id: fixture.sessionId,
        eventId: fixture.eventId,
        kind: ProgramSessionKind.PROMOTED,
        sourceSubmissionId: fixture.submissionId,
      },
    });

    await transaction.programSessionVersion.create({
      data: {
        id: id(16),
        eventId: fixture.eventId,
        sessionId: fixture.sessionId,
        versionNumber: 1,
        title: "Designing asymmetric systems players can learn",
        description: "A playtesting-first approach to complexity.",
        durationMinutes: 45,
        trackId: id(6),
      },
    });

    await transaction.programSessionParticipant.create({
      data: {
        eventId: fixture.eventId,
        sessionVersionId: id(16),
        speakerId: fixture.speakerId,
        sortOrder: 0,
      },
    });

    await transaction.agendaPlacement.create({
      data: {
        id: fixture.agendaPlacementId,
        eventId: fixture.eventId,
        sessionId: fixture.sessionId,
        roomId: fixture.roomId,
        startsAt: new Date("2027-03-13T18:00:00.000Z"),
        endsAt: new Date("2027-03-13T18:45:00.000Z"),
        tracks: { create: { trackId: fixture.trackId, sortOrder: 0 } },
        speakers: { create: { speakerId: fixture.speakerId, sortOrder: 0 } },
      },
    });

    await transaction.speakerTaskAssignment.create({
      data: {
        id: id(29),
        eventId: fixture.eventId,
        definitionId: fixture.taskDefinitionId,
        definitionVersionId: id(24),
        speakerId: fixture.speakerId,
        status: SpeakerTaskAssignmentStatus.PENDING,
        assignedAt: new Date("2027-02-21T18:00:00.000Z"),
        dueAt: new Date("2027-03-07T18:00:00.000Z"),
        transitions: {
          create: {
            id: id(30),
            toStatus: SpeakerTaskAssignmentStatus.PENDING,
            note: "Assigned after program acceptance.",
            occurredAt: new Date("2027-02-21T18:00:00.000Z"),
          },
        },
      },
    });

    await transaction.integrationConfiguration.create({
      data: {
        id: fixture.integrationConfigurationId,
        eventId: fixture.eventId,
        provider: IntegrationProvider.ACCELEVENTS,
        versions: {
          create: {
            id: id(33),
            versionNumber: 1,
            remoteEventId: "demo-event",
            credentialReference: "local://adapters/accelevents/board-to-death-demo",
            settings: { adapter: "deterministic", seed: fixture.eventSlug },
          },
        },
        fieldMappings: {
          create: {
            id: id(34),
            resourceType: "speaker",
            key: "public-profile",
            versions: {
              create: {
                id: id(35),
                versionNumber: 1,
                definition: {
                  email: "profile.email",
                  firstName: "profile.givenName",
                  lastName: "profile.familyName",
                },
              },
            },
          },
        },
      },
    });

    await transaction.integrationRemoteRecord.create({
      data: {
        id: id(36),
        eventId: fixture.eventId,
        configurationId: fixture.integrationConfigurationId,
        mappingVersionId: id(35),
        resourceType: "speaker",
        localId: fixture.speakerId,
        remoteId: "speaker-demo-ada",
        status: IntegrationRemoteRecordStatus.ACTIVE,
        comparisonHash: "demo-speaker-v1",
        lastSyncedAt: new Date("2027-02-22T18:00:00.000Z"),
      },
    });

    await transaction.integrationSyncRun.create({
      data: {
        id: id(37),
        eventId: fixture.eventId,
        configurationId: fixture.integrationConfigurationId,
        configurationVersionId: id(33),
        mappingVersionId: id(35),
        idempotencyKey: "demo-speaker-push-v1",
        status: IntegrationSyncRunStatus.SUCCEEDED,
        startedAt: new Date("2027-02-22T17:59:00.000Z"),
        completedAt: new Date("2027-02-22T18:00:00.000Z"),
        records: {
          create: {
            id: id(38),
            remoteRecordId: id(36),
            resourceType: "speaker",
            localId: fixture.speakerId,
            remoteId: "speaker-demo-ada",
            inputHash: "demo-speaker-v1",
            status: IntegrationSyncRecordStatus.SUCCEEDED,
            redactedRequestContext: { fields: ["email", "firstName", "lastName"], credential: "[REDACTED]" },
            completedAt: new Date("2027-02-22T18:00:00.000Z"),
          },
        },
      },
    });
  });

  return {
    eventId: fixture.eventId,
    eventSlug: fixture.eventSlug,
    submissionId: fixture.submissionId,
    speakerId: fixture.speakerId,
    sessionId: fixture.sessionId,
    agendaPlacementId: fixture.agendaPlacementId,
    integrationConfigurationId: fixture.integrationConfigurationId,
  };
}
