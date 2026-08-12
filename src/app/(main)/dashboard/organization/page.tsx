import { notFound } from "next/navigation";

import { getDashboardShellData } from "@/app/(main)/dashboard/_lib/dashboard-data";
import { MembershipStatus, OrganizationMemberRole } from "@/generated/prisma/enums";
import { getDatabaseClient } from "@/server/database/client";
import { OrganizationInvitationService } from "@/server/organization-memberships/organization-invitations";

import { OrganizationTeamWorkspace } from "./_components/organization-team-workspace";

export default async function OrganizationPage() {
  const shell = await getDashboardShellData();
  if (!shell.activeOrganization) notFound();

  const client = getDatabaseClient();
  const [membership, snapshot] = await Promise.all([
    client.organizationMember.findUnique({
      where: {
        orgId_userId: { orgId: shell.activeOrganization.id, userId: shell.user.id },
      },
      select: { role: true, status: true },
    }),
    new OrganizationInvitationService(client).list(shell.activeOrganization.id),
  ]);
  if (!membership || membership.status !== MembershipStatus.ACTIVE) notFound();

  return (
    <OrganizationTeamWorkspace
      organization={shell.activeOrganization}
      currentUserId={shell.user.id}
      canManage={membership.role === OrganizationMemberRole.OWNER}
      snapshot={snapshot}
    />
  );
}
