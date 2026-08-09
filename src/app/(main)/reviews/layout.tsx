import type { ReactNode } from "react";

import Link from "next/link";

import { ClipboardCheck } from "lucide-react";

import { ThemeSwitcher } from "@/app/(main)/dashboard/_components/header/theme-switcher";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getReviewerSession } from "@/server/evaluations/reviewer-session";

export default async function ReviewsLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { user } = await getReviewerSession();

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Button variant="ghost" asChild>
            <Link href="/reviews">
              <ClipboardCheck data-icon="inline-start" />
              Review workspace
            </Link>
          </Button>
          <div className="flex min-w-0 items-center gap-3">
            <div className="hidden min-w-0 text-right sm:block">
              <p className="truncate font-medium text-sm">{user.name}</p>
              <p className="truncate text-muted-foreground text-xs">{user.email}</p>
            </div>
            <Separator orientation="vertical" className="h-5" />
            <ThemeSwitcher />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
