import {
  CfpAdminRole,
  CfpDraftPolicy,
  CfpPolicyStatus,
  CfpSubmissionKind,
  CfpSubmissionRevisionKind,
  CfpSubmissionStatus,
  CfpSubmissionTransitionActor,
  ContactGroupIntakeFormStatus,
  ContactGroupIntakeSubmissionStatus,
  ContactGroupKind,
  CustomDashboardTemplate,
  CustomFieldEntityType,
  CustomFieldType,
  DashboardWidgetDataSource,
  DashboardWidgetKind,
  DeliveryAttemptStatus,
  DeliveryFailureClass,
  EvaluationAssignmentStatus,
  EvaluationDecisionOutcome,
  EvaluationPlanVersionStatus,
  EvaluationRecommendation,
  EvaluationReviewerStatus,
  EvaluationRoundStatus,
  EvaluationStatus,
  EventMembershipRole,
  EventType,
  FileRequestAssignmentStatus,
  FileRequestTargetKind,
  MessageRecipientStatus,
  OrganizationMemberRole,
  type Prisma,
  type PrismaClient,
  ProgramSessionKind,
  PublishedProgramState,
  ReportBaseType,
  ReviewerVisibility,
  SpeakerProspectActivityActor,
  SpeakerProspectActivityKind,
  SpeakerProspectStageBehavior,
  SpeakerTaskAssignmentStatus,
  SpeakerTaskFileCommentAuthorRole,
  SpeakerWorkflowStatus,
} from "../../generated/prisma/client.ts";

const id = (suffix: number): string => `20000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;

export const demoOrgFixture = {
  organizationId: id(1),
  organizationSlug: "tabletop-guild",
  summitEventId: id(100),
  summitEventSlug: "protospiel-summit-2026",
  playtestEventId: id(600),
  playtestEventSlug: "winter-playtest-nights-2026",
  ownerEmail: "mike@tabletopguild.test",
  demoUserEmails: [
    "mike@tabletopguild.test",
    "priya@tabletopguild.test",
    "marcus@tabletopguild.test",
    "elena@tabletopguild.test",
    "tomas@tabletopguild.test",
  ],
} as const;

export interface DemoOrgFixtureResult {
  readonly organizationId: string;
  readonly organizationSlug: string;
  readonly summitEventSlug: string;
  readonly playtestEventSlug: string;
  readonly demoUserEmails: readonly string[];
}

interface DemoUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly orgRole: OrganizationMemberRole;
}

const demoUsers: readonly DemoUser[] = [
  { id: "demo-user-mike", email: "mike@tabletopguild.test", name: "Mike Lay", orgRole: OrganizationMemberRole.OWNER },
  {
    id: "demo-user-priya",
    email: "priya@tabletopguild.test",
    name: "Priya Raman",
    orgRole: OrganizationMemberRole.OWNER,
  },
  {
    id: "demo-user-marcus",
    email: "marcus@tabletopguild.test",
    name: "Marcus Webb",
    orgRole: OrganizationMemberRole.MEMBER,
  },
  {
    id: "demo-user-elena",
    email: "elena@tabletopguild.test",
    name: "Elena Vasquez",
    orgRole: OrganizationMemberRole.MEMBER,
  },
  {
    id: "demo-user-tomas",
    email: "tomas@tabletopguild.test",
    name: "Tomás Ferreira",
    orgRole: OrganizationMemberRole.MEMBER,
  },
];

export async function createDemoOrgFixtures(client: PrismaClient): Promise<DemoOrgFixtureResult> {
  await client.$transaction(
    async (tx) => {
      for (const slug of [demoOrgFixture.summitEventSlug, demoOrgFixture.playtestEventSlug]) {
        const existing = await tx.event.findUnique({ where: { slug }, select: { id: true } });
        if (existing) {
          await tx.integrationSyncRecord.deleteMany({ where: { eventId: existing.id } });
          await tx.event.delete({ where: { id: existing.id } });
        }
      }

      await tx.organization.upsert({
        where: { id: demoOrgFixture.organizationId },
        create: { id: demoOrgFixture.organizationId, name: "Tabletop Guild", slug: demoOrgFixture.organizationSlug },
        update: { name: "Tabletop Guild", slug: demoOrgFixture.organizationSlug },
      });

      await tx.organizationMember.deleteMany({ where: { orgId: demoOrgFixture.organizationId } });
      await tx.organizationInvitation.deleteMany({ where: { orgId: demoOrgFixture.organizationId } });
      await tx.person.deleteMany({ where: { orgId: demoOrgFixture.organizationId } });

      // Remove stale demo-user rows whose id is reserved for a demo user but whose email
      // no longer matches (e.g. after a demo email is renamed), so the upserts below
      // cannot collide on the primary key.
      await tx.user.deleteMany({
        where: {
          id: { in: demoUsers.map((user) => user.id) },
          email: { notIn: demoUsers.map((user) => user.email) },
        },
      });
      for (const user of demoUsers) {
        await tx.user.upsert({
          where: { email: user.email },
          create: { id: user.id, email: user.email, name: user.name, emailVerified: true },
          update: { name: user.name },
        });
      }
      const userIdsByEmail = new Map(
        (await tx.user.findMany({ where: { email: { in: demoUsers.map((user) => user.email) } } })).map((user) => [
          user.email,
          user.id,
        ]),
      );
      const userId = (email: string): string => {
        const found = userIdsByEmail.get(email);
        if (!found) throw new Error(`Demo user ${email} was not created.`);
        return found;
      };

      for (const user of demoUsers) {
        await tx.organizationMember.create({
          data: { orgId: demoOrgFixture.organizationId, userId: userId(user.email), role: user.orgRole },
        });
      }
      await tx.organizationInvitation.create({
        data: {
          id: id(545),
          orgId: demoOrgFixture.organizationId,
          inviterId: userId("priya@tabletopguild.test"),
          email: "jordan@tabletopguild.test",
          role: OrganizationMemberRole.MEMBER,
          tokenHash: "demo-org-invite-jordan",
          expiresAt: new Date("2026-09-30T00:00:00.000Z"),
        },
      });

      await tx.person.createMany({
        data: [
          {
            id: id(150),
            orgId: demoOrgFixture.organizationId,
            email: "amara.osei@example.test",
            givenName: "Amara",
            familyName: "Osei",
            organization: "Kola Nut Games",
            jobTitle: "Lead designer",
          },
          {
            id: id(151),
            orgId: demoOrgFixture.organizationId,
            email: "ben.kowalski@example.test",
            givenName: "Ben",
            familyName: "Kowalski",
            organization: "Cardstock Press",
            jobTitle: "Production manager",
          },
          {
            id: id(152),
            orgId: demoOrgFixture.organizationId,
            email: "chloe.tran@example.test",
            givenName: "Chloe",
            familyName: "Tran",
            organization: "Night Market Studio",
            jobTitle: "Co-founder",
          },
          {
            id: id(153),
            orgId: demoOrgFixture.organizationId,
            email: "diego.ruiz@example.test",
            givenName: "Diego",
            familyName: "Ruiz",
            organization: "Night Market Studio",
            jobTitle: "Co-founder",
          },
          {
            id: id(154),
            orgId: demoOrgFixture.organizationId,
            email: "hana.sato@example.test",
            givenName: "Hana",
            familyName: "Sato",
            organization: "Independent",
            jobTitle: "Game designer & author",
          },
          {
            id: id(155),
            orgId: demoOrgFixture.organizationId,
            email: "ravi.menon@example.test",
            givenName: "Ravi",
            familyName: "Menon",
            organization: "Chai & Dice",
            jobTitle: "Designer",
          },
          {
            id: id(156),
            orgId: demoOrgFixture.organizationId,
            email: "lena.fischer@example.test",
            givenName: "Lena",
            familyName: "Fischer",
            organization: "Werkstatt Spiele",
            jobTitle: "Playtest coordinator",
          },
          {
            id: id(157),
            orgId: demoOrgFixture.organizationId,
            email: "sofia.alvarez@example.test",
            givenName: "Sofia",
            familyName: "Alvarez",
            organization: "Independent",
            jobTitle: "Illustrator & designer",
          },
          {
            id: id(159),
            orgId: demoOrgFixture.organizationId,
            email: "nora.fields@example.test",
            givenName: "Nora",
            familyName: "Fields",
            organization: "Meeple Mart",
            jobTitle: "Events lead",
          },
        ],
      });

      await createSummitEvent(tx, userId);
      await createPlaytestEvent(tx, userId);
      await createSpeakerSourcing(tx);
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  return {
    organizationId: demoOrgFixture.organizationId,
    organizationSlug: demoOrgFixture.organizationSlug,
    summitEventSlug: demoOrgFixture.summitEventSlug,
    playtestEventSlug: demoOrgFixture.playtestEventSlug,
    demoUserEmails: demoOrgFixture.demoUserEmails,
  };
}

type TransactionClient = Prisma.TransactionClient;

async function createSummitEvent(tx: TransactionClient, userId: (email: string) => string): Promise<void> {
  const eventId = demoOrgFixture.summitEventId;

  await tx.event.create({
    data: {
      id: eventId,
      orgId: demoOrgFixture.organizationId,
      name: "Protospiel Summit 2026",
      slug: demoOrgFixture.summitEventSlug,
      type: EventType.CONFERENCE,
      websiteUrl: "https://example.test/protospiel-summit",
      location: "Portland, OR",
      timezone: "America/Los_Angeles",
      startsAt: new Date("2026-10-16T16:00:00.000Z"),
      endsAt: new Date("2026-10-19T00:00:00.000Z"),
      theme: "From prototype to table: making games people finish",
      exhibitorsEnabled: true,
      sponsorsEnabled: true,
      rooms: {
        create: [
          { id: id(101), name: "Grand Hall", sortOrder: 0 },
          { id: id(102), name: "Workshop A", sortOrder: 1 },
          { id: id(103), name: "Playtest Lab", sortOrder: 2 },
        ],
      },
      tracks: {
        create: [
          { id: id(104), name: "Design", color: "blue", sortOrder: 0 },
          { id: id(105), name: "Publishing", color: "amber", sortOrder: 1 },
          { id: id(106), name: "Community", color: "green", sortOrder: 2 },
        ],
      },
      cfpCategories: {
        create: [
          { id: id(107), key: "design", label: "Game design", description: "Mechanics, systems, and iteration." },
          {
            id: id(108),
            key: "publishing",
            label: "Publishing & production",
            description: "Manufacturing, funding, and distribution.",
          },
          {
            id: id(109),
            key: "community",
            label: "Community & events",
            description: "Running playtest groups, conventions, and clubs.",
          },
        ],
      },
      cfpForms: {
        create: {
          id: id(110),
          key: "main-cfp",
          versions: {
            create: {
              id: id(111),
              versionNumber: 1,
              schemaVersion: 1,
              title: "Protospiel Summit 2026 call for proposals",
              description: "Practical sessions for tabletop designers, publishers, and organizers.",
              customTypes: [],
              categories: [
                { id: "design", label: "Game design" },
                { id: "publishing", label: "Publishing & production" },
                { id: "community", label: "Community & events" },
              ],
              steps: {
                create: [
                  {
                    id: id(112),
                    key: "speaker",
                    kind: "speaker",
                    title: "Speaker",
                    sortOrder: 0,
                    questions: {
                      create: {
                        id: id(113),
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
                    id: id(114),
                    key: "proposal",
                    kind: "questions",
                    title: "Proposal",
                    sortOrder: 1,
                    questions: {
                      create: [
                        {
                          id: id(115),
                          key: "abstract",
                          type: "long_text",
                          label: "Abstract",
                          required: true,
                          constraints: { minLength: 20, maxLength: 1_500 },
                          sortOrder: 0,
                        },
                        {
                          id: id(116),
                          key: "takeaways",
                          type: "long_text",
                          label: "What will attendees take away?",
                          required: true,
                          constraints: { minLength: 10, maxLength: 800 },
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
      cfpAdministrators: {
        create: [
          { id: id(117), externalId: "demo-user-marcus", displayName: "Marcus Webb" },
          { id: id(118), externalId: "demo-user-priya", displayName: "Priya Raman" },
        ],
      },
      speakers: {
        create: [
          speakerCreate(130, 140, id(150), SpeakerWorkflowStatus.CONFIRMED, {
            email: "amara.osei@example.test",
            givenName: "Amara",
            familyName: "Osei",
            organization: "Kola Nut Games",
            jobTitle: "Lead designer",
            biography: "Amara designs engine-building games and teaches rapid prototyping workshops.",
          }),
          speakerCreate(131, 141, id(151), SpeakerWorkflowStatus.CONFIRMED, {
            email: "ben.kowalski@example.test",
            givenName: "Ben",
            familyName: "Kowalski",
            organization: "Cardstock Press",
            jobTitle: "Production manager",
            biography: "Ben has shepherded forty tabletop titles through manufacturing in three countries.",
          }),
          speakerCreate(132, 142, id(152), SpeakerWorkflowStatus.CONFIRMED, {
            email: "chloe.tran@example.test",
            givenName: "Chloe",
            familyName: "Tran",
            organization: "Night Market Studio",
            jobTitle: "Co-founder",
            biography: "Chloe co-founded Night Market Studio and runs its blind-playtest program.",
          }),
          speakerCreate(133, 143, id(153), SpeakerWorkflowStatus.CONFIRMED, {
            email: "diego.ruiz@example.test",
            givenName: "Diego",
            familyName: "Ruiz",
            organization: "Night Market Studio",
            jobTitle: "Co-founder",
            biography: "Diego handles systems and balance at Night Market Studio.",
          }),
          speakerCreate(134, 144, null, SpeakerWorkflowStatus.INVITED, {
            email: "erin.walsh@example.test",
            givenName: "Erin",
            familyName: "Walsh",
            organization: "Solo Meeple",
            jobTitle: "Content creator",
            biography: "Erin reviews solo-mode board games and designs solitaire variants.",
          }),
          speakerCreate(135, 145, null, SpeakerWorkflowStatus.DECLINED, {
            email: "felix.grimm@example.test",
            givenName: "Felix",
            familyName: "Grimm",
            organization: "Grimmwerks",
            jobTitle: "Designer",
            biography: "Felix designs heavy economic games.",
          }),
          speakerCreate(136, 146, id(154), SpeakerWorkflowStatus.CONFIRMED, {
            email: "hana.sato@example.test",
            givenName: "Hana",
            familyName: "Sato",
            organization: "Independent",
            jobTitle: "Game designer & author",
            biography: "Hana is the author of 'The Unfinished Prototype' and this year's keynote speaker.",
          }),
          speakerCreate(137, 147, null, SpeakerWorkflowStatus.NOT_CONTACTED, {
            email: "ingrid.bergstrom@example.test",
            givenName: "Ingrid",
            familyName: "Bergström",
            organization: "Fika Games",
            jobTitle: "Designer",
            biography: "Ingrid designs cooperative family games.",
          }),
        ],
      },
      evaluationPlans: {
        create: {
          id: id(220),
          key: "program-review",
          versions: {
            create: {
              id: id(221),
              versionNumber: 1,
              title: "Summit program review",
              description: "Two-round review: screening for fit, then a deep read by the committee.",
              status: EvaluationPlanVersionStatus.DRAFT,
              rounds: {
                create: [
                  {
                    id: id(222),
                    key: "screening",
                    title: "Screening",
                    sortOrder: 0,
                    status: EvaluationRoundStatus.CLOSED,
                    reviewerVisibility: ReviewerVisibility.BLIND,
                    visibilitySnapshot: ReviewerVisibility.BLIND,
                    opensAt: new Date("2026-06-02T16:00:00.000Z"),
                    closesAt: new Date("2026-06-26T16:00:00.000Z"),
                    transitions: {
                      create: [
                        {
                          id: id(230),
                          toStatus: EvaluationRoundStatus.PLANNED,
                          occurredAt: new Date("2026-05-20T16:00:00.000Z"),
                        },
                        {
                          id: id(231),
                          fromStatus: EvaluationRoundStatus.PLANNED,
                          toStatus: EvaluationRoundStatus.OPEN,
                          occurredAt: new Date("2026-06-02T16:00:00.000Z"),
                        },
                        {
                          id: id(232),
                          fromStatus: EvaluationRoundStatus.OPEN,
                          toStatus: EvaluationRoundStatus.CLOSED,
                          occurredAt: new Date("2026-06-26T16:00:00.000Z"),
                        },
                      ],
                    },
                    criteria: {
                      create: [
                        {
                          id: id(224),
                          key: "clarity",
                          label: "Clarity",
                          description: "The proposal has a clear audience and outcome.",
                          sortOrder: 0,
                          weight: 1,
                          minimum: 1,
                          maximum: 5,
                        },
                        {
                          id: id(225),
                          key: "fit",
                          label: "Program fit",
                          description: "The topic fits this year's theme and tracks.",
                          sortOrder: 1,
                          weight: 1,
                          minimum: 1,
                          maximum: 5,
                        },
                      ],
                    },
                  },
                  {
                    id: id(223),
                    key: "final",
                    title: "Final review",
                    sortOrder: 1,
                    status: EvaluationRoundStatus.OPEN,
                    reviewerVisibility: ReviewerVisibility.IDENTIFIED,
                    visibilitySnapshot: ReviewerVisibility.IDENTIFIED,
                    opensAt: new Date("2026-06-27T16:00:00.000Z"),
                    transitions: {
                      create: [
                        {
                          id: id(233),
                          toStatus: EvaluationRoundStatus.PLANNED,
                          occurredAt: new Date("2026-05-20T16:00:00.000Z"),
                        },
                        {
                          id: id(234),
                          fromStatus: EvaluationRoundStatus.PLANNED,
                          toStatus: EvaluationRoundStatus.OPEN,
                          occurredAt: new Date("2026-06-27T16:00:00.000Z"),
                        },
                      ],
                    },
                    criteria: {
                      create: [
                        {
                          id: id(226),
                          key: "depth",
                          label: "Depth",
                          description: "The session goes beyond the basics.",
                          sortOrder: 0,
                          weight: 1.5,
                          minimum: 1,
                          maximum: 5,
                        },
                        {
                          id: id(227),
                          key: "audience-value",
                          label: "Audience value",
                          description: "Attendees leave with something they can use.",
                          sortOrder: 1,
                          weight: 1,
                          minimum: 1,
                          maximum: 5,
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
      evaluationReviewers: {
        create: [
          {
            id: id(240),
            identityId: userId("elena@tabletopguild.test"),
            email: "elena@tabletopguild.test",
            displayName: "Elena Vasquez",
            status: EvaluationReviewerStatus.ACTIVE,
          },
          {
            id: id(241),
            identityId: userId("tomas@tabletopguild.test"),
            email: "tomas@tabletopguild.test",
            displayName: "Tomás Ferreira",
            status: EvaluationReviewerStatus.ACTIVE,
          },
        ],
      },
      speakerTaskDefinitions: {
        create: [
          {
            id: id(340),
            key: "confirm-bio",
            versions: {
              create: {
                id: id(341),
                versionNumber: 1,
                sortOrder: 0,
                title: "Confirm your public biography",
                description: "Review the biography and headline shown on the public program and confirm it.",
                applicability: { sessionKinds: [ProgramSessionKind.PROMOTED, ProgramSessionKind.MANUAL] },
                defaultDueOffsetDays: 21,
                responseRequired: true,
                responseSchema: { type: "object", required: ["approved"] },
              },
            },
          },
          {
            id: id(342),
            key: "upload-headshot",
            versions: {
              create: {
                id: id(343),
                versionNumber: 1,
                sortOrder: 1,
                title: "Upload a headshot",
                description: "A square photo, at least 800×800, for the program site.",
                applicability: { sessionKinds: [ProgramSessionKind.PROMOTED, ProgramSessionKind.MANUAL] },
                defaultDueOffsetDays: 30,
                responseRequired: false,
              },
            },
          },
        ],
      },
    },
  });

  await tx.evaluationPlanVersion.update({
    where: { id: id(221) },
    data: { status: EvaluationPlanVersionStatus.ACTIVE, activatedAt: new Date("2026-06-02T16:00:00.000Z") },
  });

  await tx.evaluationCommittee.create({
    data: {
      id: id(242),
      eventId,
      key: "program-committee",
      name: "Program committee",
      description: "Reviews every submission after screening.",
      members: { create: [{ reviewerId: id(240), role: "chair" }, { reviewerId: id(241) }] },
    },
  });

  await tx.cfpPolicy.create({
    data: {
      id: id(119),
      eventId,
      key: "main-cfp",
      publicId: id(121),
      status: CfpPolicyStatus.CLOSED,
      publishedFormVersionId: id(111),
      versions: {
        create: {
          id: id(120),
          versionNumber: 1,
          submissionOpensAt: new Date("2026-03-01T08:00:00.000Z"),
          submissionClosesAt: new Date("2026-06-01T07:00:00.000Z"),
          confirmationClosesAt: new Date("2026-07-31T07:00:00.000Z"),
          draftPolicy: CfpDraftPolicy.ALLOWED,
          submissionLimits: { maxSubmissionsPerSpeaker: 3, maxParticipantsPerSubmission: 3 },
          messages: {
            introduction: "Tell us about the session you want to bring to Protospiel Summit 2026.",
            submissionConfirmation: "Thanks — your proposal is in. We'll be in touch after the review rounds.",
            closed: "The call for proposals closed on June 1, 2026. See you in Portland!",
            thankYou: "Thank you for helping make the summit great.",
          },
          conditionalVisibility: [],
          adminAssignments: {
            create: [
              {
                administratorId: id(118),
                role: CfpAdminRole.OWNER,
                notifyOnNewSubmission: true,
                notifyOnSubmissionUpdate: true,
              },
              {
                administratorId: id(117),
                role: CfpAdminRole.EDITOR,
                notifyOnNewSubmission: true,
                notifyOnSubmissionUpdate: false,
              },
            ],
          },
        },
      },
      transitions: {
        create: [
          {
            toStatus: CfpPolicyStatus.PUBLISHED,
            actorAdministratorId: id(118),
            occurredAt: new Date("2026-03-01T08:00:00.000Z"),
          },
          {
            fromStatus: CfpPolicyStatus.PUBLISHED,
            toStatus: CfpPolicyStatus.CLOSED,
            actorAdministratorId: id(117),
            occurredAt: new Date("2026-06-01T07:00:00.000Z"),
          },
        ],
      },
    },
  });

  await createSummitSubmissions(tx, eventId);
  await createSummitEvaluations(tx);
  await createSummitProgram(tx, eventId);
  await createSummitSpeakerOps(tx, eventId, userId);
  await createSummitPartners(tx, eventId, userId);
  await createSummitWorkspace(tx, eventId);

  const memberships: readonly { email: string; roles: EventMembershipRole[] }[] = [
    { email: "mike@tabletopguild.test", roles: [EventMembershipRole.ORGANIZER_ADMIN] },
    { email: "priya@tabletopguild.test", roles: [EventMembershipRole.ORGANIZER_ADMIN] },
    { email: "marcus@tabletopguild.test", roles: [EventMembershipRole.ORGANIZER_ADMIN] },
    { email: "elena@tabletopguild.test", roles: [EventMembershipRole.REVIEWER] },
    { email: "tomas@tabletopguild.test", roles: [EventMembershipRole.REVIEWER] },
  ];
  for (const membership of memberships) {
    await tx.eventMembership.create({
      data: { eventId, userId: userId(membership.email), roles: membership.roles },
    });
  }
  await tx.eventInvitation.create({
    data: {
      id: id(535),
      eventId,
      email: "sam@tabletopguild.test",
      displayName: "Sam Okafor",
      role: EventMembershipRole.REVIEWER,
      tokenHash: "demo-event-invite-sam",
      expiresAt: new Date("2026-09-15T00:00:00.000Z"),
    },
  });
}

function speakerCreate(
  speakerSuffix: number,
  profileSuffix: number,
  personId: string | null,
  workflowStatus: SpeakerWorkflowStatus,
  profile: {
    email: string;
    givenName: string;
    familyName: string;
    organization: string;
    jobTitle: string;
    biography: string;
  },
) {
  return {
    id: id(speakerSuffix),
    personId,
    normalizedEmail: profile.email,
    workflowStatus,
    profileVersions: {
      create: {
        id: id(profileSuffix),
        versionNumber: 1,
        email: profile.email,
        givenName: profile.givenName,
        familyName: profile.familyName,
        organization: profile.organization,
        jobTitle: profile.jobTitle,
        biography: profile.biography,
        consentToPublishProfile: true,
        consentToReceiveEmail: true,
        consentedAt: new Date("2026-05-10T16:00:00.000Z"),
      },
    },
  };
}

async function createSummitSubmissions(tx: TransactionClient, eventId: string): Promise<void> {
  interface SubmissionSeed {
    readonly suffix: number;
    readonly revisionSuffix: number;
    readonly status: CfpSubmissionStatus;
    readonly categoryId: string;
    readonly speakerIds: readonly string[];
    readonly title: string;
    readonly abstract: string;
    readonly takeaways: string;
    readonly answerSuffixes: readonly [number, number];
    readonly transitions: readonly {
      readonly fromStatus: CfpSubmissionStatus | null;
      readonly toStatus: CfpSubmissionStatus;
      readonly actor: CfpSubmissionTransitionActor;
      readonly occurredAt: Date;
      readonly note?: string;
    }[];
    readonly submittedAt?: Date;
    readonly reviewStartedAt?: Date;
    readonly decidedAt?: Date;
    readonly confirmedAt?: Date;
  }

  const submitted = new Date("2026-05-18T16:00:00.000Z");
  const reviewStarted = new Date("2026-06-02T16:00:00.000Z");
  const decided = new Date("2026-07-06T16:00:00.000Z");

  const seeds: readonly SubmissionSeed[] = [
    {
      suffix: 160,
      revisionSuffix: 170,
      status: CfpSubmissionStatus.CONFIRMED,
      categoryId: id(107),
      speakerIds: [id(130)],
      title: "Cutting your prototype in half",
      abstract:
        "A hands-on method for finding the half of your prototype that isn't earning its place, with live examples from three published designs.",
      takeaways: "A repeatable trimming checklist you can run after every playtest.",
      answerSuffixes: [180, 181],
      submittedAt: submitted,
      reviewStartedAt: reviewStarted,
      decidedAt: decided,
      confirmedAt: new Date("2026-07-20T16:00:00.000Z"),
      transitions: [
        {
          fromStatus: CfpSubmissionStatus.SUBMITTED,
          toStatus: CfpSubmissionStatus.UNDER_REVIEW,
          actor: CfpSubmissionTransitionActor.ADMIN,
          occurredAt: reviewStarted,
        },
        {
          fromStatus: CfpSubmissionStatus.UNDER_REVIEW,
          toStatus: CfpSubmissionStatus.ACCEPTED,
          actor: CfpSubmissionTransitionActor.ADMIN,
          occurredAt: decided,
          note: "Strong screening scores.",
        },
        {
          fromStatus: CfpSubmissionStatus.ACCEPTED,
          toStatus: CfpSubmissionStatus.CONFIRMED,
          actor: CfpSubmissionTransitionActor.SPEAKER_CONFIRMATION,
          occurredAt: new Date("2026-07-20T16:00:00.000Z"),
        },
      ],
    },
    {
      suffix: 161,
      revisionSuffix: 171,
      status: CfpSubmissionStatus.ACCEPTED,
      categoryId: id(108),
      speakerIds: [id(131)],
      title: "What your manufacturer wishes you knew",
      abstract:
        "Component specs, tolerances, and file-prep mistakes that add weeks to production, drawn from forty shipped titles.",
      takeaways: "A pre-flight checklist for handing files to any manufacturer.",
      answerSuffixes: [182, 183],
      submittedAt: submitted,
      reviewStartedAt: reviewStarted,
      decidedAt: decided,
      transitions: [
        {
          fromStatus: CfpSubmissionStatus.SUBMITTED,
          toStatus: CfpSubmissionStatus.UNDER_REVIEW,
          actor: CfpSubmissionTransitionActor.ADMIN,
          occurredAt: reviewStarted,
        },
        {
          fromStatus: CfpSubmissionStatus.UNDER_REVIEW,
          toStatus: CfpSubmissionStatus.ACCEPTED,
          actor: CfpSubmissionTransitionActor.ADMIN,
          occurredAt: decided,
          note: "Awaiting speaker confirmation.",
        },
      ],
    },
    {
      suffix: 162,
      revisionSuffix: 172,
      status: CfpSubmissionStatus.CONFIRMED,
      categoryId: id(107),
      speakerIds: [id(132), id(133)],
      title: "Running a blind playtest program",
      abstract:
        "How Night Market Studio recruits, briefs, and debriefs blind playtesters — and what changed in our designs because of it.",
      takeaways: "Templates for tester briefs and structured feedback forms.",
      answerSuffixes: [184, 185],
      submittedAt: submitted,
      reviewStartedAt: reviewStarted,
      decidedAt: decided,
      confirmedAt: new Date("2026-07-22T16:00:00.000Z"),
      transitions: [
        {
          fromStatus: CfpSubmissionStatus.SUBMITTED,
          toStatus: CfpSubmissionStatus.UNDER_REVIEW,
          actor: CfpSubmissionTransitionActor.ADMIN,
          occurredAt: reviewStarted,
        },
        {
          fromStatus: CfpSubmissionStatus.UNDER_REVIEW,
          toStatus: CfpSubmissionStatus.ACCEPTED,
          actor: CfpSubmissionTransitionActor.ADMIN,
          occurredAt: decided,
        },
        {
          fromStatus: CfpSubmissionStatus.ACCEPTED,
          toStatus: CfpSubmissionStatus.CONFIRMED,
          actor: CfpSubmissionTransitionActor.SPEAKER_CONFIRMATION,
          occurredAt: new Date("2026-07-22T16:00:00.000Z"),
        },
      ],
    },
    {
      suffix: 163,
      revisionSuffix: 173,
      status: CfpSubmissionStatus.WAITLISTED,
      categoryId: id(109),
      speakerIds: [id(134)],
      title: "Designing for the solo table",
      abstract: "Adding a solo mode that respects the multiplayer design instead of fighting it.",
      takeaways: "Three automa patterns and when to use each.",
      answerSuffixes: [186, 187],
      submittedAt: submitted,
      reviewStartedAt: reviewStarted,
      decidedAt: decided,
      transitions: [
        {
          fromStatus: CfpSubmissionStatus.SUBMITTED,
          toStatus: CfpSubmissionStatus.UNDER_REVIEW,
          actor: CfpSubmissionTransitionActor.ADMIN,
          occurredAt: reviewStarted,
        },
        {
          fromStatus: CfpSubmissionStatus.UNDER_REVIEW,
          toStatus: CfpSubmissionStatus.WAITLISTED,
          actor: CfpSubmissionTransitionActor.ADMIN,
          occurredAt: decided,
          note: "Good session, no slot left on the Design track.",
        },
      ],
    },
    {
      suffix: 164,
      revisionSuffix: 174,
      status: CfpSubmissionStatus.REJECTED,
      categoryId: id(108),
      speakerIds: [id(135)],
      title: "My unpublished 18-hour economic epic",
      abstract: "A tour of the rulebook of my current prototype.",
      takeaways: "You will hear about my game.",
      answerSuffixes: [188, 189],
      submittedAt: submitted,
      reviewStartedAt: reviewStarted,
      decidedAt: decided,
      transitions: [
        {
          fromStatus: CfpSubmissionStatus.SUBMITTED,
          toStatus: CfpSubmissionStatus.UNDER_REVIEW,
          actor: CfpSubmissionTransitionActor.ADMIN,
          occurredAt: reviewStarted,
        },
        {
          fromStatus: CfpSubmissionStatus.UNDER_REVIEW,
          toStatus: CfpSubmissionStatus.REJECTED,
          actor: CfpSubmissionTransitionActor.ADMIN,
          occurredAt: decided,
          note: "Pitch, not a session.",
        },
      ],
    },
    {
      suffix: 165,
      revisionSuffix: 175,
      status: CfpSubmissionStatus.UNDER_REVIEW,
      categoryId: id(109),
      speakerIds: [id(137)],
      title: "Family playtest nights that families come back to",
      abstract: "Structuring public playtest events so parents and kids both want a second visit.",
      takeaways: "A run-of-show template for a two-hour family playtest night.",
      answerSuffixes: [190, 191],
      submittedAt: new Date("2026-05-30T16:00:00.000Z"),
      reviewStartedAt: reviewStarted,
      transitions: [
        {
          fromStatus: CfpSubmissionStatus.SUBMITTED,
          toStatus: CfpSubmissionStatus.UNDER_REVIEW,
          actor: CfpSubmissionTransitionActor.ADMIN,
          occurredAt: reviewStarted,
        },
      ],
    },
  ];

  for (const seed of seeds) {
    await tx.cfpSubmission.create({
      data: {
        id: id(seed.suffix),
        eventId,
        formVersionId: id(111),
        kind: CfpSubmissionKind.ABSTRACT,
        status: seed.status,
        submittedAt: seed.submittedAt,
        reviewStartedAt: seed.reviewStartedAt,
        decidedAt: seed.decidedAt,
        confirmedAt: seed.confirmedAt,
        revisions: {
          create: {
            id: id(seed.revisionSuffix),
            versionNumber: 1,
            kind: CfpSubmissionRevisionKind.FINAL,
            formVersionId: id(111),
            definitionSnapshot: { title: seed.title, schemaVersion: 1 },
            answers: {
              create: [
                { id: id(seed.answerSuffixes[0]), questionId: "abstract", sortOrder: 0, value: seed.abstract },
                { id: id(seed.answerSuffixes[1]), questionId: "takeaways", sortOrder: 1, value: seed.takeaways },
              ],
            },
          },
        },
        categories: { create: { categoryId: seed.categoryId, sortOrder: 0 } },
        participants: {
          create: seed.speakerIds.map((speakerId, index) => ({
            speakerId,
            sortOrder: index,
            confirmedAt: seed.confirmedAt ?? null,
          })),
        },
        transitions: {
          create: seed.transitions.map((transition) => ({
            fromStatus: transition.fromStatus,
            toStatus: transition.toStatus,
            actor: transition.actor,
            actorId: transition.actor === CfpSubmissionTransitionActor.ADMIN ? "demo-user-marcus" : null,
            note: transition.note,
            occurredAt: transition.occurredAt,
          })),
        },
      },
    });
  }

  await tx.cfpSubmission.create({
    data: {
      id: id(166),
      eventId,
      formVersionId: id(111),
      kind: CfpSubmissionKind.ABSTRACT,
      status: CfpSubmissionStatus.DRAFT,
      revisions: {
        create: {
          id: id(176),
          versionNumber: 1,
          kind: CfpSubmissionRevisionKind.DRAFT,
          formVersionId: id(111),
          definitionSnapshot: { title: "Kickstarter fulfillment postmortems", schemaVersion: 1 },
          answers: {
            create: {
              id: id(192),
              questionId: "abstract",
              sortOrder: 0,
              value: "Draft: three fulfillment disasters and what they cost.",
            },
          },
        },
      },
      categories: { create: { categoryId: id(108), sortOrder: 0 } },
      participants: { create: { speakerId: id(131), sortOrder: 0 } },
    },
  });
}

async function createSummitEvaluations(tx: TransactionClient): Promise<void> {
  const screening = id(222);
  const final = id(223);
  const elena = id(240);
  const tomas = id(241);
  const committee = id(242);
  const completedAt = new Date("2026-06-20T16:00:00.000Z");

  interface CompletedSeed {
    readonly suffix: number;
    readonly roundId: string;
    readonly submission: number;
    readonly reviewerId: string;
    readonly recommendation: EvaluationRecommendation;
    readonly note: string;
    readonly evaluationSuffix: number;
    readonly results: readonly {
      readonly criterionId: string;
      readonly score: number;
      readonly resultSuffix: number;
    }[];
  }

  const seeds: readonly CompletedSeed[] = [
    {
      suffix: 250,
      roundId: screening,
      submission: 160,
      reviewerId: elena,
      recommendation: EvaluationRecommendation.ACCEPT,
      note: "Concrete, practical, well scoped.",
      evaluationSuffix: 260,
      results: [
        { criterionId: id(224), score: 4.5, resultSuffix: 270 },
        { criterionId: id(225), score: 5, resultSuffix: 271 },
      ],
    },
    {
      suffix: 251,
      roundId: screening,
      submission: 161,
      reviewerId: elena,
      recommendation: EvaluationRecommendation.ACCEPT,
      note: "Exactly what the Publishing track needs.",
      evaluationSuffix: 261,
      results: [
        { criterionId: id(224), score: 4, resultSuffix: 272 },
        { criterionId: id(225), score: 4.5, resultSuffix: 273 },
      ],
    },
    {
      suffix: 252,
      roundId: screening,
      submission: 163,
      reviewerId: elena,
      recommendation: EvaluationRecommendation.WAITLIST,
      note: "Solid, but overlaps with two other design sessions.",
      evaluationSuffix: 262,
      results: [
        { criterionId: id(224), score: 4, resultSuffix: 274 },
        { criterionId: id(225), score: 3, resultSuffix: 275 },
      ],
    },
    {
      suffix: 253,
      roundId: screening,
      submission: 162,
      reviewerId: tomas,
      recommendation: EvaluationRecommendation.ACCEPT,
      note: "Rare operational detail; co-presented well.",
      evaluationSuffix: 263,
      results: [
        { criterionId: id(224), score: 5, resultSuffix: 276 },
        { criterionId: id(225), score: 4.5, resultSuffix: 277 },
      ],
    },
    {
      suffix: 254,
      roundId: screening,
      submission: 164,
      reviewerId: tomas,
      recommendation: EvaluationRecommendation.REJECT,
      note: "A pitch for the speaker's own game, not a session.",
      evaluationSuffix: 264,
      results: [
        { criterionId: id(224), score: 2, resultSuffix: 278 },
        { criterionId: id(225), score: 1.5, resultSuffix: 279 },
      ],
    },
    {
      suffix: 257,
      roundId: screening,
      submission: 165,
      reviewerId: tomas,
      recommendation: EvaluationRecommendation.ACCEPT,
      note: "Promising — send to the committee for a full read.",
      evaluationSuffix: 267,
      results: [
        { criterionId: id(224), score: 4, resultSuffix: 283 },
        { criterionId: id(225), score: 4, resultSuffix: 284 },
      ],
    },
    {
      suffix: 255,
      roundId: final,
      submission: 165,
      reviewerId: elena,
      recommendation: EvaluationRecommendation.ACCEPT,
      note: "The run-of-show template alone is worth the slot.",
      evaluationSuffix: 265,
      results: [
        { criterionId: id(226), score: 4.5, resultSuffix: 280 },
        { criterionId: id(227), score: 5, resultSuffix: 281 },
      ],
    },
  ];

  for (const seed of seeds) {
    await tx.evaluationAssignment.create({
      data: {
        id: id(seed.suffix),
        roundId: seed.roundId,
        submissionId: id(seed.submission),
        reviewerId: seed.reviewerId,
        committeeId: seed.roundId === final ? committee : null,
        status: EvaluationAssignmentStatus.COMPLETED,
        assignedAt: new Date("2026-06-03T16:00:00.000Z"),
        completedAt,
        evaluation: {
          create: {
            id: id(seed.evaluationSuffix),
            status: EvaluationStatus.FINAL,
            recommendation: seed.recommendation,
            overallNote: seed.note,
            submittedAt: completedAt,
            results: {
              create: seed.results.map((result) => ({
                id: id(result.resultSuffix),
                criterionId: result.criterionId,
                score: result.score,
              })),
            },
          },
        },
      },
    });
  }

  await tx.evaluationAssignment.create({
    data: {
      id: id(256),
      roundId: final,
      submissionId: id(165),
      reviewerId: tomas,
      committeeId: committee,
      status: EvaluationAssignmentStatus.ASSIGNED,
      assignedAt: new Date("2026-06-27T16:00:00.000Z"),
      evaluation: {
        create: {
          id: id(266),
          status: EvaluationStatus.DRAFT,
          overallNote: "Halfway through — the structure section is strong.",
          results: { create: { id: id(282), criterionId: id(226), score: 4 } },
        },
      },
    },
  });

  await tx.evaluationRoundAdvancement.create({
    data: {
      id: id(285),
      sourceRoundId: screening,
      targetRoundId: final,
      submissionId: id(165),
      actorId: "demo-user-priya",
      occurredAt: new Date("2026-06-27T16:00:00.000Z"),
    },
  });

  const decisions: readonly {
    suffix: number;
    submission: number;
    outcome: EvaluationDecisionOutcome;
    rationale: string;
  }[] = [
    {
      suffix: 290,
      submission: 160,
      outcome: EvaluationDecisionOutcome.ACCEPTED,
      rationale: "Top screening scores across the board.",
    },
    {
      suffix: 291,
      submission: 161,
      outcome: EvaluationDecisionOutcome.ACCEPTED,
      rationale: "Anchors the Publishing track.",
    },
    {
      suffix: 292,
      submission: 162,
      outcome: EvaluationDecisionOutcome.ACCEPTED,
      rationale: "Strong practical content.",
    },
    {
      suffix: 293,
      submission: 163,
      outcome: EvaluationDecisionOutcome.WAITLISTED,
      rationale: "Accept if a Design slot opens.",
    },
    {
      suffix: 294,
      submission: 164,
      outcome: EvaluationDecisionOutcome.REJECTED,
      rationale: "Does not meet the session bar.",
    },
  ];
  for (const decision of decisions) {
    await tx.evaluationDecision.create({
      data: {
        id: id(decision.suffix),
        planVersionId: id(221),
        roundId: id(222),
        submissionId: id(decision.submission),
        decisionNumber: 1,
        outcome: decision.outcome,
        decidedBy: "demo-user-priya",
        rationale: decision.rationale,
        decidedAt: new Date("2026-07-06T16:00:00.000Z"),
      },
    });
  }
}

async function createSummitProgram(tx: TransactionClient, eventId: string): Promise<void> {
  interface SessionSeed {
    readonly sessionSuffix: number;
    readonly versionSuffix: number;
    readonly kind: ProgramSessionKind;
    readonly sourceSubmissionId?: string;
    readonly title: string;
    readonly description: string;
    readonly durationMinutes: number;
    readonly trackId: string | null;
    readonly categoryId: string | null;
    readonly speakerIds: readonly string[];
  }

  const seeds: readonly SessionSeed[] = [
    {
      sessionSuffix: 300,
      versionSuffix: 310,
      kind: ProgramSessionKind.PROMOTED,
      sourceSubmissionId: id(160),
      title: "Cutting your prototype in half",
      description: "A hands-on method for finding the half of your prototype that isn't earning its place.",
      durationMinutes: 45,
      trackId: id(104),
      categoryId: id(107),
      speakerIds: [id(130)],
    },
    {
      sessionSuffix: 301,
      versionSuffix: 311,
      kind: ProgramSessionKind.PROMOTED,
      sourceSubmissionId: id(161),
      title: "What your manufacturer wishes you knew",
      description: "Component specs, tolerances, and file-prep mistakes that add weeks to production.",
      durationMinutes: 45,
      trackId: id(105),
      categoryId: id(108),
      speakerIds: [id(131)],
    },
    {
      sessionSuffix: 302,
      versionSuffix: 312,
      kind: ProgramSessionKind.PROMOTED,
      sourceSubmissionId: id(162),
      title: "Running a blind playtest program",
      description: "Recruiting, briefing, and debriefing blind playtesters at a small studio.",
      durationMinutes: 60,
      trackId: id(104),
      categoryId: id(107),
      speakerIds: [id(132), id(133)],
    },
    {
      sessionSuffix: 303,
      versionSuffix: 313,
      kind: ProgramSessionKind.MANUAL,
      title: "Keynote: The unfinished prototype",
      description: "Hana Sato on why most prototypes should stay unfinished — and how to spot the one that shouldn't.",
      durationMinutes: 45,
      trackId: null,
      categoryId: null,
      speakerIds: [id(136)],
    },
  ];

  for (const seed of seeds) {
    await tx.programSession.create({
      data: {
        id: id(seed.sessionSuffix),
        eventId,
        kind: seed.kind,
        sourceSubmissionId: seed.sourceSubmissionId,
      },
    });
    await tx.programSessionVersion.create({
      data: {
        id: id(seed.versionSuffix),
        eventId,
        sessionId: id(seed.sessionSuffix),
        versionNumber: 1,
        title: seed.title,
        description: seed.description,
        durationMinutes: seed.durationMinutes,
        trackId: seed.trackId,
        categoryId: seed.categoryId,
        participants: {
          create: seed.speakerIds.map((speakerId, index) => ({ speakerId, sortOrder: index })),
        },
      },
    });
  }

  interface PlacementSeed {
    readonly suffix: number;
    readonly sessionId: string;
    readonly roomId: string;
    readonly startsAt: Date;
    readonly endsAt: Date;
    readonly trackIds: readonly string[];
    readonly speakerIds: readonly string[];
  }

  const placements: readonly PlacementSeed[] = [
    {
      suffix: 320,
      sessionId: id(303),
      roomId: id(101),
      startsAt: new Date("2026-10-16T16:30:00.000Z"),
      endsAt: new Date("2026-10-16T17:15:00.000Z"),
      trackIds: [],
      speakerIds: [id(136)],
    },
    {
      suffix: 321,
      sessionId: id(300),
      roomId: id(101),
      startsAt: new Date("2026-10-16T17:30:00.000Z"),
      endsAt: new Date("2026-10-16T18:15:00.000Z"),
      trackIds: [id(104)],
      speakerIds: [id(130)],
    },
    {
      suffix: 322,
      sessionId: id(301),
      roomId: id(102),
      startsAt: new Date("2026-10-16T17:30:00.000Z"),
      endsAt: new Date("2026-10-16T18:15:00.000Z"),
      trackIds: [id(105)],
      speakerIds: [id(131)],
    },
    {
      suffix: 323,
      sessionId: id(302),
      roomId: id(103),
      startsAt: new Date("2026-10-17T18:00:00.000Z"),
      endsAt: new Date("2026-10-17T19:00:00.000Z"),
      trackIds: [id(104)],
      speakerIds: [id(132), id(133)],
    },
  ];

  for (const placement of placements) {
    await tx.agendaPlacement.create({
      data: {
        id: id(placement.suffix),
        eventId,
        sessionId: placement.sessionId,
        roomId: placement.roomId,
        startsAt: placement.startsAt,
        endsAt: placement.endsAt,
        tracks: { create: placement.trackIds.map((trackId, index) => ({ trackId, sortOrder: index })) },
        speakers: { create: placement.speakerIds.map((speakerId, index) => ({ speakerId, sortOrder: index })) },
      },
    });
  }

  const speakerSnapshot = (suffix: number, profile: Record<string, string>) => ({
    id: id(suffix),
    givenName: profile.givenName,
    familyName: profile.familyName,
    preferredName: null,
    pronouns: null,
    organization: profile.organization,
    jobTitle: profile.jobTitle,
    biography: profile.biography,
    websiteUrl: null,
    photoObjectKey: null,
  });

  const snapshot = {
    schemaVersion: 1,
    event: {
      id: eventId,
      name: "Protospiel Summit 2026",
      slug: demoOrgFixture.summitEventSlug,
      websiteUrl: "https://example.test/protospiel-summit",
      location: "Portland, OR",
      timezone: "America/Los_Angeles",
      startsAt: "2026-10-16T16:00:00.000Z",
      endsAt: "2026-10-19T00:00:00.000Z",
      theme: "From prototype to table: making games people finish",
    },
    rooms: [
      { id: id(101), name: "Grand Hall", sortOrder: 0 },
      { id: id(102), name: "Workshop A", sortOrder: 1 },
      { id: id(103), name: "Playtest Lab", sortOrder: 2 },
    ],
    tracks: [
      { id: id(104), name: "Design", color: "blue", sortOrder: 0 },
      { id: id(105), name: "Publishing", color: "amber", sortOrder: 1 },
    ],
    speakers: [
      speakerSnapshot(130, {
        givenName: "Amara",
        familyName: "Osei",
        organization: "Kola Nut Games",
        jobTitle: "Lead designer",
        biography: "Amara designs engine-building games and teaches rapid prototyping workshops.",
      }),
      speakerSnapshot(131, {
        givenName: "Ben",
        familyName: "Kowalski",
        organization: "Cardstock Press",
        jobTitle: "Production manager",
        biography: "Ben has shepherded forty tabletop titles through manufacturing in three countries.",
      }),
      speakerSnapshot(132, {
        givenName: "Chloe",
        familyName: "Tran",
        organization: "Night Market Studio",
        jobTitle: "Co-founder",
        biography: "Chloe co-founded Night Market Studio and runs its blind-playtest program.",
      }),
      speakerSnapshot(133, {
        givenName: "Diego",
        familyName: "Ruiz",
        organization: "Night Market Studio",
        jobTitle: "Co-founder",
        biography: "Diego handles systems and balance at Night Market Studio.",
      }),
      speakerSnapshot(136, {
        givenName: "Hana",
        familyName: "Sato",
        organization: "Independent",
        jobTitle: "Game designer & author",
        biography: "Hana is the author of 'The Unfinished Prototype' and this year's keynote speaker.",
      }),
    ],
    sessions: seeds.map((seed) => ({
      id: id(seed.sessionSuffix),
      title: seed.title,
      description: seed.description,
      durationMinutes: seed.durationMinutes,
      format: null,
      trackId: seed.trackId,
      speakerIds: [...seed.speakerIds],
      parentSessionId: null,
    })),
    placements: placements.map((placement) => ({
      id: id(placement.suffix),
      sessionId: placement.sessionId,
      roomId: placement.roomId,
      startsAt: placement.startsAt.toISOString(),
      endsAt: placement.endsAt.toISOString(),
      trackIds: [...placement.trackIds],
      speakerIds: [...placement.speakerIds],
    })),
  };

  await tx.publishedProgram.create({
    data: {
      id: id(330),
      eventId,
      versions: {
        create: {
          id: id(331),
          versionNumber: 1,
          state: PublishedProgramState.PUBLISHED,
          actorPrincipalId: "demo-user-marcus",
          snapshot,
          createdAt: new Date("2026-08-03T16:00:00.000Z"),
        },
      },
    },
  });
}

async function createSummitSpeakerOps(
  tx: TransactionClient,
  eventId: string,
  userId: (email: string) => string,
): Promise<void> {
  await tx.speakerTaskAssignment.create({
    data: {
      id: id(350),
      eventId,
      definitionId: id(340),
      definitionVersionId: id(341),
      speakerId: id(130),
      status: SpeakerTaskAssignmentStatus.APPROVED,
      assignedAt: new Date("2026-07-21T16:00:00.000Z"),
      dueAt: new Date("2026-08-11T16:00:00.000Z"),
      submittedAt: new Date("2026-07-28T16:00:00.000Z"),
      completedAt: new Date("2026-07-30T16:00:00.000Z"),
      submissions: {
        create: {
          id: id(360),
          attemptNumber: 1,
          response: { approved: true, note: "Bio looks great, thanks!" },
          submittedAt: new Date("2026-07-28T16:00:00.000Z"),
          fileComments: {
            create: {
              id: id(365),
              authorRole: SpeakerTaskFileCommentAuthorRole.ORGANIZER,
              authorLabel: "Marcus Webb",
              authorUserId: userId("marcus@tabletopguild.test"),
              body: "Approved — this reads well on the program page.",
              createdAt: new Date("2026-07-30T16:00:00.000Z"),
            },
          },
        },
      },
      transitions: {
        create: [
          {
            id: id(370),
            toStatus: SpeakerTaskAssignmentStatus.PENDING,
            note: "Assigned after confirmation.",
            occurredAt: new Date("2026-07-21T16:00:00.000Z"),
          },
          {
            id: id(371),
            fromStatus: SpeakerTaskAssignmentStatus.PENDING,
            toStatus: SpeakerTaskAssignmentStatus.SUBMITTED,
            occurredAt: new Date("2026-07-28T16:00:00.000Z"),
          },
          {
            id: id(372),
            fromStatus: SpeakerTaskAssignmentStatus.SUBMITTED,
            toStatus: SpeakerTaskAssignmentStatus.APPROVED,
            occurredAt: new Date("2026-07-30T16:00:00.000Z"),
          },
        ],
      },
    },
  });

  await tx.speakerTaskAssignment.create({
    data: {
      id: id(351),
      eventId,
      definitionId: id(340),
      definitionVersionId: id(341),
      speakerId: id(131),
      status: SpeakerTaskAssignmentStatus.SUBMITTED,
      assignedAt: new Date("2026-07-21T16:00:00.000Z"),
      dueAt: new Date("2026-08-11T16:00:00.000Z"),
      submittedAt: new Date("2026-08-05T16:00:00.000Z"),
      submissions: {
        create: {
          id: id(361),
          attemptNumber: 1,
          response: { approved: true },
          submittedAt: new Date("2026-08-05T16:00:00.000Z"),
        },
      },
      transitions: {
        create: [
          {
            id: id(373),
            toStatus: SpeakerTaskAssignmentStatus.PENDING,
            occurredAt: new Date("2026-07-21T16:00:00.000Z"),
          },
          {
            id: id(374),
            fromStatus: SpeakerTaskAssignmentStatus.PENDING,
            toStatus: SpeakerTaskAssignmentStatus.SUBMITTED,
            occurredAt: new Date("2026-08-05T16:00:00.000Z"),
          },
        ],
      },
    },
  });

  await tx.speakerTaskAssignment.create({
    data: {
      id: id(352),
      eventId,
      definitionId: id(342),
      definitionVersionId: id(343),
      speakerId: id(132),
      status: SpeakerTaskAssignmentStatus.PENDING,
      assignedAt: new Date("2026-07-23T16:00:00.000Z"),
      dueAt: new Date("2026-08-22T16:00:00.000Z"),
      transitions: {
        create: {
          id: id(375),
          toStatus: SpeakerTaskAssignmentStatus.PENDING,
          occurredAt: new Date("2026-07-23T16:00:00.000Z"),
        },
      },
    },
  });

  await tx.communicationTemplate.create({
    data: {
      id: id(380),
      eventId,
      key: "speaker-acceptance",
      name: "Speaker acceptance",
      versions: {
        create: {
          id: id(381),
          version: 1,
          subjectTemplate: "Your session at Protospiel Summit 2026 is confirmed",
          htmlTemplate:
            "<p>Hi {{givenName}},</p><p>Great news — your session was accepted. Please confirm within two weeks.</p>",
          textTemplate: "Hi {{givenName}}, great news — your session was accepted. Please confirm within two weeks.",
        },
      },
    },
  });
  await tx.communicationTemplate.create({
    data: {
      id: id(382),
      eventId,
      key: "task-reminder",
      name: "Speaker task reminder",
      versions: {
        create: {
          id: id(383),
          version: 1,
          subjectTemplate: "Reminder: {{taskTitle}} is due soon",
          htmlTemplate: '<p>Hi {{givenName}},</p><p>Your onboarding task "{{taskTitle}}" is due on {{dueDate}}.</p>',
          textTemplate: 'Hi {{givenName}}, your onboarding task "{{taskTitle}}" is due on {{dueDate}}.',
        },
      },
    },
  });
  await tx.speakerTaskReminderRule.create({
    data: {
      id: id(384),
      eventId,
      templateId: id(382),
      name: "Three days before due",
      daysBeforeDue: 3,
      sendAtMinute: 540,
      enabledAt: new Date("2026-07-21T16:00:00.000Z"),
    },
  });

  await tx.messageDelivery.create({
    data: {
      id: id(390),
      eventId,
      templateVersionId: id(381),
      idempotencyKey: "demo-speaker-acceptance-2026",
      createdAt: new Date("2026-07-07T16:00:00.000Z"),
      recipients: {
        create: [
          {
            id: id(391),
            recipientKey: "speaker-amara",
            email: "amara.osei@example.test",
            displayName: "Amara Osei",
            subjectSnapshot: "Your session at Protospiel Summit 2026 is confirmed",
            htmlSnapshot:
              "<p>Hi Amara,</p><p>Great news — your session was accepted. Please confirm within two weeks.</p>",
            textSnapshot: "Hi Amara, great news — your session was accepted.",
            status: MessageRecipientStatus.DELIVERED,
            deliveredAt: new Date("2026-07-07T16:01:00.000Z"),
            terminalAt: new Date("2026-07-07T16:01:00.000Z"),
            attempts: {
              create: {
                id: id(393),
                attemptNumber: 1,
                provider: "demo-smtp",
                providerMessageId: "demo-accept-amara-1",
                status: DeliveryAttemptStatus.SUCCEEDED,
                startedAt: new Date("2026-07-07T16:00:30.000Z"),
                completedAt: new Date("2026-07-07T16:01:00.000Z"),
              },
            },
          },
          {
            id: id(392),
            recipientKey: "speaker-ben",
            email: "ben.kowalski@example.test",
            displayName: "Ben Kowalski",
            subjectSnapshot: "Your session at Protospiel Summit 2026 is confirmed",
            htmlSnapshot:
              "<p>Hi Ben,</p><p>Great news — your session was accepted. Please confirm within two weeks.</p>",
            textSnapshot: "Hi Ben, great news — your session was accepted.",
            status: MessageRecipientStatus.FAILED,
            terminalAt: new Date("2026-07-07T16:02:00.000Z"),
            attempts: {
              create: {
                id: id(394),
                attemptNumber: 1,
                provider: "demo-smtp",
                status: DeliveryAttemptStatus.FAILED,
                failureClass: DeliveryFailureClass.PERMANENT,
                failureCode: "550",
                failureMessage: "Mailbox unavailable (hard bounce).",
                startedAt: new Date("2026-07-07T16:00:30.000Z"),
                completedAt: new Date("2026-07-07T16:02:00.000Z"),
              },
            },
          },
        ],
      },
    },
  });

  await tx.speakerResourcePage.create({
    data: {
      id: id(400),
      eventId,
      key: "speaker-guide",
      versions: {
        create: {
          id: id(401),
          versionNumber: 1,
          slug: "speaker-guide",
          title: "Speaker guide",
          summary: "Everything a confirmed speaker needs before arriving in Portland.",
          bodyMarkdown:
            "# Speaker guide\n\nWelcome to Protospiel Summit 2026!\n\n## Before the event\n\n- Confirm your biography and upload a headshot in the portal.\n- Slides are due one week before your session.\n\n## On site\n\nCheck in at the Grand Hall speaker desk 30 minutes before your slot. AV staff will be in every room.",
          sortOrder: 0,
          publishedAt: new Date("2026-07-15T16:00:00.000Z"),
        },
      },
    },
  });
}

async function createSummitPartners(
  tx: TransactionClient,
  eventId: string,
  userId: (email: string) => string,
): Promise<void> {
  await tx.contactGroupTier.createMany({
    data: [
      { id: id(420), eventId, kind: ContactGroupKind.SPONSOR, name: "Gold", sortOrder: 0 },
      { id: id(421), eventId, kind: ContactGroupKind.SPONSOR, name: "Silver", sortOrder: 1 },
      { id: id(422), eventId, kind: ContactGroupKind.EXHIBITOR, name: "Standard booth", sortOrder: 0 },
    ],
  });

  await tx.contact.createMany({
    data: [
      {
        id: id(410),
        eventId,
        personId: id(159),
        email: "nora.fields@example.test",
        givenName: "Nora",
        familyName: "Fields",
        organization: "Meeple Mart",
        jobTitle: "Events lead",
        phone: "+1 503 555 0141",
      },
      {
        id: id(411),
        eventId,
        email: "owen.park@example.test",
        givenName: "Owen",
        familyName: "Park",
        organization: "Dice & Decks",
        jobTitle: "Marketing director",
        phone: "+1 503 555 0192",
      },
      {
        id: id(412),
        eventId,
        email: "petra.novak@example.test",
        givenName: "Petra",
        familyName: "Novak",
        organization: "Cardboard Cafe",
        jobTitle: "Owner",
      },
      {
        id: id(413),
        eventId,
        email: "quinn.harper@example.test",
        givenName: "Quinn",
        familyName: "Harper",
        organization: "Dice & Decks",
        jobTitle: "Community manager",
      },
    ],
  });

  await tx.contactGroup.create({
    data: {
      id: id(430),
      eventId,
      kind: ContactGroupKind.SPONSOR,
      name: "Dice & Decks",
      slug: "dice-and-decks",
      tierId: id(420),
      primaryContactId: id(411),
      members: { create: [{ contactId: id(411) }, { contactId: id(413) }] },
    },
  });
  await tx.contactGroup.create({
    data: {
      id: id(431),
      eventId,
      kind: ContactGroupKind.EXHIBITOR,
      name: "Meeple Mart",
      slug: "meeple-mart",
      tierId: id(422),
      primaryContactId: id(410),
      members: { create: { contactId: id(410) } },
    },
  });
  await tx.contactGroup.create({
    data: {
      id: id(432),
      eventId,
      kind: ContactGroupKind.EXHIBITOR,
      name: "Cardboard Cafe",
      slug: "cardboard-cafe",
      tierId: id(422),
      primaryContactId: id(412),
      members: { create: { contactId: id(412) } },
    },
  });

  await tx.contactGroupIntakeForm.create({
    data: {
      id: id(450),
      eventId,
      kind: ContactGroupKind.EXHIBITOR,
      publicId: id(455),
      status: ContactGroupIntakeFormStatus.PUBLISHED,
      title: "Exhibit at Protospiel Summit 2026",
      description:
        "Apply for a booth in the exhibitor hall. Standard booths include a table, two chairs, and two badges.",
      publishedAt: new Date("2026-04-01T16:00:00.000Z"),
      submissions: {
        create: [
          {
            id: id(451),
            status: ContactGroupIntakeSubmissionStatus.PENDING,
            organizationName: "Rook & Riddle",
            organizationSlug: "rook-and-riddle",
            contactGivenName: "Tessa",
            contactFamilyName: "Bloom",
            contactEmail: "tessa.bloom@example.test",
            contactJobTitle: "Founder",
            createdAt: new Date("2026-08-04T16:00:00.000Z"),
          },
          {
            id: id(452),
            status: ContactGroupIntakeSubmissionStatus.ACCEPTED,
            organizationName: "Cardboard Cafe",
            organizationSlug: "cardboard-cafe",
            contactGivenName: "Petra",
            contactFamilyName: "Novak",
            contactEmail: "petra.novak@example.test",
            contactJobTitle: "Owner",
            acceptedGroupId: id(432),
            acceptedContactId: id(412),
            reviewedById: userId("marcus@tabletopguild.test"),
            reviewedAt: new Date("2026-07-10T16:00:00.000Z"),
            createdAt: new Date("2026-07-08T16:00:00.000Z"),
          },
        ],
      },
    },
  });

  await tx.fileRequest.create({
    data: {
      id: id(460),
      eventId,
      key: "booth-insurance",
      targetKind: FileRequestTargetKind.GROUP,
      versions: {
        create: {
          id: id(461),
          versionNumber: 1,
          title: "Certificate of insurance",
          instructions: "Upload a certificate of liability insurance naming Tabletop Guild as additional insured.",
          dueOffsetDays: 30,
          allowedContentTypes: ["application/pdf"],
          maxBytes: 10_485_760,
        },
      },
    },
  });
  await tx.fileRequestAssignment.create({
    data: {
      id: id(462),
      eventId,
      requestId: id(460),
      requestVersionId: id(461),
      groupId: id(431),
      status: FileRequestAssignmentStatus.FULFILLED,
      dueAt: new Date("2026-09-16T16:00:00.000Z"),
      assignedAt: new Date("2026-07-15T16:00:00.000Z"),
      fulfilledAt: new Date("2026-07-29T16:00:00.000Z"),
      files: {
        create: {
          id: id(464),
          uploadedByContactId: id(410),
          objectKey: "demo/file-requests/booth-insurance-meeple-mart.pdf",
          fileName: "meeple-mart-coi.pdf",
          contentType: "application/pdf",
          size: 182_044,
          uploadedAt: new Date("2026-07-29T16:00:00.000Z"),
        },
      },
    },
  });
  await tx.fileRequestAssignment.create({
    data: {
      id: id(463),
      eventId,
      requestId: id(460),
      requestVersionId: id(461),
      groupId: id(432),
      status: FileRequestAssignmentStatus.PENDING,
      dueAt: new Date("2026-09-16T16:00:00.000Z"),
      assignedAt: new Date("2026-07-15T16:00:00.000Z"),
    },
  });

  await tx.fileRequest.create({
    data: {
      id: id(465),
      eventId,
      key: "session-slides",
      targetKind: FileRequestTargetKind.SUBMISSION,
      versions: {
        create: {
          id: id(466),
          versionNumber: 1,
          title: "Session slides",
          instructions: "Upload your final slides as a PDF at least one week before your session.",
          dueOffsetDays: 60,
          allowedContentTypes: ["application/pdf"],
          maxBytes: 52_428_800,
        },
      },
    },
  });
  await tx.fileRequestAssignment.create({
    data: {
      id: id(467),
      eventId,
      requestId: id(465),
      requestVersionId: id(466),
      submissionId: id(160),
      status: FileRequestAssignmentStatus.PENDING,
      dueAt: new Date("2026-10-09T16:00:00.000Z"),
      assignedAt: new Date("2026-08-01T16:00:00.000Z"),
    },
  });

  await tx.customFieldDefinition.create({
    data: {
      id: id(470),
      eventId,
      entityType: CustomFieldEntityType.CONTACT,
      key: "dietary-notes",
      label: "Dietary notes",
      description: "Catering requirements for partner dinners.",
      type: CustomFieldType.SINGLE_LINE_TEXT,
      position: 0,
      characterLimit: 200,
    },
  });
  await tx.customFieldValue.create({
    data: {
      id: id(472),
      eventId,
      definitionId: id(470),
      contactId: id(410),
      value: "Vegetarian",
      normalizedText: "vegetarian",
    },
  });
  await tx.customFieldDefinition.create({
    data: {
      id: id(471),
      eventId,
      entityType: CustomFieldEntityType.CFP_SUBMISSION,
      key: "av-needs",
      label: "AV needs",
      description: "Anything beyond the standard projector and lapel mic.",
      type: CustomFieldType.LONG_TEXT,
      position: 0,
    },
  });
  await tx.customFieldValue.create({
    data: {
      id: id(473),
      eventId,
      definitionId: id(471),
      submissionId: id(160),
      value: "Needs a document camera for live prototype trimming.",
      normalizedText: "needs a document camera for live prototype trimming.",
    },
  });
}

async function createSummitWorkspace(tx: TransactionClient, eventId: string): Promise<void> {
  await tx.participantPortal.create({
    data: {
      id: id(500),
      eventId,
      name: "Speaker portal",
      slug: "speaker",
      welcomeMessage: "Track your proposals, speaking schedule, onboarding work, and event resources in one place.",
      accentColor: "neutral",
      sectionTitles: {},
      audienceRules: {},
      contentVisibility: {},
      profileFieldVisibility: {},
      isDefault: true,
      sortOrder: 0,
    },
  });

  await tx.savedReport.create({
    data: {
      id: id(510),
      eventId,
      name: "Sessions with speaker details",
      baseType: ReportBaseType.SESSION,
      columns: ["title", "track", "durationMinutes", "speakers", "speakerEmails"],
      filters: [],
    },
  });

  await tx.customDashboard.create({
    data: {
      id: id(520),
      eventId,
      name: "Submissions pipeline",
      template: CustomDashboardTemplate.SUBMISSIONS_PIPELINE,
      filters: {},
      widgets: {
        create: [
          {
            id: id(521),
            kind: DashboardWidgetKind.METRIC,
            dataSource: DashboardWidgetDataSource.SUBMISSION_TOTAL,
            title: "Submissions",
            position: 0,
            settings: { width: "compact" },
          },
          {
            id: id(522),
            kind: DashboardWidgetKind.CHART,
            dataSource: DashboardWidgetDataSource.SUBMISSIONS_BY_STATUS,
            title: "Submissions by status",
            position: 1,
            settings: { width: "wide" },
          },
          {
            id: id(523),
            kind: DashboardWidgetKind.LIST,
            dataSource: DashboardWidgetDataSource.RECENT_SUBMISSIONS,
            title: "Recent submissions",
            position: 2,
            settings: { width: "wide" },
          },
        ],
      },
    },
  });
}

async function createPlaytestEvent(tx: TransactionClient, userId: (email: string) => string): Promise<void> {
  const eventId = demoOrgFixture.playtestEventId;

  await tx.event.create({
    data: {
      id: eventId,
      orgId: demoOrgFixture.organizationId,
      name: "Winter Playtest Nights 2026",
      slug: demoOrgFixture.playtestEventSlug,
      type: EventType.MEETUP,
      location: "Seattle, WA",
      timezone: "America/Los_Angeles",
      startsAt: new Date("2026-12-05T02:00:00.000Z"),
      endsAt: new Date("2026-12-06T06:00:00.000Z"),
      theme: "Two evenings of structured playtesting",
      rooms: { create: { id: id(601), name: "Community Room", sortOrder: 0 } },
      tracks: { create: { id: id(602), name: "Playtesting", color: "violet", sortOrder: 0 } },
      cfpCategories: {
        create: {
          id: id(603),
          key: "playtest-slot",
          label: "Playtest slot",
          description: "Bring a prototype and a table of testers will play it.",
        },
      },
      cfpAdministrators: {
        create: { id: id(613), externalId: "demo-user-marcus", displayName: "Marcus Webb" },
      },
      cfpForms: {
        create: {
          id: id(604),
          key: "playtest-signup",
          versions: {
            create: {
              id: id(605),
              versionNumber: 1,
              schemaVersion: 1,
              title: "Winter Playtest Nights signup",
              description: "Tell us about the prototype you want tested.",
              customTypes: [],
              categories: [{ id: "playtest-slot", label: "Playtest slot" }],
              steps: {
                create: [
                  {
                    id: id(606),
                    key: "speaker",
                    kind: "speaker",
                    title: "Designer",
                    sortOrder: 0,
                    questions: {
                      create: {
                        id: id(607),
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
                    id: id(608),
                    key: "prototype",
                    kind: "questions",
                    title: "Your prototype",
                    sortOrder: 1,
                    questions: {
                      create: {
                        id: id(609),
                        key: "abstract",
                        type: "long_text",
                        label: "Describe your prototype and what feedback you need",
                        required: true,
                        constraints: { minLength: 20, maxLength: 1_000 },
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
          id: id(615),
          personId: id(156),
          normalizedEmail: "lena.fischer@example.test",
          workflowStatus: SpeakerWorkflowStatus.CONFIRMED,
          profileVersions: {
            create: {
              id: id(616),
              versionNumber: 1,
              email: "lena.fischer@example.test",
              givenName: "Lena",
              familyName: "Fischer",
              organization: "Werkstatt Spiele",
              jobTitle: "Playtest coordinator",
              biography: "Lena runs structured playtest circuits across the Pacific Northwest.",
              consentToPublishProfile: true,
              consentToReceiveEmail: true,
              consentedAt: new Date("2026-07-20T16:00:00.000Z"),
            },
          },
        },
      },
    },
  });

  await tx.cfpPolicy.create({
    data: {
      id: id(610),
      eventId,
      key: "playtest-signup",
      publicId: id(614),
      status: CfpPolicyStatus.PUBLISHED,
      publishedFormVersionId: id(605),
      versions: {
        create: {
          id: id(611),
          versionNumber: 1,
          submissionOpensAt: new Date("2026-07-01T07:00:00.000Z"),
          submissionClosesAt: new Date("2026-11-01T07:00:00.000Z"),
          draftPolicy: CfpDraftPolicy.ALLOWED,
          submissionLimits: { maxSubmissionsPerSpeaker: 2, maxParticipantsPerSubmission: 2 },
          messages: {
            introduction: "Sign up for a playtest slot at Winter Playtest Nights.",
            submissionConfirmation: "You're on the list — we'll confirm your table assignment in November.",
            closed: "Signups for this winter's playtest nights are closed.",
          },
          conditionalVisibility: [],
          adminAssignments: {
            create: {
              administratorId: id(613),
              role: CfpAdminRole.OWNER,
              notifyOnNewSubmission: true,
              notifyOnSubmissionUpdate: true,
            },
          },
        },
      },
      transitions: {
        create: {
          toStatus: CfpPolicyStatus.PUBLISHED,
          actorAdministratorId: id(613),
          occurredAt: new Date("2026-07-01T07:00:00.000Z"),
        },
      },
    },
  });

  await tx.cfpSubmission.create({
    data: {
      id: id(620),
      eventId,
      formVersionId: id(605),
      kind: CfpSubmissionKind.ABSTRACT,
      status: CfpSubmissionStatus.SUBMITTED,
      submittedAt: new Date("2026-08-03T16:00:00.000Z"),
      revisions: {
        create: {
          id: id(621),
          versionNumber: 1,
          kind: CfpSubmissionRevisionKind.FINAL,
          formVersionId: id(605),
          definitionSnapshot: { title: "Winter Playtest Nights signup", schemaVersion: 1 },
          answers: {
            create: {
              id: id(622),
              questionId: "abstract",
              sortOrder: 0,
              value:
                "A 30-minute co-op dice placement game; I need feedback on the difficulty curve of the final round.",
            },
          },
        },
      },
      categories: { create: { categoryId: id(603), sortOrder: 0 } },
      participants: { create: { speakerId: id(615), sortOrder: 0 } },
      transitions: {
        create: {
          id: id(623),
          fromStatus: CfpSubmissionStatus.DRAFT,
          toStatus: CfpSubmissionStatus.SUBMITTED,
          actor: CfpSubmissionTransitionActor.SYSTEM,
          occurredAt: new Date("2026-08-03T16:00:00.000Z"),
        },
      },
    },
  });

  for (const email of ["mike@tabletopguild.test", "marcus@tabletopguild.test"]) {
    await tx.eventMembership.create({
      data: { eventId, userId: userId(email), roles: [EventMembershipRole.ORGANIZER_ADMIN] },
    });
  }
}

async function createSpeakerSourcing(tx: TransactionClient): Promise<void> {
  const eventId = demoOrgFixture.summitEventId;

  await tx.speakerInterestForm.create({
    data: {
      id: id(480),
      eventId,
      publicId: id(488),
      title: "Speak at a Tabletop Guild event",
      description: "Tell us what you'd like to present and we'll match you to an upcoming event.",
      publishedAt: new Date("2026-04-15T16:00:00.000Z"),
    },
  });

  await tx.speakerProspectStage.createMany({
    data: [
      { id: id(481), eventId, name: "New", behavior: SpeakerProspectStageBehavior.OPEN, sortOrder: 0 },
      { id: id(482), eventId, name: "In conversation", behavior: SpeakerProspectStageBehavior.NURTURE, sortOrder: 1 },
      { id: id(483), eventId, name: "Booked", behavior: SpeakerProspectStageBehavior.WON, sortOrder: 2 },
      { id: id(484), eventId, name: "Passed", behavior: SpeakerProspectStageBehavior.LOST, sortOrder: 3 },
    ],
  });

  await tx.speakerProspect.create({
    data: {
      id: id(485),
      eventId,
      personId: id(155),
      stageId: id(482),
      sourceFormId: id(480),
      sourceLabel: "Interest form",
      activities: {
        create: [
          {
            id: id(490),
            kind: SpeakerProspectActivityKind.CREATED,
            actor: SpeakerProspectActivityActor.AUTOMATION,
            actorLabel: "Interest form",
            createdAt: new Date("2026-05-02T16:00:00.000Z"),
          },
          {
            id: id(491),
            kind: SpeakerProspectActivityKind.STAGE_CHANGED,
            actor: SpeakerProspectActivityActor.USER,
            actorLabel: "Priya Raman",
            fromStageId: id(481),
            toStageId: id(482),
            createdAt: new Date("2026-06-10T16:00:00.000Z"),
          },
          {
            id: id(492),
            kind: SpeakerProspectActivityKind.NOTE_ADDED,
            actor: SpeakerProspectActivityActor.USER,
            actorLabel: "Priya Raman",
            note: "Interested in a dexterity-games session; better fit for spring.",
            createdAt: new Date("2026-06-10T16:05:00.000Z"),
          },
        ],
      },
    },
  });

  await tx.speakerProspect.create({
    data: {
      id: id(486),
      eventId,
      personId: id(156),
      stageId: id(483),
      sourceLabel: "Referral from Marcus",
      assignedEventId: demoOrgFixture.playtestEventId,
      assignedAt: new Date("2026-07-18T16:00:00.000Z"),
      activities: {
        create: [
          {
            id: id(493),
            kind: SpeakerProspectActivityKind.CREATED,
            actor: SpeakerProspectActivityActor.USER,
            actorLabel: "Marcus Webb",
            createdAt: new Date("2026-06-25T16:00:00.000Z"),
          },
          {
            id: id(494),
            kind: SpeakerProspectActivityKind.ASSIGNED_TO_EVENT,
            actor: SpeakerProspectActivityActor.USER,
            actorLabel: "Marcus Webb",
            note: "Booked to run Winter Playtest Nights tables.",
            fromStageId: id(482),
            toStageId: id(483),
            createdAt: new Date("2026-07-18T16:00:00.000Z"),
          },
        ],
      },
    },
  });

  await tx.speakerProspect.create({
    data: {
      id: id(487),
      eventId,
      personId: id(157),
      stageId: id(481),
      sourceFormId: id(480),
      sourceLabel: "Interest form",
      activities: {
        create: {
          id: id(495),
          kind: SpeakerProspectActivityKind.CREATED,
          actor: SpeakerProspectActivityActor.AUTOMATION,
          actorLabel: "Interest form",
          createdAt: new Date("2026-08-06T16:00:00.000Z"),
        },
      },
    },
  });
}
