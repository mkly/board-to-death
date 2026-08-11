import { getDatabaseClient } from "@/server/database/client";

import { getDashboardShellData } from "../../_lib/dashboard-data";
import { ProfileForm } from "./_components/profile-form";

export default async function AccountProfilePage() {
  const shell = await getDashboardShellData();
  const user = await getDatabaseClient().user.findUniqueOrThrow({
    where: { id: shell.user.id },
    select: { name: true, email: true, image: true },
  });

  const [firstName = "", ...remainingNames] = user.name.trim().split(/\s+/);
  const lastName = remainingNames.join(" ");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm">Account</p>
        <h1 className="font-medium text-2xl tracking-tight sm:text-3xl">Profile</h1>
        <p className="max-w-2xl text-muted-foreground">
          How you appear to collaborators across GatherPulse, and the email your magic links go to.
        </p>
      </header>
      <ProfileForm firstName={firstName} lastName={lastName} email={user.email} avatarUrl={user.image} />
    </main>
  );
}
