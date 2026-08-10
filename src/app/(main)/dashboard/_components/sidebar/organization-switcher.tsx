"use client";

import { useState } from "react";

import { Building2, LoaderCircle } from "lucide-react";

import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import type { DashboardOrganization } from "../../_lib/dashboard-shell";

interface OrganizationSwitcherProps {
  readonly organizations: readonly DashboardOrganization[];
  readonly activeOrganization: DashboardOrganization | null;
}

export function OrganizationSwitcher({ organizations, activeOrganization }: OrganizationSwitcherProps) {
  const [isSwitching, setIsSwitching] = useState(false);

  if (organizations.length === 0) return null;
  if (organizations.length === 1) {
    return (
      <div className="flex min-w-0 items-center gap-2 px-2 py-1 text-muted-foreground text-xs">
        <Building2 className="size-4 shrink-0" />
        <span className="truncate">{activeOrganization?.name}</span>
      </div>
    );
  }

  return (
    <Select
      value={activeOrganization?.id}
      disabled={isSwitching}
      onValueChange={(organizationId) => {
        setIsSwitching(true);
        window.location.assign(`/dashboard/switch-organization?organizationId=${encodeURIComponent(organizationId)}`);
      }}
    >
      <SelectTrigger className="w-full" aria-label="Active organization">
        {isSwitching ? (
          <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden="true" />
        ) : (
          <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        {/* Radix SelectValue can't resolve item text on the server; render the name directly so it shows on first paint. */}
        <SelectValue placeholder="Choose an organization">
          <span className="truncate">{activeOrganization?.name}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {organizations.map((organization) => (
            <SelectItem key={organization.id} value={organization.id}>
              {organization.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
