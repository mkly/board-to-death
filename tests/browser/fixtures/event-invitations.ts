import { PrismaPg } from "@prisma/adapter-pg";

import {
  CfpSubmissionKind,
  CfpSubmissionStatus,
  EvaluationPlanVersionStatus,
  EvaluationRoundStatus,
  EventType,
  OrganizationMemberRole,
  PrismaClient,
  ReviewerVisibility,
} from "../../../src/generated/prisma/client.ts";
import { randomUUID } from "node:crypto";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://board_to_death:board_to_death@127.0.0.1:5432/board_to_death_test?schema=public";
const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

async function setup() {
  const suffix = randomUUID().slice(0, 8);
  const admin = await database.user.findUniqueOrThrow({ where: { email: "admin@example.test" } });
  const organization = await database.organization.create({
    data: {
      name: "Invitation Browser Org",
      slug: `invitation-browser-org-${suffix}`,
      members: { create: { userId: admin.id, role: OrganizationMemberRole.OWNER } },
    },
  });
  const event = await database.event.create({
    data: {
      orgId: organization.id,
      name: "Invitation Browser Summit",
      slug: `invitation-browser-${suffix}`,
      type: EventType.CONFERENCE,
      timezone: "America/Los_Angeles",
      startsAt: new Date("2027-08-01T16:00:00.000Z"),
      endsAt: new Date("2027-08-03T00:00:00.000Z"),
      cfpForms: {
        create: {
          key: "invitation-cfp",
          versions: {
            create: { versionNumber: 1, schemaVersion: 1, title: "Invited reviewer CFP", customTypes: [] },
          },
        },
      },
    },
    include: { cfpForms: { include: { versions: true } } },
  });
  const otherEvent = await database.event.create({
    data: {
      orgId: organization.id,
      name: "Other Invitation Browser Summit",
      slug: `other-invitation-browser-${suffix}`,
      type: EventType.CONFERENCE,
      timezone: "America/Los_Angeles",
      startsAt: new Date("2027-09-01T16:00:00.000Z"),
      endsAt: new Date("2027-09-03T00:00:00.000Z"),
    },
  });
  const formVersion = event.cfpForms[0]?.versions[0];
  if (!formVersion) throw new Error("Expected an invitation browser CFP version.");
  const submission = await database.cfpSubmission.create({
    data: {
      eventId: event.id,
      formVersionId: formVersion.id,
      kind: CfpSubmissionKind.ABSTRACT,
      status: CfpSubmissionStatus.UNDER_REVIEW,
      submittedAt: new Date("2027-07-01T18:00:00.000Z"),
      reviewStartedAt: new Date("2027-07-02T18:00:00.000Z"),
    },
  });
  const plan = await database.evaluationPlan.create({
    data: {
      eventId: event.id,
      key: "invitation-review",
      versions: {
        create: {
          versionNumber: 1,
          title: "Invitation review plan",
          status: EvaluationPlanVersionStatus.ACTIVE,
          activatedAt: new Date("2027-07-01T18:00:00.000Z"),
        },
      },
    },
    include: { versions: true },
  });
  const planVersion = plan.versions[0];
  if (!planVersion) throw new Error("Expected an invitation review plan version.");
  const round = await database.evaluationRound.create({
    data: {
      planVersionId: planVersion.id,
      key: "invitation-round",
      title: "Invitation review round",
      sortOrder: 0,
      status: EvaluationRoundStatus.OPEN,
      reviewerVisibility: ReviewerVisibility.BLIND,
      visibilitySnapshot: ReviewerVisibility.BLIND,
      opensAt: new Date("2027-07-01T18:00:00.000Z"),
    },
  });
  return {
    organizationId: organization.id,
    eventSlug: event.slug,
    otherEventSlug: otherEvent.slug,
    roundId: round.id,
    submissionId: submission.id,
  };
}

async function assign(roundId: string, submissionId: string, email: string) {
  const reviewer = await database.evaluationReviewer.findFirstOrThrow({ where: { email } });
  await database.evaluationAssignment.create({ data: { roundId, submissionId, reviewerId: reviewer.id } });
}

async function cleanup(organizationId: string) {
  await database.event.deleteMany({ where: { orgId: organizationId } });
  await database.organization.delete({ where: { id: organizationId } });
}

const [action, ...args] = process.argv.slice(2);
try {
  if (action === "setup") console.log(JSON.stringify(await setup()));
  else if (action === "assign") await assign(args[0] ?? "", args[1] ?? "", args[2] ?? "");
  else if (action === "cleanup") await cleanup(args[0] ?? "");
  else throw new Error(`Unknown event invitation fixture action: ${action ?? ""}`);
} finally {
  await database.$disconnect();
}
