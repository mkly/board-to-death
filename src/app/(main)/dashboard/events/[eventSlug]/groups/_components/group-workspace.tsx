import Link from "next/link";

import { ArrowDown, ArrowUp, Building2, Plus, Save, Trash2 } from "lucide-react";

import {
  type CustomFieldInputDefinition,
  CustomFieldInputs,
  type CustomFieldInputValue,
} from "@/components/custom-fields/custom-field-inputs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ContactGroupKind, ContactGroupTier } from "@/generated/prisma/client";
import type { ContactGroupWithDetails } from "@/server/contacts/repositories";

import {
  createGroupAction,
  createTierAction,
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
  readonly notice?: string;
  readonly error?: string;
}

const KIND_LABELS: Record<ContactGroupKind, string> = { SPONSOR: "Sponsor", EXHIBITOR: "Exhibitor" };

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
      <NativeSelect className="w-full" defaultValue={defaultValue ?? "unassigned"} id={label} name="tierId">
        <NativeSelectOption value="unassigned">No tier</NativeSelectOption>
        {tiers
          .filter((tier) => kind === undefined || tier.kind === kind)
          .map((tier) => (
            <NativeSelectOption key={tier.id} value={tier.id}>
              {kind === undefined ? `${KIND_LABELS[tier.kind]} · ${tier.name}` : tier.name}
            </NativeSelectOption>
          ))}
      </NativeSelect>
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
      <NativeSelect className="w-full" defaultValue={defaultValue ?? "unassigned"} id={label} name="primaryContactId">
        <NativeSelectOption value="unassigned">No primary contact</NativeSelectOption>
        {contacts.map((contact) => (
          <NativeSelectOption key={contact.id} value={contact.id}>
            {contact.name} · {contact.email}
          </NativeSelectOption>
        ))}
      </NativeSelect>
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
        <form action={createTierAction.bind(null, event.slug)}>
          <input name="kind" type="hidden" value={kind} />
          <FieldGroup className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <Field data-disabled={!enabled}>
              <FieldLabel className="sr-only" htmlFor={`new-${kind}-tier`}>
                New {KIND_LABELS[kind].toLowerCase()} tier
              </FieldLabel>
              <Input disabled={!enabled} id={`new-${kind}-tier`} name="name" placeholder="New tier name" required />
            </Field>
            <Button disabled={!enabled} type="submit">
              <Plus data-icon="inline-start" />
              Add tier
            </Button>
          </FieldGroup>
        </form>
        {visible.length === 0 ? (
          <p className="text-muted-foreground text-sm">No tiers configured.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {visible.map((tier, index) => (
              <form
                action={renameTierAction.bind(null, event.slug, tier.id)}
                className="flex flex-wrap gap-2"
                key={tier.id}
              >
                <Field className="min-w-48 flex-1">
                  <FieldLabel className="sr-only" htmlFor={`tier-${tier.id}`}>
                    Tier name
                  </FieldLabel>
                  <Input defaultValue={tier.name} id={`tier-${tier.id}`} name="name" required />
                </Field>
                <Button aria-label={`Save ${tier.name}`} size="icon" type="submit" variant="outline">
                  <Save />
                </Button>
                <Button
                  aria-label={`Move ${tier.name} up`}
                  disabled={index === 0}
                  formAction={moveTierAction.bind(null, event.slug, tier.id, "up")}
                  size="icon"
                  type="submit"
                  variant="outline"
                >
                  <ArrowUp />
                </Button>
                <Button
                  aria-label={`Move ${tier.name} down`}
                  disabled={index === visible.length - 1}
                  formAction={moveTierAction.bind(null, event.slug, tier.id, "down")}
                  size="icon"
                  type="submit"
                  variant="outline"
                >
                  <ArrowDown />
                </Button>
                <Button
                  aria-label={`Remove ${tier.name}`}
                  formAction={removeTierAction.bind(null, event.slug, tier.id)}
                  size="icon"
                  type="submit"
                  variant="destructive"
                >
                  <Trash2 />
                </Button>
              </form>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function GroupWorkspace({
  event,
  groups,
  tiers,
  contacts,
  customFieldDefinitions,
  filters,
  notice,
  error,
}: GroupWorkspaceProps) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-muted-foreground text-sm">{event.name}</p>
        <h1 className="flex items-center gap-2 font-heading font-semibold text-2xl tracking-tight">
          <Building2 aria-hidden="true" className="size-6 text-muted-foreground" />
          Sponsors and exhibitors
        </h1>
        <p className="text-muted-foreground text-sm">
          Organize partner groups by event tier and choose the contact who receives official communications.
        </p>
      </header>

      {notice ? (
        <Alert>
          <AlertTitle>Groups updated</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to update groups</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

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
          <form action={createGroupAction.bind(null, event.slug)}>
            <FieldGroup className="grid gap-3 md:grid-cols-4">
              <Field>
                <FieldLabel htmlFor="new-group-name">Group name</FieldLabel>
                <Input id="new-group-name" name="name" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="new-group-kind">Kind</FieldLabel>
                <NativeSelect className="w-full" defaultValue="SPONSOR" id="new-group-kind" name="kind">
                  <NativeSelectOption disabled={!event.sponsorsEnabled} value="SPONSOR">
                    Sponsor
                  </NativeSelectOption>
                  <NativeSelectOption disabled={!event.exhibitorsEnabled} value="EXHIBITOR">
                    Exhibitor
                  </NativeSelectOption>
                </NativeSelect>
              </Field>
              <TierSelect defaultValue={null} hideLabel={false} label="new-group-tier" tiers={tiers} />
              <ContactSelect contacts={contacts} defaultValue={null} hideLabel={false} label="new-group-contact" />
              <div className="md:col-span-4">
                <CustomFieldInputs definitions={customFieldDefinitions} idPrefix="new-group-" />
              </div>
              <Button
                className="md:col-start-4"
                disabled={!event.sponsorsEnabled && !event.exhibitorsEnabled}
                type="submit"
              >
                <Plus data-icon="inline-start" />
                Add group
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Partner groups</CardTitle>
          <CardDescription>Filter and sort groups by their configured tier.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form className="flex flex-wrap items-end gap-3" method="get">
            <Field>
              <FieldLabel htmlFor="group-kind-filter">Kind</FieldLabel>
              <NativeSelect defaultValue={filters.kind ?? "all"} id="group-kind-filter" name="kind">
                <NativeSelectOption value="all">All kinds</NativeSelectOption>
                <NativeSelectOption value="SPONSOR">Sponsors</NativeSelectOption>
                <NativeSelectOption value="EXHIBITOR">Exhibitors</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="group-tier-filter">Tier</FieldLabel>
              <NativeSelect defaultValue={filters.tierId ?? "all"} id="group-tier-filter" name="tier">
                <NativeSelectOption value="all">All tiers</NativeSelectOption>
                {tiers.map((tier) => (
                  <NativeSelectOption key={tier.id} value={tier.id}>
                    {KIND_LABELS[tier.kind]} · {tier.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="group-sort">Sort</FieldLabel>
              <NativeSelect defaultValue={filters.sortBy} id="group-sort" name="sort">
                <NativeSelectOption value="name">Name</NativeSelectOption>
                <NativeSelectOption value="tier">Tier order</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Button type="submit" variant="outline">
              Apply
            </Button>
            <Button asChild type="button" variant="ghost">
              <Link href={`/dashboard/events/${encodeURIComponent(event.slug)}/groups`}>Clear</Link>
            </Button>
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
                      <form
                        action={updateGroupAction.bind(null, event.slug, group.id)}
                        className="grid items-end gap-3 md:grid-cols-[minmax(12rem,1fr)_auto_minmax(10rem,1fr)_minmax(14rem,1fr)_auto]"
                      >
                        <Field>
                          <FieldLabel className="sr-only" htmlFor={`group-name-${group.id}`}>
                            Group name
                          </FieldLabel>
                          <Input defaultValue={group.name} id={`group-name-${group.id}`} name="name" required />
                        </Field>
                        <Badge variant="secondary">{KIND_LABELS[group.kind]}</Badge>
                        <TierSelect
                          defaultValue={group.tierId}
                          kind={group.kind}
                          label={`group-tier-${group.id}`}
                          tiers={tiers}
                        />
                        <ContactSelect
                          contacts={contacts}
                          defaultValue={group.primaryContactId}
                          label={`group-contact-${group.id}`}
                        />
                        <Button size="sm" type="submit" variant="outline">
                          <Save data-icon="inline-start" />
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
