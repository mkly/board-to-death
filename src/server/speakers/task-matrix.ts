import {
  type Prisma,
  type PrismaClient,
  ProgramSessionParticipantRole,
  type SpeakerTaskAssignmentStatus,
  SpeakerWorkflowStatus,
} from "../../generated/prisma/client.ts";

export const speakerTaskMatrixStates = ["outstanding", "overdue", "complete", "withdrawn", "not-applicable"] as const;

export type SpeakerTaskMatrixState = (typeof speakerTaskMatrixStates)[number];

export interface SpeakerTaskMatrixFilters {
  readonly search?: string;
  readonly state?: SpeakerTaskMatrixState;
  readonly taskId?: string;
  readonly speakerId?: string;
  readonly participantRole?: ProgramSessionParticipantRole;
  readonly workflowStatus?: SpeakerWorkflowStatus;
  readonly dueFrom?: string;
  readonly dueTo?: string;
}

export interface SpeakerTaskMatrixRow {
  readonly key: string;
  readonly speakerId: string;
  readonly speakerName: string;
  readonly speakerEmail: string;
  readonly workflowStatus: SpeakerWorkflowStatus;
  readonly participantRoles: readonly ProgramSessionParticipantRole[];
  readonly taskId: string;
  readonly taskTitle: string;
  readonly assignmentId: string | null;
  readonly assignmentStatus: SpeakerTaskAssignmentStatus | null;
  readonly state: SpeakerTaskMatrixState;
  readonly dueAt: Date | null;
  readonly completedAt: Date | null;
}

export interface SpeakerTaskMatrixResult {
  readonly rows: readonly SpeakerTaskMatrixRow[];
  readonly speakers: readonly { readonly id: string; readonly name: string }[];
  readonly roster: readonly {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly organization: string | null;
    readonly jobTitle: string | null;
    readonly workflowStatus: SpeakerWorkflowStatus;
  }[];
  readonly tasks: readonly { readonly id: string; readonly title: string }[];
  readonly counts: Readonly<Record<SpeakerTaskMatrixState, number>>;
}

export function parseSpeakerTaskMatrixFilters(searchParams: URLSearchParams): SpeakerTaskMatrixFilters {
  const stateValue = searchParams.get("state");
  const date = (name: string): string | undefined => {
    const value = searchParams.get(name);
    return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
  };
  return {
    search: searchParams.get("q")?.trim() || undefined,
    state: speakerTaskMatrixStates.includes(stateValue as SpeakerTaskMatrixState)
      ? (stateValue as SpeakerTaskMatrixState)
      : undefined,
    taskId: searchParams.get("task") || undefined,
    speakerId: searchParams.get("speaker") || undefined,
    participantRole: Object.values(ProgramSessionParticipantRole).includes(
      searchParams.get("participantRole") as ProgramSessionParticipantRole,
    )
      ? (searchParams.get("participantRole") as ProgramSessionParticipantRole)
      : undefined,
    workflowStatus: Object.values(SpeakerWorkflowStatus).includes(
      searchParams.get("workflowStatus") as SpeakerWorkflowStatus,
    )
      ? (searchParams.get("workflowStatus") as SpeakerWorkflowStatus)
      : undefined,
    dueFrom: date("dueFrom"),
    dueTo: date("dueTo"),
  };
}

const speakerInclude = {
  profileVersions: { orderBy: { versionNumber: "desc" }, take: 1 },
  submissions: {
    where: { submission: { status: { in: ["ACCEPTED", "CONFIRMED"] } } },
    select: { submission: { select: { status: true } } },
  },
  programSessionParticipants: {
    select: {
      role: true,
      sessionVersion: {
        select: {
          id: true,
          session: {
            select: {
              kind: true,
              archivedAt: true,
              versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { id: true } },
            },
          },
        },
      },
    },
  },
} as const satisfies Prisma.SpeakerInclude;

const definitionInclude = {
  versions: { orderBy: { versionNumber: "desc" }, take: 1 },
} as const satisfies Prisma.SpeakerTaskDefinitionInclude;

function objectValue(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : null;
}

function stringList(value: Prisma.JsonValue | undefined): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function speakerName(profile: { givenName: string; familyName: string; preferredName: string | null }): string {
  return `${profile.preferredName ?? profile.givenName} ${profile.familyName}`;
}

function localDate(value: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).format(value);
}

function stateFor(
  assignment: { status: SpeakerTaskAssignmentStatus; dueAt: Date | null },
  today: string,
  timezone: string,
): SpeakerTaskMatrixState {
  if (assignment.status === "WITHDRAWN") return "withdrawn";
  if (assignment.status === "APPROVED") return "complete";
  if (assignment.dueAt && localDate(assignment.dueAt, timezone) < today) return "overdue";
  return "outstanding";
}

function isApplicable(
  applicability: Prisma.JsonValue,
  speaker: Prisma.SpeakerGetPayload<{ include: typeof speakerInclude }>,
): boolean {
  const rules = objectValue(applicability);
  if (rules?.confirmedOnly === true) {
    const confirmed = speaker.submissions.some(({ submission }) => submission.status === "CONFIRMED");
    if (!confirmed) return false;
  }
  const sessionKinds = stringList(rules?.sessionKinds);
  if (sessionKinds.length === 0) return true;
  return speaker.programSessionParticipants.some(({ sessionVersion }) => {
    const session = sessionVersion.session;
    return (
      session.archivedAt === null &&
      session.versions[0]?.id === sessionVersion.id &&
      sessionKinds.includes(session.kind)
    );
  });
}

function currentParticipantRoles(
  speaker: Prisma.SpeakerGetPayload<{ include: typeof speakerInclude }>,
): readonly ProgramSessionParticipantRole[] {
  return [
    ...new Set(
      speaker.programSessionParticipants.flatMap(({ role, sessionVersion }) =>
        sessionVersion.session.archivedAt === null && sessionVersion.session.versions[0]?.id === sessionVersion.id
          ? [role]
          : [],
      ),
    ),
  ].toSorted();
}

function matchesDueDate(row: SpeakerTaskMatrixRow, filters: SpeakerTaskMatrixFilters, timezone: string): boolean {
  if (!filters.dueFrom && !filters.dueTo) return true;
  if (!row.dueAt) return false;
  const dueDate = localDate(row.dueAt, timezone);
  return (!filters.dueFrom || dueDate >= filters.dueFrom) && (!filters.dueTo || dueDate <= filters.dueTo);
}

export class SpeakerTaskMatrixRepository {
  private readonly client: PrismaClient;
  private readonly now: () => Date;

  constructor(client: PrismaClient, now: () => Date = () => new Date()) {
    this.client = client;
    this.now = now;
  }

  async list(
    eventId: string,
    timezone: string,
    filters: SpeakerTaskMatrixFilters = {},
  ): Promise<SpeakerTaskMatrixResult> {
    const [rosterSpeakers, speakers, definitions, assignments] = await Promise.all([
      this.client.speaker.findMany({
        where: { eventId },
        include: speakerInclude,
        orderBy: [{ normalizedEmail: "asc" }, { id: "asc" }],
      }),
      this.client.speaker.findMany({
        where: {
          eventId,
          submissions: { some: { submission: { eventId, status: { in: ["ACCEPTED", "CONFIRMED"] } } } },
        },
        include: speakerInclude,
        orderBy: [{ normalizedEmail: "asc" }, { id: "asc" }],
      }),
      this.client.speakerTaskDefinition.findMany({
        where: { eventId, archivedAt: null },
        include: definitionInclude,
      }),
      this.client.speakerTaskAssignment.findMany({
        where: { eventId },
        orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
      }),
    ]);
    const tasks = definitions
      .flatMap((definition) => {
        const version = definition.versions[0];
        return version ? [{ id: definition.id, title: version.title, version }] : [];
      })
      .sort((left, right) => left.version.sortOrder - right.version.sortOrder || left.title.localeCompare(right.title));
    const latestAssignments = new Map<string, (typeof assignments)[number]>();
    for (const assignment of assignments) {
      const key = `${assignment.speakerId}:${assignment.definitionId}`;
      if (!latestAssignments.has(key)) latestAssignments.set(key, assignment);
    }
    const today = localDate(this.now(), timezone);
    const allRows: SpeakerTaskMatrixRow[] = [];
    for (const speaker of speakers) {
      const profile = speaker.profileVersions[0];
      if (!profile) continue;
      const participantRoles = currentParticipantRoles(speaker);
      for (const task of tasks) {
        const key = `${speaker.id}:${task.id}`;
        const assignment = latestAssignments.get(key);
        let state: SpeakerTaskMatrixState = "not-applicable";
        if (assignment) state = stateFor(assignment, today, timezone);
        else if (isApplicable(task.version.applicability, speaker)) state = "outstanding";
        allRows.push({
          key,
          speakerId: speaker.id,
          speakerName: speakerName(profile),
          speakerEmail: profile.email,
          workflowStatus: speaker.workflowStatus,
          participantRoles,
          taskId: task.id,
          taskTitle: task.title,
          assignmentId: assignment?.id ?? null,
          assignmentStatus: assignment?.status ?? null,
          state,
          dueAt: assignment?.dueAt ?? null,
          completedAt: assignment?.completedAt ?? null,
        });
      }
    }
    const search = filters.search?.trim().toLocaleLowerCase();
    const rows = allRows.filter(
      (row) =>
        (!search ||
          row.speakerName.toLocaleLowerCase().includes(search) ||
          row.speakerEmail.toLocaleLowerCase().includes(search) ||
          row.taskTitle.toLocaleLowerCase().includes(search)) &&
        (!filters.state || row.state === filters.state) &&
        (!filters.taskId || row.taskId === filters.taskId) &&
        (!filters.speakerId || row.speakerId === filters.speakerId) &&
        (!filters.participantRole || row.participantRoles.includes(filters.participantRole)) &&
        (!filters.workflowStatus || row.workflowStatus === filters.workflowStatus) &&
        matchesDueDate(row, filters, timezone),
    );
    const counts = Object.fromEntries(
      speakerTaskMatrixStates.map((state) => [state, allRows.filter((row) => row.state === state).length]),
    ) as Record<SpeakerTaskMatrixState, number>;
    const roster = rosterSpeakers.flatMap((speaker) => {
      const profile = speaker.profileVersions[0];
      if (!profile) return [];
      return [
        {
          id: speaker.id,
          name: speakerName(profile),
          email: profile.email,
          organization: profile.organization,
          jobTitle: profile.jobTitle,
          workflowStatus: speaker.workflowStatus,
        },
      ];
    });
    return {
      rows,
      speakers: roster.map(({ id, name }) => ({ id, name })),
      roster: roster.filter(
        (speaker) =>
          (!search ||
            speaker.name.toLocaleLowerCase().includes(search) ||
            speaker.email.toLocaleLowerCase().includes(search) ||
            speaker.organization?.toLocaleLowerCase().includes(search) ||
            speaker.jobTitle?.toLocaleLowerCase().includes(search)) &&
          (!filters.speakerId || speaker.id === filters.speakerId) &&
          (!filters.workflowStatus || speaker.workflowStatus === filters.workflowStatus),
      ),
      tasks: tasks.map(({ id, title }) => ({ id, title })),
      counts,
    };
  }
}

function safeCsvCell(value: string): string {
  const neutralized = /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${neutralized.replaceAll('"', '""')}"`;
}

export function createSpeakerTaskMatrixCsv(rows: readonly SpeakerTaskMatrixRow[], timezone: string): Uint8Array {
  const table = [
    [
      "speakerId",
      "speaker",
      "email",
      "workflowStatus",
      "participantRoles",
      "taskId",
      "task",
      "state",
      "assignmentStatus",
      "dueDate",
      "completedAt",
    ],
    ...rows.map((row) => [
      row.speakerId,
      row.speakerName,
      row.speakerEmail,
      row.workflowStatus,
      row.participantRoles.join("|"),
      row.taskId,
      row.taskTitle,
      row.state,
      row.assignmentStatus ?? "",
      row.dueAt ? localDate(row.dueAt, timezone) : "",
      row.completedAt?.toISOString() ?? "",
    ]),
  ];
  const body = table.map((row) => row.map(safeCsvCell).join(",")).join("\r\n");
  return new TextEncoder().encode(`\uFEFF${body}\r\n`);
}
