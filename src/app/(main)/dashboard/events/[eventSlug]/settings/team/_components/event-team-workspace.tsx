"use client";

import { useActionState, useTransition } from "react";

import { MailPlus } from "lucide-react";

import { FormSelect } from "@/components/form-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EventInvitationStatus, EventMembershipRole, MembershipStatus } from "@/generated/prisma/enums";
import { actionResultToast, useActionToast } from "@/hooks/use-action-toast";
import type { EventTeamSnapshot } from "@/server/event-memberships";

import {
  type EventTeamActionState,
  inviteEventMember,
  resendEventInvitation,
  revokeEventInvitation,
  setEventMembershipActive,
} from "../actions";

interface EventTeamWorkspaceProps {
  readonly event: { readonly name: string; readonly slug: string };
  readonly snapshot: EventTeamSnapshot;
}

const INITIAL_STATE: EventTeamActionState = { status: "idle" };

const roleLabels: Record<EventMembershipRole, string> = {
  [EventMembershipRole.ORGANIZER_ADMIN]: "Organizer staff",
  [EventMembershipRole.REVIEWER]: "Reviewer",
  [EventMembershipRole.APPLICANT]: "Applicant",
  [EventMembershipRole.SPEAKER]: "Speaker",
};

function roleLabel(role: EventMembershipRole): string {
  return roleLabels[role];
}

function rolesLabel(roles: readonly EventMembershipRole[]): string {
  return roles.map(roleLabel).join(", ");
}

function InviteCollaboratorForm({ eventSlug }: { readonly eventSlug: string }) {
  const [state, action, pending] = useActionState(inviteEventMember.bind(null, eventSlug), INITIAL_STATE);
  useActionToast(state);
  return (
    <form noValidate action={action}>
      <FieldGroup className="md:grid md:grid-cols-[1fr_1fr_12rem_auto] md:items-end">
        <Field>
          <FieldLabel htmlFor="invite-email">Email</FieldLabel>
          <Input id="invite-email" name="email" type="email" required autoComplete="email" />
        </Field>
        <Field>
          <FieldLabel htmlFor="invite-name">Display name</FieldLabel>
          <Input id="invite-name" name="displayName" autoComplete="name" />
        </Field>
        <Field>
          <FieldLabel htmlFor="invite-role">Role</FieldLabel>
          <FormSelect
            defaultValue={EventMembershipRole.REVIEWER}
            id="invite-role"
            name="role"
            options={[
              { value: EventMembershipRole.REVIEWER, label: "Reviewer" },
              { value: EventMembershipRole.ORGANIZER_ADMIN, label: "Organizer staff" },
            ]}
          />
        </Field>
        <Button disabled={pending} type="submit">
          {pending ? <Spinner data-icon="inline-start" /> : <MailPlus data-icon="inline-start" />}
          Send invitation
        </Button>
      </FieldGroup>
    </form>
  );
}

function MembershipToggleButton({
  eventSlug,
  membershipId,
  active,
}: {
  readonly eventSlug: string;
  readonly membershipId: string;
  readonly active: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const toggle = () => {
    startTransition(async () => {
      actionResultToast(await setEventMembershipActive(eventSlug, membershipId, !active));
    });
  };
  return (
    <Button disabled={pending} onClick={toggle} type="button" size="sm" variant="outline">
      {pending ? <Spinner data-icon="inline-start" /> : null}
      {active ? "Set inactive" : "Restore access"}
    </Button>
  );
}

function InvitationActions({ eventSlug, invitationId }: { readonly eventSlug: string; readonly invitationId: string }) {
  const [pending, startTransition] = useTransition();
  const resend = () => {
    startTransition(async () => {
      actionResultToast(await resendEventInvitation(eventSlug, invitationId));
    });
  };
  const revoke = () => {
    startTransition(async () => {
      actionResultToast(await revokeEventInvitation(eventSlug, invitationId));
    });
  };
  return (
    <div className="flex justify-end gap-2">
      <Button disabled={pending} onClick={resend} type="button" size="sm" variant="outline">
        {pending ? <Spinner data-icon="inline-start" /> : null}
        Resend
      </Button>
      <Button disabled={pending} onClick={revoke} type="button" size="sm" variant="destructive">
        Revoke
      </Button>
    </div>
  );
}

export function EventTeamWorkspace({ event, snapshot }: EventTeamWorkspaceProps) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm">{event.name}</p>
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">Team & reviewers</h1>
          <p className="text-muted-foreground text-sm">
            Invite event-only collaborators without adding them to the organization.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Invite a collaborator</CardTitle>
          <CardDescription>
            The invitation signs the recipient in with a single-use link and grants access only to this event.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InviteCollaboratorForm eventSlug={event.slug} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Event memberships</CardTitle>
          <CardDescription>Inactive memberships lose access on their next request.</CardDescription>
        </CardHeader>
        <CardContent>
          {snapshot.memberships.length === 0 ? (
            <p className="text-muted-foreground text-sm">No event-specific memberships yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.memberships.map((membership) => {
                  const active = membership.status === MembershipStatus.ACTIVE;
                  return (
                    <TableRow key={membership.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{membership.displayName}</span>
                          <span className="text-muted-foreground text-xs">{membership.email}</span>
                        </div>
                      </TableCell>
                      <TableCell>{rolesLabel(membership.roles)}</TableCell>
                      <TableCell>
                        <Badge variant={active ? "secondary" : "outline"}>{active ? "Active" : "Inactive"}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <MembershipToggleButton active={active} eventSlug={event.slug} membershipId={membership.id} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invitations</CardTitle>
          <CardDescription>Pending links can be resent or revoked before they are accepted.</CardDescription>
        </CardHeader>
        <CardContent>
          {snapshot.invitations.length === 0 ? (
            <p className="text-muted-foreground text-sm">No invitations have been sent.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.invitations.map((invitation) => {
                  const pending = invitation.status === EventInvitationStatus.PENDING;
                  return (
                    <TableRow key={invitation.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{invitation.displayName ?? invitation.email}</span>
                          {invitation.displayName ? (
                            <span className="text-muted-foreground text-xs">{invitation.email}</span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>{roleLabel(invitation.role)}</TableCell>
                      <TableCell>
                        <Badge variant={pending ? "secondary" : "outline"}>{invitation.status.toLowerCase()}</Badge>
                      </TableCell>
                      <TableCell>
                        {pending ? <InvitationActions eventSlug={event.slug} invitationId={invitation.id} /> : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
