import type { Prisma } from "@/generated/prisma/client";
import type { PersistedSpeakerTaskDefinition } from "@/server/speakers";

import type { TaskDefinitionView, TaskResponseType } from "./types";

function objectValue(value: Prisma.JsonValue): Prisma.JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function responseType(value: Prisma.JsonValue | null): TaskResponseType {
  const schema = value === null ? null : objectValue(value);
  if (schema?.type === "string") return "TEXT";
  if (schema?.type === "object") return "FILE";
  return "NONE";
}

export function taskDefinitionView(definition: PersistedSpeakerTaskDefinition): TaskDefinitionView {
  const latest = definition.versions.at(-1);
  if (!latest) throw new Error(`Task definition ${definition.id} has no versions.`);
  const applicability = objectValue(latest.applicability);
  const rawSessionKinds = applicability?.sessionKinds;
  return {
    id: definition.id,
    key: definition.key,
    archivedAt: definition.archivedAt?.toISOString() ?? null,
    versionNumber: latest.versionNumber,
    sortOrder: latest.sortOrder,
    title: latest.title,
    description: latest.description,
    confirmedOnly: applicability?.confirmedOnly === true,
    sessionKinds: Array.isArray(rawSessionKinds)
      ? rawSessionKinds.filter((value): value is string => typeof value === "string")
      : [],
    defaultDueOffsetDays: latest.defaultDueOffsetDays,
    responseType: latest.responseRequired ? responseType(latest.responseSchema) : "NONE",
  };
}
