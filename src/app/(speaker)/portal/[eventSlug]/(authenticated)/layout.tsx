import type { ReactNode } from "react";

import Link from "next/link";

import { BookOpenIcon, ClipboardCheckIcon, FileTextIcon, HomeIcon, LogOutIcon, UserRoundIcon } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getDatabaseClient } from "@/server/database/client";

import { getPortalViewer, portalHref } from "../_lib/portal-session";

interface SpeakerPortalLayoutProps {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly eventSlug: string }>;
}

function initials(givenName: string, familyName: string): string {
  return `${givenName[0] ?? ""}${familyName[0] ?? ""}`.toUpperCase();
}

export default async function SpeakerPortalLayout({ children, params }: SpeakerPortalLayoutProps) {
  const { eventSlug } = await params;
  const viewer = await getPortalViewer(eventSlug);
  const speaker = await getDatabaseClient().speaker.findFirst({
    where: { eventId: viewer.eventId, id: viewer.speakerId },
    select: {
      event: { select: { name: true } },
      profileVersions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { givenName: true, familyName: true, preferredName: true, email: true },
      },
    },
  });
  const profile = speaker?.profileVersions[0];
  if (!speaker || !profile) return null;
  const home = portalHref(eventSlug);

  const navigation = [
    { href: home, label: "Home", icon: HomeIcon },
    { href: portalHref(eventSlug, "/submissions"), label: "Submissions", icon: FileTextIcon },
    { href: portalHref(eventSlug, "/profile"), label: "Profile", icon: UserRoundIcon },
    { href: `${home}#tasks`, label: "Tasks", icon: ClipboardCheckIcon },
    { href: portalHref(eventSlug, "/resources"), label: "Resources", icon: BookOpenIcon },
  ] as const;

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <Link href={home} className="font-heading font-semibold text-base">
              {speaker.event.name}
            </Link>
            <p className="text-muted-foreground text-xs">Speaker portal</p>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <Avatar size="lg">
              <AvatarFallback>{initials(profile.givenName, profile.familyName)}</AvatarFallback>
            </Avatar>
            <div className="hidden min-w-0 sm:block">
              <p className="truncate font-medium text-sm">{profile.preferredName ?? profile.givenName}</p>
              <p className="truncate text-muted-foreground text-xs">{profile.email}</p>
            </div>
            <form action={portalHref(eventSlug, "/logout")} method="post">
              <Button type="submit" variant="ghost" size="sm">
                <LogOutIcon data-icon="inline-start" aria-hidden="true" />
                <span className="hidden sm:inline">Sign out</span>
                <span className="sm:hidden">Exit</span>
              </Button>
            </form>
          </div>
        </div>
        <Separator />
        <nav aria-label="Speaker portal" className="mx-auto grid max-w-6xl grid-cols-2 gap-2 px-4 py-3 sm:flex sm:px-6">
          {navigation.map(({ href, icon: Icon, label }) => (
            <Button key={label} asChild variant="outline" size="sm" className="justify-start sm:justify-center">
              <Link href={href}>
                <Icon data-icon="inline-start" aria-hidden="true" />
                {label}
              </Link>
            </Button>
          ))}
        </nav>
      </header>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
