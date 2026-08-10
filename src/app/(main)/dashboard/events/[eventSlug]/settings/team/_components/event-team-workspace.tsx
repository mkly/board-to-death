import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EventInvitationStatus, EventMembershipRole, MembershipStatus } from "@/generated/prisma/client";
import type { EventTeamSnapshot } from "@/server/event-memberships";

import { inviteEventMember, resendEventInvitation, revokeEventInvitation, setEventMembershipActive } from "../actions";

interface EventTeamWorkspaceProps {
  readonly event: { readonly name: string; readonly slug: string };
  readonly snapshot: EventTeamSnapshot;
  readonly notice?: string;
  readonly error?: string;
}

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

export function EventTeamWorkspace({ event, snapshot, notice, error }: EventTeamWorkspaceProps) {
  const inviteAction = inviteEventMember.bind(null, event.slug);
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

      {notice ? (
        <Alert>
          <AlertTitle>Event team updated</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Event team not updated</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Invite a collaborator</CardTitle>
          <CardDescription>
            The invitation signs the recipient in with a single-use link and grants access only to this event.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={inviteAction}>
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
                <NativeSelect id="invite-role" name="role" defaultValue={EventMembershipRole.REVIEWER}>
                  <NativeSelectOption value={EventMembershipRole.REVIEWER}>Reviewer</NativeSelectOption>
                  <NativeSelectOption value={EventMembershipRole.ORGANIZER_ADMIN}>Organizer staff</NativeSelectOption>
                </NativeSelect>
              </Field>
              <Button type="submit">Send invitation</Button>
            </FieldGroup>
          </form>
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
                  const action = setEventMembershipActive.bind(null, event.slug, membership.id, !active);
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
                        <form action={action}>
                          <Button type="submit" size="sm" variant="outline">
                            {active ? "Set inactive" : "Restore access"}
                          </Button>
                        </form>
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
                        {pending ? (
                          <div className="flex justify-end gap-2">
                            <form action={resendEventInvitation.bind(null, event.slug, invitation.id)}>
                              <Button type="submit" size="sm" variant="outline">
                                Resend
                              </Button>
                            </form>
                            <form action={revokeEventInvitation.bind(null, event.slug, invitation.id)}>
                              <Button type="submit" size="sm" variant="destructive">
                                Revoke
                              </Button>
                            </form>
                          </div>
                        ) : null}
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
