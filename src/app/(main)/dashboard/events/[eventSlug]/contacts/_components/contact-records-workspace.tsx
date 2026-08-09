"use client";

import { useActionState, useState } from "react";

import { Plus, Save } from "lucide-react";

import {
  type CustomFieldInputDefinition,
  CustomFieldInputs,
  type CustomFieldInputValue,
} from "@/components/custom-fields/custom-field-inputs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { type ContactRecordMutationState, saveContactGroupRecord, saveContactRecord } from "../actions";

interface ContactRecord {
  readonly id: string;
  readonly email: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly organization: string | null;
  readonly jobTitle: string | null;
  readonly phone: string | null;
  readonly customFieldValues: readonly CustomFieldInputValue[];
}

interface ContactGroupRecord {
  readonly id: string;
  readonly kind: "SPONSOR" | "EXHIBITOR";
  readonly name: string;
  readonly slug: string;
  readonly customFieldValues: readonly CustomFieldInputValue[];
}

interface ContactRecordsWorkspaceProps {
  readonly event: { readonly name: string; readonly slug: string };
  readonly contacts: readonly ContactRecord[];
  readonly groups: readonly ContactGroupRecord[];
  readonly contactDefinitions: readonly CustomFieldInputDefinition[];
  readonly groupDefinitions: readonly CustomFieldInputDefinition[];
}

const INITIAL_STATE: ContactRecordMutationState = { status: "idle" };

function fieldError(state: ContactRecordMutationState, field: string): string | undefined {
  return state.errors?.[field]?.[0];
}

function saveLabel(pending: boolean, isNew: boolean, recordType: "contact" | "group"): string {
  if (pending) return "Saving...";
  return isNew ? `Create ${recordType}` : `Save ${recordType}`;
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
}: {
  readonly definitions: readonly CustomFieldInputDefinition[];
  readonly values: readonly CustomFieldInputValue[];
}) {
  if (definitions.length === 0) return null;
  return (
    <section aria-labelledby="saved-custom-fields-heading" className="flex flex-col gap-3">
      <h3 id="saved-custom-fields-heading" className="font-medium">
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

function ContactEditor({
  eventSlug,
  contact,
  definitions,
  onSaved,
}: {
  readonly eventSlug: string;
  readonly contact: ContactRecord | null;
  readonly definitions: readonly CustomFieldInputDefinition[];
  readonly onSaved: (recordId: string) => void;
}) {
  const [state, action, pending] = useActionState(
    async (previousState: ContactRecordMutationState, formData: FormData) => {
      const result = await saveContactRecord(previousState, formData);
      if (result.status === "success" && result.recordId) onSaved(result.recordId);
      return result;
    },
    INITIAL_STATE,
  );
  const isNew = contact === null;

  return (
    <form action={action}>
      <input type="hidden" name="eventSlug" value={eventSlug} />
      <input type="hidden" name="contactId" value={contact?.id ?? ""} />
      <Card>
        <CardHeader>
          <CardTitle>{isNew ? "Create contact" : `${contact.givenName} ${contact.familyName}`}</CardTitle>
          <CardDescription>
            {isNew ? "Add a person to this event." : "Edit contact details and event-specific custom fields."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field data-invalid={Boolean(fieldError(state, "givenName")) || undefined}>
                <FieldLabel htmlFor="contact-given-name">First name</FieldLabel>
                <Input
                  id="contact-given-name"
                  name="givenName"
                  defaultValue={contact?.givenName ?? ""}
                  aria-invalid={Boolean(fieldError(state, "givenName")) || undefined}
                  required
                />
                <FieldError>{fieldError(state, "givenName")}</FieldError>
              </Field>
              <Field data-invalid={Boolean(fieldError(state, "familyName")) || undefined}>
                <FieldLabel htmlFor="contact-family-name">Last name</FieldLabel>
                <Input
                  id="contact-family-name"
                  name="familyName"
                  defaultValue={contact?.familyName ?? ""}
                  aria-invalid={Boolean(fieldError(state, "familyName")) || undefined}
                  required
                />
                <FieldError>{fieldError(state, "familyName")}</FieldError>
              </Field>
            </div>
            <Field data-invalid={Boolean(fieldError(state, "email")) || undefined}>
              <FieldLabel htmlFor="contact-email">Email</FieldLabel>
              <Input
                id="contact-email"
                name="email"
                type="email"
                defaultValue={contact?.email ?? ""}
                aria-invalid={Boolean(fieldError(state, "email")) || undefined}
                required
              />
              <FieldError>{fieldError(state, "email")}</FieldError>
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="contact-organization">Organization</FieldLabel>
                <Input id="contact-organization" name="organization" defaultValue={contact?.organization ?? ""} />
              </Field>
              <Field>
                <FieldLabel htmlFor="contact-job-title">Job title</FieldLabel>
                <Input id="contact-job-title" name="jobTitle" defaultValue={contact?.jobTitle ?? ""} />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="contact-phone">Phone</FieldLabel>
              <Input id="contact-phone" name="phone" type="tel" defaultValue={contact?.phone ?? ""} />
            </Field>
            <CustomFieldInputs definitions={definitions} values={contact?.customFieldValues} />
            {!isNew ? <SavedCustomFields definitions={definitions} values={contact.customFieldValues} /> : null}
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <p aria-live="polite" className="text-muted-foreground text-sm">
            {state.message}
          </p>
          <Button type="submit" disabled={pending}>
            <Save data-icon="inline-start" />
            {saveLabel(pending, isNew, "contact")}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

function GroupEditor({
  eventSlug,
  group,
  definitions,
  onSaved,
}: {
  readonly eventSlug: string;
  readonly group: ContactGroupRecord | null;
  readonly definitions: readonly CustomFieldInputDefinition[];
  readonly onSaved: (recordId: string) => void;
}) {
  const [state, action, pending] = useActionState(
    async (previousState: ContactRecordMutationState, formData: FormData) => {
      const result = await saveContactGroupRecord(previousState, formData);
      if (result.status === "success" && result.recordId) onSaved(result.recordId);
      return result;
    },
    INITIAL_STATE,
  );
  const isNew = group === null;

  return (
    <form action={action}>
      <input type="hidden" name="eventSlug" value={eventSlug} />
      <input type="hidden" name="groupId" value={group?.id ?? ""} />
      <Card>
        <CardHeader>
          <CardTitle>{isNew ? "Create group" : group.name}</CardTitle>
          <CardDescription>
            {isNew ? "Add a sponsor or exhibitor group." : "Edit group details and event-specific custom fields."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field data-invalid={Boolean(fieldError(state, "kind")) || undefined}>
              <FieldLabel htmlFor="group-kind">Group type</FieldLabel>
              {group ? (
                <>
                  <input type="hidden" name="kind" value={group.kind} />
                  <Input id="group-kind" value={group.kind === "SPONSOR" ? "Sponsor" : "Exhibitor"} disabled />
                </>
              ) : (
                <Select name="kind" defaultValue="SPONSOR">
                  <SelectTrigger id="group-kind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="SPONSOR">Sponsor</SelectItem>
                      <SelectItem value="EXHIBITOR">Exhibitor</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
              <FieldError>{fieldError(state, "kind")}</FieldError>
            </Field>
            <Field data-invalid={Boolean(fieldError(state, "name")) || undefined}>
              <FieldLabel htmlFor="group-name">Name</FieldLabel>
              <Input
                id="group-name"
                name="name"
                defaultValue={group?.name ?? ""}
                aria-invalid={Boolean(fieldError(state, "name")) || undefined}
                required
              />
              <FieldError>{fieldError(state, "name")}</FieldError>
            </Field>
            <Field data-invalid={Boolean(fieldError(state, "slug")) || undefined}>
              <FieldLabel htmlFor="group-slug">URL slug</FieldLabel>
              <Input
                id="group-slug"
                name="slug"
                defaultValue={group?.slug ?? ""}
                aria-invalid={Boolean(fieldError(state, "slug")) || undefined}
                placeholder="Generated from the name"
              />
              <FieldError>{fieldError(state, "slug")}</FieldError>
            </Field>
            <CustomFieldInputs definitions={definitions} values={group?.customFieldValues} />
            {!isNew ? <SavedCustomFields definitions={definitions} values={group.customFieldValues} /> : null}
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <p aria-live="polite" className="text-muted-foreground text-sm">
            {state.message}
          </p>
          <Button type="submit" disabled={pending}>
            <Save data-icon="inline-start" />
            {saveLabel(pending, isNew, "group")}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

export function ContactRecordsWorkspace({
  event,
  contacts,
  groups,
  contactDefinitions,
  groupDefinitions,
}: ContactRecordsWorkspaceProps) {
  const [contactId, setContactId] = useState<string | null>(contacts[0]?.id ?? null);
  const [groupId, setGroupId] = useState<string | null>(groups[0]?.id ?? null);
  const contact = contacts.find(({ id }) => id === contactId) ?? null;
  const group = groups.find(({ id }) => id === groupId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading font-semibold text-2xl">Contacts</h1>
        <p className="text-muted-foreground">Manage people and participant groups for {event.name}.</p>
      </header>
      <Tabs defaultValue="contacts">
        <TabsList>
          <TabsTrigger value="contacts">People</TabsTrigger>
          <TabsTrigger value="groups">Groups</TabsTrigger>
        </TabsList>
        <TabsContent value="contacts">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
            <Card>
              <CardHeader>
                <CardTitle>People</CardTitle>
                <CardDescription>{contacts.length} active contacts</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Organization</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contacts.map((entry) => (
                      <TableRow key={entry.id} data-state={entry.id === contactId ? "selected" : undefined}>
                        <TableCell>
                          <Button variant="link" className="h-auto px-0" onClick={() => setContactId(entry.id)}>
                            {entry.givenName} {entry.familyName}
                          </Button>
                          <span className="block text-muted-foreground text-xs">{entry.email}</span>
                        </TableCell>
                        <TableCell>{entry.organization ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
              <CardFooter className="justify-end">
                <Button variant="outline" onClick={() => setContactId(null)}>
                  <Plus data-icon="inline-start" />
                  New contact
                </Button>
              </CardFooter>
            </Card>
            <ContactEditor
              key={contact?.id ?? "new-contact"}
              eventSlug={event.slug}
              contact={contact}
              definitions={contactDefinitions}
              onSaved={setContactId}
            />
          </div>
        </TabsContent>
        <TabsContent value="groups">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
            <Card>
              <CardHeader>
                <CardTitle>Groups</CardTitle>
                <CardDescription>{groups.length} active groups</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.map((entry) => (
                      <TableRow key={entry.id} data-state={entry.id === groupId ? "selected" : undefined}>
                        <TableCell>
                          <Button variant="link" className="h-auto px-0" onClick={() => setGroupId(entry.id)}>
                            {entry.name}
                          </Button>
                          <span className="block text-muted-foreground text-xs">/{entry.slug}</span>
                        </TableCell>
                        <TableCell>{entry.kind === "SPONSOR" ? "Sponsor" : "Exhibitor"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
              <CardFooter className="justify-end">
                <Button variant="outline" onClick={() => setGroupId(null)}>
                  <Plus data-icon="inline-start" />
                  New group
                </Button>
              </CardFooter>
            </Card>
            <GroupEditor
              key={group?.id ?? "new-group"}
              eventSlug={event.slug}
              group={group}
              definitions={groupDefinitions}
              onSaved={setGroupId}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
