"use client";

import { useActionState, useTransition } from "react";

import Link from "next/link";

import { ArrowDown, ArrowUp, Building2, Plus, Save, Trash2 } from "lucide-react";

import {
  type CustomFieldInputDefinition,
  CustomFieldInputs,
  type CustomFieldInputValue,
} from "@/components/custom-fields/custom-field-inputs";
import { FormSelect } from "@/components/form-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ContactGroupKind, ContactGroupTier } from "@/generated/prisma/client";
import { actionResultToast, useActionToast } from "@/hooks/use-action-toast";
import type { ContactGroupWithDetails } from "@/server/contacts/repositories";

import {
  createGroupAction,
  createTierAction,
  type GroupActionState,
  moveTierAction,
  removeTierAction,
  renameTierAction,
  updateGroupAction,
} from "../actions";

interface GroupWorkspaceProps {
  readonly event: {
    readonly name: string;
    readonly slug: string;
    readonly sponsorsEnabled: boolean;
    readonly exhibitorsEnabled: boolean;
  };
  readonly groups: readonly (ContactGroupWithDetails & {
    readonly customFieldValues: readonly CustomFieldInputValue[];
  })[];
  readonly customFieldDefinitions: readonly CustomFieldInputDefinition[];
  readonly tiers: readonly ContactGroupTier[];
  readonly contacts: readonly {
    readonly id: string;
    readonly name: string;
    readonly email: string;
  }[];
  readonly filters: { readonly kind?: ContactGroupKind; readonly tierId?: string; readonly sortBy: "name" | "tier" };
}

const KIND_LABELS: Record<ContactGroupKind, string> = { SPONSOR: "Sponsor", EXHIBITOR: "Exhibitor" };
const INITIAL_STATE: GroupActionState = { status: "idle" };

function kindEnabled(event: GroupWorkspaceProps["event"], kind: ContactGroupKind): boolean {
  return kind === "SPONSOR" ? event.sponsorsEnabled : event.exhibitorsEnabled;
}

function TierSelect({
  tiers,
  kind,
  defaultValue,
  label,
  hideLabel = true,
}: {
  readonly tiers: readonly ContactGroupTier[];
  readonly kind?: ContactGroupKind;
  readonly defaultValue?: string | null;
  readonly label: string;
  readonly hideLabel?: boolean;
}) {
  return (
    <Field>
      <FieldLabel className={hideLabel ? "sr-only" : undefined} htmlFor={label}>
        Tier
      </FieldLabel>
      <FormSelect
        defaultValue={defaultValue ?? "unassigned"}
        id={label}
        name="tierId"
        options={[
          { value: "unassigned", label: "No tier" },
          ...tiers
            .filter((tier) => kind === undefined || tier.kind === kind)
            .map((tier) => ({
              value: tier.id,
              label: kind === undefined ? `${KIND_LABELS[tier.kind]} · ${tier.name}` : tier.name,
            })),
        ]}
      />
    </Field>
  );
}

function ContactSelect({
  contacts,
  defaultValue,
  label,
  hideLabel = true,
}: {
  readonly contacts: GroupWorkspaceProps["contacts"];
  readonly defaultValue?: string | null;
  readonly label: string;
  readonly hideLabel?: boolean;
}) {
  return (
    <Field>
      <FieldLabel className={hideLabel ? "sr-only" : undefined} htmlFor={label}>
        Primary contact
      </FieldLabel>
      <FormSelect
        defaultValue={defaultValue ?? "unassigned"}
        id={label}
        name="primaryContactId"
        options={[
          { value: "unassigned", label: "No primary contact" },
          ...contacts.map((contact) => ({ value: contact.id, label: `${contact.name} · ${contact.email}` })),
        ]}
      />
    </Field>
  );
}

function valueLabel(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string").join(", ");
  if (value && typeof value === "object" && "fileName" in value && typeof value.fileName === "string") {
    return value.fileName;
  }
  return "Not set";
}

function SavedCustomFields({
  definitions,
  values,
  headingId,
}: {
  readonly definitions: readonly CustomFieldInputDefinition[];
  readonly values: readonly CustomFieldInputValue[];
  readonly headingId: string;
}) {
  if (definitions.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="font-medium">
        Saved custom fields
      </h3>
      <dl className="grid gap-3 sm:grid-cols-2">
        {definitions.map((definition) => (
          <div key={definition.id} className="flex flex-col gap-1 rounded-lg border p-3">
            <dt className="text-muted-foreground text-xs">{definition.label}</dt>
            <dd>{valueLabel(values.find(({ definitionId }) => definitionId === definition.id)?.value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function NewTierForm({
  event,
  kind,
}: {
  readonly event: GroupWorkspaceProps["event"];
  readonly kind: ContactGroupKind;
}) {
  const [state, action, pending] = useActionState(createTierAction.bind(null, event.slug), INITIAL_STATE);
  useActionToast(state);
  const enabled = kindEnabled(event, kind);
  return (
    <form noValidate action={action}>
      <input name="kind" type="hidden" value={kind} />
      <FieldGroup className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Field data-disabled={!enabled}>
          <FieldLabel className="sr-only" htmlFor={`new-${kind}-tier`}>
            New {KIND_LABELS[kind].toLowerCase()} tier
          </FieldLabel>
          <Input disabled={!enabled} id={`new-${kind}-tier`} name="name" placeholder="New tier name" required />
        </Field>
        <Button disabled={!enabled || pending} type="submit">
          {pending ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
          Add tier
        </Button>
      </FieldGroup>
    </form>
  );
}

function TierRow({
  event,
  tier,
  index,
  count,
}: {
  readonly event: GroupWorkspaceProps["event"];
  readonly tier: ContactGroupTier;
  readonly index: number;
  readonly count: number;
}) {
  const [state, action, pending] = useActionState(renameTierAction.bind(null, event.slug, tier.id), INITIAL_STATE);
  useActionToast(state);
  const [mutating, startMutation] = useTransition();
  const busy = pending || mutating;
  const move = (direction: "up" | "down") => {
    startMutation(async () => {
      actionResultToast(await moveTierAction(event.slug, tier.id, direction));
    });
  };
  const remove = () => {
    startMutation(async () => {
      actionResultToast(await removeTierAction(event.slug, tier.id));
    });
  };
  return (
    <form noValidate action={action} className="flex flex-wrap gap-2">
      <Field className="min-w-48 flex-1">
        <FieldLabel className="sr-only" htmlFor={`tier-${tier.id}`}>
          Tier name
        </FieldLabel>
        <Input defaultValue={tier.name} id={`tier-${tier.id}`} name="name" required />
      </Field>
      <Button aria-label={`Save ${tier.name}`} disabled={busy} size="icon" type="submit" variant="outline">
        {pending ? <Spinner /> : <Save />}
      </Button>
      <Button
        aria-label={`Move ${tier.name} up`}
        disabled={busy || index === 0}
        onClick={() => move("up")}
        size="icon"
        type="button"
        variant="outline"
      >
        <ArrowUp />
      </Button>
      <Button
        aria-label={`Move ${tier.name} down`}
        disabled={busy || index === count - 1}
        onClick={() => move("down")}
        size="icon"
        type="button"
        variant="outline"
      >
        <ArrowDown />
      </Button>
      <Button
        aria-label={`Remove ${tier.name}`}
        disabled={busy}
        onClick={remove}
        size="icon"
        type="button"
        variant="destructive"
      >
        {mutating ? <Spinner /> : <Trash2 />}
      </Button>
    </form>
  );
}

function TierManager({
  event,
  tiers,
  kind,
}: Pick<GroupWorkspaceProps, "event" | "tiers"> & { kind: ContactGroupKind }) {
  const visible = tiers.filter((tier) => tier.kind === kind);
  const enabled = kindEnabled(event, kind);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{KIND_LABELS[kind]} tiers</CardTitle>
        <CardDescription>
          {enabled
            ? "Names and order are scoped to this event."
            : `Enable ${KIND_LABELS[kind].toLowerCase()}s in event settings first.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <NewTierForm event={event} kind={kind} />
        {visible.length === 0 ? (
          <p className="text-muted-foreground text-sm">No tiers configured.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {visible.map((tier, index) => (
              <TierRow count={visible.length} event={event} index={index} key={tier.id} tier={tier} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NewGroupForm({
  event,
  tiers,
  contacts,
  customFieldDefinitions,
}: Pick<GroupWorkspaceProps, "event" | "tiers" | "contacts" | "customFieldDefinitions">) {
  const [state, action, pending] = useActionState(createGroupAction.bind(null, event.slug), INITIAL_STATE);
  useActionToast(state);
  return (
    <form noValidate action={action}>
      <FieldGroup className="grid gap-3 md:grid-cols-4">
        <Field>
          <FieldLabel htmlFor="new-group-name">Group name</FieldLabel>
          <Input id="new-group-name" name="name" required />
        </Field>
        <Field>
          <FieldLabel htmlFor="new-group-kind">Kind</FieldLabel>
          <FormSelect
            defaultValue="SPONSOR"
            id="new-group-kind"
            name="kind"
            options={[
              { value: "SPONSOR", label: "Sponsor", disabled: !event.sponsorsEnabled },
              { value: "EXHIBITOR", label: "Exhibitor", disabled: !event.exhibitorsEnabled },
            ]}
          />
        </Field>
        <TierSelect defaultValue={null} hideLabel={false} label="new-group-tier" tiers={tiers} />
        <ContactSelect contacts={contacts} defaultValue={null} hideLabel={false} label="new-group-contact" />
        <div className="md:col-span-4">
          <CustomFieldInputs definitions={customFieldDefinitions} idPrefix="new-group-" />
        </div>
        <Button
          className="md:col-start-4"
          disabled={(!event.sponsorsEnabled && !event.exhibitorsEnabled) || pending}
          type="submit"
        >
          {pending ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
          Add group
        </Button>
      </FieldGroup>
    </form>
  );
}

function GroupRow({
  event,
  group,
  tiers,
  contacts,
  customFieldDefinitions,
}: Pick<GroupWorkspaceProps, "event" | "tiers" | "contacts" | "customFieldDefinitions"> & {
  readonly group: GroupWorkspaceProps["groups"][number];
}) {
  const [state, action, pending] = useActionState(updateGroupAction.bind(null, event.slug, group.id), INITIAL_STATE);
  useActionToast(state);
  return (
    <form
      noValidate
      action={action}
      className="grid items-end gap-3 md:grid-cols-[minmax(12rem,1fr)_auto_minmax(10rem,1fr)_minmax(14rem,1fr)_auto]"
    >
      <Field>
        <FieldLabel className="sr-only" htmlFor={`group-name-${group.id}`}>
          Group name
        </FieldLabel>
        <Input defaultValue={group.name} id={`group-name-${group.id}`} name="name" required />
      </Field>
      <Badge variant="secondary">{KIND_LABELS[group.kind]}</Badge>
      <TierSelect defaultValue={group.tierId} kind={group.kind} label={`group-tier-${group.id}`} tiers={tiers} />
      <ContactSelect contacts={contacts} defaultValue={group.primaryContactId} label={`group-contact-${group.id}`} />
      <Button disabled={pending} size="sm" type="submit" variant="outline">
        {pending ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
        Save
      </Button>
      <div className="flex flex-col gap-5 md:col-span-5">
        <CustomFieldInputs
          definitions={customFieldDefinitions}
          fileDownloadBasePath={`/dashboard/events/${encodeURIComponent(event.slug)}/custom-fields/files`}
          idPrefix={`group-${group.id}-`}
          values={group.customFieldValues}
        />
        <SavedCustomFields
          definitions={customFieldDefinitions}
          headingId={`group-${group.id}-saved-custom-fields`}
          values={group.customFieldValues}
        />
      </div>
    </form>
  );
}

export function GroupWorkspace({
  event,
  groups,
  tiers,
  contacts,
  customFieldDefinitions,
  filters,
}: GroupWorkspaceProps) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-muted-foreground text-sm">{event.name}</p>
        <h1 className="font-heading font-semibold text-2xl tracking-tight">Sponsors &amp; exhibitors</h1>
        <p className="text-muted-foreground text-sm">
          Organize partner groups by event tier and choose the contact who receives official communications.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <TierManager event={event} kind="SPONSOR" tiers={tiers} />
        <TierManager event={event} kind="EXHIBITOR" tiers={tiers} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add group</CardTitle>
          <CardDescription>The selected primary contact is automatically added as a member.</CardDescription>
        </CardHeader>
        <CardContent>
          <NewGroupForm
            contacts={contacts}
            customFieldDefinitions={customFieldDefinitions}
            event={event}
            tiers={tiers}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Partner groups</CardTitle>
          <CardDescription>Filter and sort groups by their configured tier.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form noValidate className="flex flex-col gap-3 sm:flex-row sm:items-end" method="get">
            <div className="grid flex-1 gap-3 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="group-kind-filter">Kind</FieldLabel>
                <FormSelect
                  defaultValue={filters.kind ?? "all"}
                  id="group-kind-filter"
                  name="kind"
                  options={[
                    { value: "all", label: "All kinds" },
                    { value: "SPONSOR", label: "Sponsors" },
                    { value: "EXHIBITOR", label: "Exhibitors" },
                  ]}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="group-tier-filter">Tier</FieldLabel>
                <FormSelect
                  defaultValue={filters.tierId ?? "all"}
                  id="group-tier-filter"
                  name="tier"
                  options={[
                    { value: "all", label: "All tiers" },
                    ...tiers.map((tier) => ({ value: tier.id, label: `${KIND_LABELS[tier.kind]} · ${tier.name}` })),
                  ]}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="group-sort">Sort</FieldLabel>
                <FormSelect
                  defaultValue={filters.sortBy}
                  id="group-sort"
                  name="sort"
                  options={[
                    { value: "name", label: "Name" },
                    { value: "tier", label: "Tier order" },
                  ]}
                />
              </Field>
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="outline">
                Apply
              </Button>
              <Button asChild type="button" variant="ghost">
                <Link href={`/dashboard/events/${encodeURIComponent(event.slug)}/groups`}>Clear</Link>
              </Button>
            </div>
          </form>

          {groups.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Building2 />
                </EmptyMedia>
                <EmptyTitle>No partner groups</EmptyTitle>
                <EmptyDescription>Create a sponsor or exhibitor group, or clear the current filters.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Group</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Primary contact</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => (
                  <TableRow key={group.id}>
                    <TableCell colSpan={5}>
                      <GroupRow
                        contacts={contacts}
                        customFieldDefinitions={customFieldDefinitions}
                        event={event}
                        group={group}
                        tiers={tiers}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
