import { resolveMembershipPrincipal } from "@/server/authorization/membership-principal";
import { authorizeEventResource, organizerEventIds } from "@/server/authorization/policy";
import { getDatabaseClient } from "@/server/database/client";

interface AdminSession {
  readonly user: {
    readonly id: string;
  };
}

export type EventReference = { readonly id: string } | { readonly slug: string };

export async function isAuthorizedAdminSession(
  session: AdminSession | null | undefined,
  eventReference?: EventReference,
): Promise<boolean> {
  if (!session) return false;

  const database = getDatabaseClient();
  const { principal } = await resolveMembershipPrincipal(database, session.user.id);
  if (!eventReference) return organizerEventIds(principal).length > 0;

  const event = await database.event.findFirst({
    where: "id" in eventReference ? { id: eventReference.id } : { slug: eventReference.slug },
    select: { id: true },
  });
  if (!event) return false;

  try {
    authorizeEventResource(principal, { eventId: event.id, kind: "event-program", action: "write" });
    return true;
  } catch {
    return false;
  }
}
