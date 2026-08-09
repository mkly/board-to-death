import { notFound } from "next/navigation";

import { CustomFieldRepository } from "@/server/custom-fields/repositories";
import { getDatabaseClient } from "@/server/database/client";

import { getDashboardShellData } from "../../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../../_lib/dashboard-shell";
import { CustomFieldWorkspace } from "./_components/custom-field-workspace";

interface CustomFieldsPageProps {
  readonly params: Promise<{ eventSlug: string }>;
}

export default async function CustomFieldsPage({ params }: CustomFieldsPageProps) {
  const [{ eventSlug }, shell] = await Promise.all([params, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event) notFound();
  const definitions = await new CustomFieldRepository(getDatabaseClient()).listDefinitions(event.id);
  return (
    <CustomFieldWorkspace
      event={{ name: event.name, slug: event.slug }}
      definitions={definitions.map((definition) => ({
        id: definition.id,
        entityType: definition.entityType,
        key: definition.key,
        label: definition.label,
        description: definition.description,
        type: definition.type,
        required: definition.required,
        characterLimit: definition.characterLimit,
        options:
          Array.isArray(definition.options) && definition.options.every((option) => typeof option === "string")
            ? definition.options
            : [],
      }))}
    />
  );
}
