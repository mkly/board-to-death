import { Command, ShieldCheck } from "lucide-react";

import { TwoFactorChallengeForm } from "../../_components/two-factor-challenge-form";

interface TwoFactorPageProps {
  readonly searchParams: Promise<{ callbackURL?: string | string[] }>;
}

export default async function TwoFactorPage({ searchParams }: TwoFactorPageProps) {
  const query = await searchParams;
  const requestedCallback = typeof query.callbackURL === "string" ? query.callbackURL : "/dashboard";
  const callbackURL =
    requestedCallback.startsWith("/") && !requestedCallback.startsWith("//") ? requestedCallback : "/dashboard";

  return (
    <div className="flex min-h-dvh">
      <div className="hidden bg-primary lg:flex lg:w-1/3 lg:items-center lg:justify-center lg:p-12">
        <div className="flex flex-col items-center gap-6 text-center text-primary-foreground">
          <Command className="size-12" aria-hidden="true" />
          <div className="flex flex-col gap-2">
            <h1 className="font-light text-5xl">One more step</h1>
            <p className="text-xl opacity-80">Protecting your administrator workspace</p>
          </div>
        </div>
      </div>
      <main className="flex w-full items-center justify-center bg-background p-8 lg:w-2/3">
        <div className="flex w-full max-w-md flex-col gap-8 py-20">
          <div className="flex flex-col gap-3 text-center">
            <ShieldCheck className="mx-auto size-10 text-primary" aria-hidden="true" />
            <h2 className="font-medium text-2xl tracking-tight">Two-factor authentication</h2>
            <p className="text-muted-foreground">
              Confirm this sign-in with the authenticator enrolled for your account.
            </p>
          </div>
          <TwoFactorChallengeForm callbackURL={callbackURL} />
        </div>
      </main>
    </div>
  );
}
