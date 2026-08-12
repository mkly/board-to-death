import { headers } from "next/headers";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { EventMembershipRole } from "@/generated/prisma/client";
import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";
import { EventInvitationService } from "@/server/event-memberships";

import { AcceptInvitationForm } from "./_components/accept-invitation-form";

interface InvitationPageProps {
  readonly params: Promise<{ token: string }>;
}

export default async function InvitationPage({ params }: InvitationPageProps) {
  const [{ token }, session] = await Promise.all([params, auth.api.getSession({ headers: await headers() })]);
  const invitation = await new EventInvitationService(getDatabaseClient()).preview(token);

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Event invitation</CardTitle>
          <CardDescription>
            {invitation
              ? `Join ${invitation.eventName} as ${
                  invitation.role === EventMembershipRole.REVIEWER ? "a reviewer" : "organizer staff"
                }.`
              : "This invitation is no longer available."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {invitation && session ? (
            <p className="text-muted-foreground text-sm">
              Signed in as {session.user.email}. This grants access only to the invited event.
            </p>
          ) : null}
          {invitation && !session ? (
            <Alert>
              <AlertTitle>Open the emailed sign-in link</AlertTitle>
              <AlertDescription>The invitation must be accepted from its single-use magic link.</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        {invitation && session ? (
          <CardFooter>
            <AcceptInvitationForm token={token} />
          </CardFooter>
        ) : null}
      </Card>
    </main>
  );
}
