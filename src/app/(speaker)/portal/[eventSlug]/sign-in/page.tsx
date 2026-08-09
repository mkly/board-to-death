import { KeyRoundIcon } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface SpeakerSignInPageProps {
  readonly params: Promise<{ readonly eventSlug: string }>;
  readonly searchParams: Promise<{ readonly expired?: string; readonly invalid?: string }>;
}

export default async function SpeakerSignInPage({ params, searchParams }: SpeakerSignInPageProps) {
  const [{ eventSlug }, query] = await Promise.all([params, searchParams]);
  let problem = "Open the private sign-in link sent by your event organizer.";
  if (query.expired) problem = "Your speaker session has expired.";
  else if (query.invalid) problem = "That sign-in link is invalid or has already been used.";

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
            <KeyRoundIcon aria-hidden="true" />
          </div>
          <CardTitle>Speaker portal sign-in</CardTitle>
          <CardDescription>{problem}</CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          Request a fresh link from the organizer for <span className="font-medium text-foreground">{eventSlug}</span>.
          Speaker links are single-use and expire for your security.
        </CardContent>
      </Card>
    </main>
  );
}
