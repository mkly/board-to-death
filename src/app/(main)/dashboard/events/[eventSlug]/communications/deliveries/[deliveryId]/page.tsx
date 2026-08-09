import { notFound } from "next/navigation";

import { BulkCommunicationRepository } from "@/server/communications";
import { getDatabaseClient } from "@/server/database/client";

import { getDashboardShellData } from "../../../../../_lib/dashboard-data";
import { findAuthorizedEvent } from "../../../../../_lib/dashboard-shell";
import { DeliveryWorkspace } from "./_components/delivery-workspace";

interface BulkDeliveryPageProps {
  readonly params: Promise<{ eventSlug: string; deliveryId: string }>;
}

export default async function BulkDeliveryPage({ params }: BulkDeliveryPageProps) {
  const [{ eventSlug, deliveryId }, shell] = await Promise.all([params, getDashboardShellData()]);
  const authorizedEvent = findAuthorizedEvent(shell.events, eventSlug);
  if (!authorizedEvent || shell.activeEvent?.id !== authorizedEvent.id) notFound();

  const delivery = await new BulkCommunicationRepository(getDatabaseClient()).get(authorizedEvent.id, deliveryId);
  if (!delivery) notFound();

  return <DeliveryWorkspace event={{ name: authorizedEvent.name, slug: authorizedEvent.slug }} delivery={delivery} />;
}
