import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { OrganizationMemberRole } from "@/generated/prisma/client";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import { OrganizationInvitationService } from "@/server/organization-memberships/organization-invitations";

import { acceptOrganizationInvitation } from "./actions";

interface OrganizationInvitationPageProps {
  readonly params: Promise<{ token: string }>;
  readonly searchParams: Promise<{ error?: string }>;
}

const terminalMessages = {
  accepted: {
    title: "Invitation already accepted",
    description: "This invitation has already been used. Sign in to open your organization dashboard.",
  },
  expired: {
    title: "Invitation expired",
    description: "This invitation has expired. Ask the organization owner to send a new one.",
  },
  revoked: {
    title: "Invitation revoked",
    description: "This invitation was revoked by the organization. Ask an owner if you still need access.",
  },
  unknown: {
    title: "Invitation not found",
    description: "This invitation link is not valid. Check the link or ask the organization owner for a new one.",
  },
} as const;

export default async function OrganizationInvitationPage({ params, searchParams }: OrganizationInvitationPageProps) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const invitation = await new OrganizationInvitationService(getDatabaseClient()).preview(token);

  if (invitation.state !== "pending") {
    const message = terminalMessages[invitation.state];
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>{message.title}</CardTitle>
            <CardDescription>{message.description}</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    const callbackURL = `/organization-invitations/${encodeURIComponent(token)}`;
    redirect(`/auth/v1/login?callbackURL=${encodeURIComponent(callbackURL)}`);
  }

  const acceptAction = acceptOrganizationInvitation.bind(null, token);
  const role = invitation.role === OrganizationMemberRole.OWNER ? "an owner" : "a member";

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Organization invitation</CardTitle>
          <CardDescription>
            Join {invitation.organizationName} as {role}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {query.error ? (
            <Alert variant="destructive">
              <AlertTitle>Invitation not accepted</AlertTitle>
              <AlertDescription>{query.error}</AlertDescription>
            </Alert>
          ) : null}
          <p className="text-muted-foreground text-sm">
            Signed in as {session.user.email}. The invitation was sent to {invitation.email}.
          </p>
        </CardContent>
        <CardFooter>
          <form action={acceptAction}>
            <Button type="submit">Accept invitation</Button>
          </form>
        </CardFooter>
      </Card>
    </main>
  );
}
