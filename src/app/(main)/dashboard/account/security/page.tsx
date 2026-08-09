import { getDashboardShellData } from "@/app/(main)/dashboard/_lib/dashboard-data";
import { getDatabaseClient } from "@/server/database/client";

import { TwoFactorSettings } from "./_components/two-factor-settings";

export default async function AccountSecurityPage() {
  const shell = await getDashboardShellData();
  const user = await getDatabaseClient().user.findUniqueOrThrow({
    where: { id: shell.user.id },
    select: { twoFactorEnabled: true },
  });

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm">Account</p>
        <h1 className="font-medium text-2xl tracking-tight sm:text-3xl">Security</h1>
        <p className="max-w-2xl text-muted-foreground">
          Manage the extra verification required when signing in to the administrator workspace.
        </p>
      </header>
      <TwoFactorSettings initiallyEnabled={user.twoFactorEnabled} />
    </main>
  );
}
