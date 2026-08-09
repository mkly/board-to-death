import type { PrismaClient } from "../../generated/prisma/client.ts";
import { EvaluationStatus, ReportBaseType } from "../../generated/prisma/client.ts";
import { type ReportDefinition, reportCatalog, validateReportDefinition } from "./catalog.ts";

export type ReportCell = string | number | boolean | null;

export interface ReportResult {
  readonly columns: readonly { readonly id: string; readonly label: string }[];
  readonly rows: readonly { readonly id: string; readonly values: Readonly<Record<string, ReportCell>> }[];
}

interface ReportRow {
  readonly id: string;
  readonly values: Readonly<Record<string, ReportCell>>;
}

function average(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function displayName(profile: { givenName: string; familyName: string; preferredName: string | null }): string {
  return profile.preferredName ?? `${profile.givenName} ${profile.familyName}`;
}

function compare(cell: ReportCell, operator: ReportDefinition["filters"][number]["operator"], raw: string): boolean {
  const text = cell === null ? "" : String(cell);
  if (operator === "contains") return text.toLocaleLowerCase().includes(raw.toLocaleLowerCase());
  if (operator === "equals") return text.toLocaleLowerCase() === raw.toLocaleLowerCase();
  if (operator === "notEquals") return text.toLocaleLowerCase() !== raw.toLocaleLowerCase();
  const left = typeof cell === "number" ? cell : Date.parse(text);
  const right = typeof cell === "number" ? Number(raw) : Date.parse(raw);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return operator === "greaterThan" ? left > right : left < right;
}

function filteredRows(
  rows: readonly { readonly id: string; readonly values: Readonly<Record<string, ReportCell>> }[],
  definition: ReportDefinition,
) {
  return rows.filter((row) =>
    definition.filters.every((filter) => compare(row.values[filter.column] ?? null, filter.operator, filter.value)),
  );
}

async function sessionRows(client: PrismaClient, eventId: string) {
  const sessions = await client.programSession.findMany({
    where: { eventId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      agendaPlacement: { include: { room: { select: { name: true } } } },
      sourceSubmission: {
        include: {
          evaluationAssignments: { include: { evaluation: { include: { results: { select: { score: true } } } } } },
        },
      },
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        include: {
          track: { select: { name: true } },
          participants: {
            orderBy: { sortOrder: "asc" },
            include: { speaker: { include: { profileVersions: { orderBy: { versionNumber: "desc" }, take: 1 } } } },
          },
        },
      },
    },
  });
  return sessions.flatMap((session) => {
    const version = session.versions[0];
    if (!version) return [];
    const profiles = version.participants.flatMap(({ speaker }) => speaker.profileVersions);
    const ratings =
      session.sourceSubmission?.evaluationAssignments.flatMap(
        ({ evaluation }) => evaluation?.results.flatMap(({ score }) => (score === null ? [] : [Number(score)])) ?? [],
      ) ?? [];
    return [
      {
        id: session.id,
        values: {
          title: version.title,
          kind: session.kind,
          durationMinutes: version.durationMinutes,
          track: version.track?.name ?? null,
          speakers: profiles.map(displayName).join(", "),
          speakerEmails: profiles.map(({ email }) => email).join(", "),
          averageRating: average(ratings),
          scheduledStart: session.agendaPlacement?.startsAt.toISOString() ?? null,
          room: session.agendaPlacement?.room.name ?? null,
          archived: session.archivedAt !== null,
        },
      },
    ];
  });
}

async function contactRows(client: PrismaClient, eventId: string) {
  const contacts = await client.contact.findMany({
    where: { eventId },
    orderBy: [{ familyName: "asc" }, { givenName: "asc" }, { id: "asc" }],
    include: { memberships: { include: { group: { select: { name: true } } } } },
  });
  return contacts.map((contact) => ({
    id: contact.id,
    values: {
      givenName: contact.givenName,
      familyName: contact.familyName,
      email: contact.email,
      organization: contact.organization,
      jobTitle: contact.jobTitle,
      phone: contact.phone,
      groups: contact.memberships.map(({ group }) => group.name).join(", "),
      archived: contact.archivedAt !== null,
    },
  }));
}

async function groupRows(client: PrismaClient, eventId: string) {
  const groups = await client.contactGroup.findMany({
    where: { eventId },
    orderBy: [{ kind: "asc" }, { name: "asc" }, { id: "asc" }],
    include: { members: { include: { contact: true } } },
  });
  return groups.map((group) => ({
    id: group.id,
    values: {
      name: group.name,
      kind: group.kind,
      slug: group.slug,
      memberCount: group.members.length,
      members: group.members.map(({ contact }) => `${contact.givenName} ${contact.familyName}`).join(", "),
      memberEmails: group.members.map(({ contact }) => contact.email).join(", "),
      archived: group.archivedAt !== null,
    },
  }));
}

async function evaluationPlanRows(client: PrismaClient, eventId: string) {
  const plans = await client.evaluationPlan.findMany({
    where: { eventId },
    orderBy: [{ key: "asc" }, { id: "asc" }],
    include: {
      versions: {
        orderBy: { versionNumber: "asc" },
        include: {
          rounds: {
            include: {
              assignments: { include: { evaluation: { include: { results: { select: { score: true } } } } } },
            },
          },
        },
      },
    },
  });
  return plans.flatMap((plan) =>
    plan.versions.map((version) => {
      const assignments = version.rounds.flatMap(({ assignments }) => assignments);
      const ratings = assignments.flatMap(
        ({ evaluation }) => evaluation?.results.flatMap(({ score }) => (score === null ? [] : [Number(score)])) ?? [],
      );
      return {
        id: version.id,
        values: {
          key: plan.key,
          title: version.title,
          status: version.status,
          versionNumber: version.versionNumber,
          roundCount: version.rounds.length,
          assignmentCount: assignments.length,
          completedEvaluations: assignments.filter(({ evaluation }) => evaluation?.status === EvaluationStatus.FINAL)
            .length,
          averageRating: average(ratings),
          activatedAt: version.activatedAt?.toISOString() ?? null,
        },
      };
    }),
  );
}

export async function runReport(client: PrismaClient, eventId: string, input: ReportDefinition): Promise<ReportResult> {
  const definition = validateReportDefinition(input);
  let rows: readonly ReportRow[];
  switch (definition.baseType) {
    case ReportBaseType.SESSION:
      rows = await sessionRows(client, eventId);
      break;
    case ReportBaseType.CONTACT:
      rows = await contactRows(client, eventId);
      break;
    case ReportBaseType.GROUP:
      rows = await groupRows(client, eventId);
      break;
    case ReportBaseType.EVALUATION_PLAN:
      rows = await evaluationPlanRows(client, eventId);
      break;
  }
  const definitions = new Map(reportCatalog[definition.baseType].map((column) => [column.id, column]));
  return {
    columns: definition.columns.map((id) => ({ id, label: definitions.get(id)?.label ?? id })),
    rows: filteredRows(rows, definition).map(({ id, values }) => ({
      id,
      values: Object.fromEntries(definition.columns.map((column) => [column, values[column] ?? null])),
    })),
  };
}
