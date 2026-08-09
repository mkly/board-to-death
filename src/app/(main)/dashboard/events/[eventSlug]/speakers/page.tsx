import { notFound, redirect } from "next/navigation";

import { dashboardEventHref } from "@/navigation/sidebar/sidebar-items";
import { getDatabaseClient } from "@/server/database/client";
import { parseSpeakerTaskMatrixFilters, SpeakerTaskMatrixRepository } from "@/server/speakers";

import { getDashboardShellData } from "../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../_lib/dashboard-shell";
import { SpeakerTaskMatrix } from "./_components/speaker-task-matrix";

interface SpeakersPageProps {
  readonly params: Promise<{ eventSlug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SpeakersPage({ params, searchParams }: SpeakersPageProps) {
  const [{ eventSlug }, query, shell] = await Promise.all([params, searchParams, getDashboardShellData()]);
  const event = findAuthorizedEvent(shell.events, eventSlug);
  if (!event) notFound();
  if (shell.activeEvent?.id !== event.id) {
    redirect(shell.activeEvent ? dashboardEventHref(shell.activeEvent.slug, "speakers") : "/dashboard");
  }

  const urlSearchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        urlSearchParams.append(key, item);
      });
    } else if (value !== undefined) {
      urlSearchParams.set(key, value);
    }
  }
  const filters = parseSpeakerTaskMatrixFilters(urlSearchParams);
  const result = await new SpeakerTaskMatrixRepository(getDatabaseClient()).list(event.id, event.timezone, filters);

  return <SpeakerTaskMatrix event={event} filters={filters} result={result} />;
}
