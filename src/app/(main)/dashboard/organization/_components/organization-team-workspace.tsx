import { MailPlus, ShieldCheck, UsersRound } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MembershipStatus, OrganizationInvitationStatus, OrganizationMemberRole } from "@/generated/prisma/client";
import type { OrganizationTeamSnapshot } from "@/server/organization-memberships/organization-invitations";

import {
  inviteOrganizationMember,
  resendOrganizationInvitation,
  revokeOrganizationInvitation,
  setOrganizationMembershipActive,
} from "../actions";

interface OrganizationTeamWorkspaceProps {
  readonly organization: { readonly id: string; readonly name: string };
  readonly currentUserId: string;
  readonly canManage: boolean;
  readonly snapshot: OrganizationTeamSnapshot;
  readonly notice?: string;
  readonly error?: string;
}

const roleLabels: Record<OrganizationMemberRole, string> = {
  [OrganizationMemberRole.OWNER]: "Owner",
  [OrganizationMemberRole.MEMBER]: "Member",
};

function roleLabel(role: OrganizationMemberRole): string {
  return roleLabels[role];
}

function invitationStatus(status: OrganizationInvitationStatus, expiresAt: Date): string {
  if (status === OrganizationInvitationStatus.PENDING && expiresAt <= new Date()) return "Expired";
  return status.toLowerCase();
}

interface MembershipActionProps {
  readonly active: boolean;
  readonly action: () => Promise<never>;
  readonly displayName: string;
  readonly isCurrentUser: boolean;
}

function MembershipAction({ active, action, displayName, isCurrentUser }: MembershipActionProps) {
  if (isCurrentUser && active) {
    return <span className="text-muted-foreground text-xs">Current account</span>;
  }
  if (!active) {
    return (
      <form action={action}>
        <Button type="submit" size="sm" variant="outline">
          Restore access
        </Button>
      </form>
    );
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          Set inactive
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove organization access?</AlertDialogTitle>
          <AlertDialogDescription>
            {displayName} will lose access to this organization and all of its events.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <form action={action}>
            <AlertDialogAction type="submit" variant="destructive">
              Set inactive
            </AlertDialogAction>
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function OrganizationTeamWorkspace({
  organization,
  currentUserId,
  canManage,
  snapshot,
  notice,
  error,
}: OrganizationTeamWorkspaceProps) {
  const inviteAction = inviteOrganizationMember.bind(null, organization.id);
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm">{organization.name}</p>
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">Organization team</h1>
          <p className="text-muted-foreground text-sm">
            Manage organization-wide access and invitations across every event workspace.
          </p>
        </div>
      </header>

      {notice ? (
        <Alert>
          <AlertTitle>Organization team updated</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Organization team not updated</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {!canManage ? (
        <Alert>
          <ShieldCheck />
          <AlertTitle>Owner access required</AlertTitle>
          <AlertDescription>You can view this team, but only an organization owner can make changes.</AlertDescription>
        </Alert>
      ) : null}

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Invite an organization member</CardTitle>
            <CardDescription>
              Organization members can access every event. Owners can also manage this team.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={inviteAction}>
              <FieldGroup className="md:grid md:grid-cols-[minmax(0,1fr)_12rem_auto] md:items-end">
                <Field>
                  <FieldLabel htmlFor="organization-invite-email">Email</FieldLabel>
                  <Input
                    id="organization-invite-email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="teammate@example.com"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="organization-invite-role">Role</FieldLabel>
                  <NativeSelect id="organization-invite-role" name="role" defaultValue={OrganizationMemberRole.MEMBER}>
                    <NativeSelectOption value={OrganizationMemberRole.MEMBER}>Member</NativeSelectOption>
                    <NativeSelectOption value={OrganizationMemberRole.OWNER}>Owner</NativeSelectOption>
                  </NativeSelect>
                </Field>
                <Button type="submit">
                  <MailPlus data-icon="inline-start" />
                  Send invitation
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>Organization access applies to every event in {organization.name}.</CardDescription>
        </CardHeader>
        <CardContent>
          {snapshot.memberships.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UsersRound />
                </EmptyMedia>
                <EmptyTitle>No organization members</EmptyTitle>
                <EmptyDescription>Invite the first member to start building the organization team.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead className="hidden sm:table-cell">Role</TableHead>
                  <TableHead className="hidden sm:table-cell">Status</TableHead>
                  {canManage ? <TableHead className="text-right">Action</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.memberships.map((membership) => {
                  const active = membership.status === MembershipStatus.ACTIVE;
                  const isCurrentUser = membership.userId === currentUserId;
                  const action = setOrganizationMembershipActive.bind(null, organization.id, membership.id, !active);
                  return (
                    <TableRow key={membership.id}>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="font-medium">
                            {membership.displayName}
                            {isCurrentUser ? " (you)" : ""}
                          </span>
                          <span className="text-muted-foreground text-xs">{membership.email}</span>
                          <div className="flex flex-wrap gap-1 sm:hidden">
                            <Badge variant="outline">{roleLabel(membership.role)}</Badge>
                            <Badge variant={active ? "secondary" : "outline"}>{active ? "Active" : "Inactive"}</Badge>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">{roleLabel(membership.role)}</TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant={active ? "secondary" : "outline"}>{active ? "Active" : "Inactive"}</Badge>
                      </TableCell>
                      {canManage ? (
                        <TableCell className="text-right">
                          <MembershipAction
                            active={active}
                            action={action}
                            displayName={membership.displayName}
                            isCurrentUser={isCurrentUser}
                          />
                        </TableCell>
                      ) : null}
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
          <CardDescription>Pending invitations can be resent or revoked before they are accepted.</CardDescription>
        </CardHeader>
        <CardContent>
          {snapshot.invitations.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MailPlus />
                </EmptyMedia>
                <EmptyTitle>No invitations yet</EmptyTitle>
                <EmptyDescription>Invitations sent to organization members will appear here.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipient</TableHead>
                  <TableHead className="hidden sm:table-cell">Role</TableHead>
                  <TableHead className="hidden sm:table-cell">Status</TableHead>
                  {canManage ? <TableHead className="text-right">Actions</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.invitations.map((invitation) => {
                  const pending = invitation.status === OrganizationInvitationStatus.PENDING;
                  const status = invitationStatus(invitation.status, invitation.expiresAt);
                  return (
                    <TableRow key={invitation.id}>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="font-medium">{invitation.email}</span>
                          <div className="flex flex-wrap gap-1 sm:hidden">
                            <Badge variant="outline">{roleLabel(invitation.role)}</Badge>
                            <Badge variant={pending ? "secondary" : "outline"}>{status}</Badge>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">{roleLabel(invitation.role)}</TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant={pending ? "secondary" : "outline"}>{status}</Badge>
                      </TableCell>
                      {canManage ? (
                        <TableCell>
                          {pending ? (
                            <div className="flex flex-wrap justify-end gap-2">
                              <form action={resendOrganizationInvitation.bind(null, organization.id, invitation.id)}>
                                <Button type="submit" size="sm" variant="outline">
                                  Resend
                                </Button>
                              </form>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button type="button" size="sm" variant="destructive">
                                    Revoke
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Revoke this invitation?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      The invitation for {invitation.email} will no longer be accepted.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <form
                                      action={revokeOrganizationInvitation.bind(null, organization.id, invitation.id)}
                                    >
                                      <AlertDialogAction type="submit" variant="destructive">
                                        Revoke invitation
                                      </AlertDialogAction>
                                    </form>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          ) : null}
                        </TableCell>
                      ) : null}
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
