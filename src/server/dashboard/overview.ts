import { CfpSubmissionStatus, EvaluationAssignmentStatus, type PrismaClient } from "../../generated/prisma/client.ts";
import { SpeakerTaskMatrixRepository, type SpeakerTaskMatrixState } from "../speakers/task-matrix.ts";

export interface EventOverviewSubmission {
  readonly id: string;
  readonly formTitle: string;
  readonly applicantNames: readonly string[];
  readonly status: CfpSubmissionStatus;
  readonly submittedAt: Date;
}

export interface EventOverviewSpeaker {
  readonly id: string;
  readonly name: string;
}

export interface EventOverviewSession {
  readonly id: string;
  readonly title: string;
  readonly trackId: string | null;
}

export interface EventOverviewMetrics {
  readonly submissions: {
    readonly total: number;
    readonly byStatus: Readonly<Record<CfpSubmissionStatus, number>>;
    readonly submittedLast7Days: number;
    readonly recent: readonly EventOverviewSubmission[];
  };
  readonly participants: {
    readonly total: number;
    readonly missingBiography: readonly EventOverviewSpeaker[];
    readonly missingHeadshot: readonly EventOverviewSpeaker[];
  };
  readonly speakerTasks: {
    readonly counts: Readonly<Record<SpeakerTaskMatrixState, number>>;
  };
  readonly evaluations: {
    readonly totalAssignments: number;
    readonly completedAssignments: number;
  };
  readonly sessions: {
    readonly unscheduled: readonly EventOverviewSession[];
  };
}

function emptyStatusMetrics(): Record<CfpSubmissionStatus, number> {
  return Object.fromEntries(Object.values(CfpSubmissionStatus).map((status) => [status, 0])) as Record<
    CfpSubmissionStatus,
    number
  >;
}

function profileName(profile: { givenName: string; familyName: string; preferredName: string | null }): string {
  return profile.preferredName ?? `${profile.givenName} ${profile.familyName}`;
}

export class EventOverviewRepository {
  private readonly client: PrismaClient;
  private readonly now: () => Date;

  constructor(client: PrismaClient, now: () => Date = () => new Date()) {
    this.client = client;
    this.now = now;
  }

  async get(eventId: string, timezone: string): Promise<EventOverviewMetrics> {
    const sevenDaysAgo = new Date(this.now().getTime() - 7 * 24 * 60 * 60 * 1000);
    const [
      submissionTotal,
      groupedStatuses,
      submittedLast7Days,
      recentSubmissions,
      participantTotal,
      speakersWithProfile,
      taskMatrix,
      totalAssignments,
      completedAssignments,
      unscheduledSessions,
    ] = await Promise.all([
      this.client.cfpSubmission.count({ where: { eventId } }),
      this.client.cfpSubmission.groupBy({ by: ["status"], where: { eventId }, _count: { _all: true } }),
      this.client.cfpSubmission.count({ where: { eventId, submittedAt: { gte: sevenDaysAgo } } }),
      this.client.cfpSubmission.findMany({
        where: { eventId, submittedAt: { not: null } },
        orderBy: { submittedAt: "desc" },
        take: 5,
        select: {
          id: true,
          status: true,
          submittedAt: true,
          formVersion: { select: { title: true } },
          participants: {
            orderBy: { sortOrder: "asc" },
            select: {
              speaker: {
                select: {
                  profileVersions: {
                    orderBy: { versionNumber: "desc" },
                    take: 1,
                    select: { givenName: true, familyName: true, preferredName: true },
                  },
                },
              },
            },
          },
        },
      }),
      this.client.speaker.count({ where: { eventId } }),
      this.client.speaker.findMany({
        where: { eventId },
        select: {
          id: true,
          profileVersions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
            select: {
              givenName: true,
              familyName: true,
              preferredName: true,
              biography: true,
              photoObjectKey: true,
            },
          },
        },
      }),
      new SpeakerTaskMatrixRepository(this.client, this.now).list(eventId, timezone),
      this.client.evaluationAssignment.count({
        where: { round: { planVersion: { plan: { eventId } } }, revokedAt: null },
      }),
      this.client.evaluationAssignment.count({
        where: {
          round: { planVersion: { plan: { eventId } } },
          revokedAt: null,
          status: EvaluationAssignmentStatus.COMPLETED,
        },
      }),
      this.client.programSession.findMany({
        where: {
          eventId,
          archivedAt: null,
          agendaPlacement: null,
          // Sessions promoted from a submission only need a slot while that submission is still
          // accepted; manually created sessions have no submission to accept and always count.
          OR: [
            { sourceSubmissionId: null },
            {
              sourceSubmission: {
                status: { in: [CfpSubmissionStatus.ACCEPTED, CfpSubmissionStatus.CONFIRMED] },
              },
            },
          ],
        },
        select: {
          id: true,
          versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { title: true, trackId: true } },
        },
      }),
    ]);

    const byStatus = emptyStatusMetrics();
    for (const group of groupedStatuses) byStatus[group.status] = group._count._all;

    const missingBiography: EventOverviewSpeaker[] = [];
    const missingHeadshot: EventOverviewSpeaker[] = [];
    for (const speaker of speakersWithProfile) {
      const profile = speaker.profileVersions[0];
      if (!profile) continue;
      const name = profileName(profile);
      if (!profile.biography || profile.biography.trim() === "") missingBiography.push({ id: speaker.id, name });
      if (!profile.photoObjectKey) missingHeadshot.push({ id: speaker.id, name });
    }

    return {
      submissions: {
        total: submissionTotal,
        byStatus,
        submittedLast7Days,
        recent: recentSubmissions.flatMap((submission) => {
          if (!submission.submittedAt) return [];
          return [
            {
              id: submission.id,
              formTitle: submission.formVersion.title,
              applicantNames: submission.participants.flatMap(({ speaker }) => {
                const profile = speaker.profileVersions[0];
                return profile ? [profileName(profile)] : [];
              }),
              status: submission.status,
              submittedAt: submission.submittedAt,
            },
          ];
        }),
      },
      participants: {
        total: participantTotal,
        missingBiography,
        missingHeadshot,
      },
      speakerTasks: { counts: taskMatrix.counts },
      evaluations: {
        totalAssignments,
        completedAssignments,
      },
      sessions: {
        unscheduled: unscheduledSessions.map((session) => ({
          id: session.id,
          title: session.versions[0]?.title ?? "Untitled session",
          trackId: session.versions[0]?.trackId ?? null,
        })),
      },
    };
  }
}
