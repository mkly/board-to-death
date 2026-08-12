import type { ReactNode } from "react";

import Image from "next/image";
import Link from "next/link";

import { BookOpenIcon, ClipboardCheckIcon, FileTextIcon, HomeIcon, LogOutIcon, UserRoundIcon } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { getDatabaseClient } from "@/server/database/client";

import { getPortalConfiguration, getPortalViewer, portalHref } from "../_lib/portal-session";

interface SpeakerPortalLayoutProps {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly eventSlug: string }>;
}

function initials(givenName: string, familyName: string): string {
  return `${givenName[0] ?? ""}${familyName[0] ?? ""}`.toUpperCase();
}

const accentBorders = {
  neutral: "border-l-neutral-500",
  rose: "border-l-rose-500",
  orange: "border-l-orange-500",
  amber: "border-l-amber-500",
  emerald: "border-l-emerald-500",
  sky: "border-l-sky-500",
  indigo: "border-l-indigo-500",
  violet: "border-l-violet-500",
} as const;

function getPortalImageUrl(
  objectKey: string | null | undefined,
  fallbackPath: string,
  eventSlug: string,
): string | null {
  if (!objectKey) return null;
  if (objectKey.startsWith("/")) return objectKey;
  return portalHref(eventSlug, fallbackPath);
}

export default async function SpeakerPortalLayout({ children, params }: SpeakerPortalLayoutProps) {
  const { eventSlug } = await params;
  const [viewer, portal] = await Promise.all([getPortalViewer(eventSlug), getPortalConfiguration(eventSlug)]);
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
  const logoUrl = getPortalImageUrl(portal.logoObjectKey, "/branding/logo", eventSlug);
  const backgroundUrl = getPortalImageUrl(portal.backgroundObjectKey, "/branding/background", eventSlug);

  const navigation = [
    { href: home, label: "Home", icon: HomeIcon },
    portal.contentVisibility.submissions
      ? { href: portalHref(eventSlug, "/submissions"), label: portal.sectionTitles.submissions, icon: FileTextIcon }
      : null,
    portal.contentVisibility.profile
      ? { href: portalHref(eventSlug, "/profile"), label: portal.sectionTitles.profile, icon: UserRoundIcon }
      : null,
    portal.contentVisibility.tasks
      ? { href: `${home}#tasks`, label: portal.sectionTitles.tasks, icon: ClipboardCheckIcon }
      : null,
    portal.contentVisibility.resources
      ? { href: portalHref(eventSlug, "/resources"), label: portal.sectionTitles.resources, icon: BookOpenIcon }
      : null,
  ].filter((item) => item !== null);

  return (
    <div className="min-h-screen bg-muted/30">
      <header
        className={cn("relative overflow-hidden border-b border-l-4 bg-background", accentBorders[portal.accentColor])}
      >
        {backgroundUrl ? (
          <Image src={backgroundUrl} alt="" fill unoptimized className="object-cover opacity-10" />
        ) : null}
        <div className="relative mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <Link href={home} className="font-heading font-semibold text-base">
              {logoUrl ? (
                <Image
                  src={logoUrl}
                  alt=""
                  width={28}
                  height={28}
                  unoptimized
                  className="mr-2 inline-block size-7 object-contain"
                />
              ) : null}
              {speaker.event.name}
            </Link>
            <p className="text-muted-foreground text-xs">{portal.name}</p>
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
        <Separator className="relative" />
        <nav
          aria-label="Speaker portal"
          className="relative mx-auto grid max-w-6xl grid-cols-2 gap-2 px-4 py-3 sm:flex sm:px-6"
        >
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
