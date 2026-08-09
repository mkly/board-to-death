import { notFound } from "next/navigation";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getContactGroupIntakeFormByPublicId } from "@/server/contacts/group-intake";
import { getDatabaseClient } from "@/server/database/client";

import { PublicPartnerIntakeForm } from "./_components/public-partner-intake-form";

export const dynamic = "force-dynamic";

export default async function PartnerIntakePage({
  params,
}: {
  readonly params: Promise<{ readonly publicId: string }>;
}) {
  const { publicId } = await params;
  const form = await getContactGroupIntakeFormByPublicId(getDatabaseClient(), publicId);
  if (!form) notFound();

  if (form.status !== "PUBLISHED") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>
              <h1>Partner intake closed</h1>
            </CardTitle>
            <CardDescription>{form.event.name} is not currently accepting responses through this form.</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen justify-center bg-muted/30 p-4 sm:p-8">
      <div className="flex w-full max-w-2xl flex-col gap-4">
        <header className="flex flex-col gap-2">
          <p className="font-medium text-muted-foreground text-sm">{form.event.name}</p>
          <h1 className="font-medium text-3xl leading-tight tracking-tight">{form.title}</h1>
          {form.description ? <p className="text-muted-foreground">{form.description}</p> : null}
          <p className="text-muted-foreground text-sm">
            This {form.kind === "SPONSOR" ? "sponsor" : "exhibitor"} interest form is reviewed by the event team.
          </p>
        </header>
        <PublicPartnerIntakeForm publicId={publicId} />
      </div>
    </main>
  );
}
