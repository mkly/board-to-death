"use client";

import { useActionState, useState } from "react";

import { MailCheck, Save, ShieldCheck } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";

import { type SaveCfpAdministratorsState, saveCfpAdministrators } from "../actions";

export interface CfpAdministratorSetting {
  readonly id: string;
  readonly displayName: string;
  readonly externalId: string;
  readonly role: "OWNER" | "EDITOR" | "REVIEWER" | null;
  readonly notifyOnNewSubmission: boolean;
  readonly notifyOnSubmissionUpdate: boolean;
}

const INITIAL_STATE: SaveCfpAdministratorsState = { status: "idle" };

export function CfpAdministratorSettings({
  administrators,
  canManage,
  eventSlug,
  formId,
}: {
  readonly administrators: readonly CfpAdministratorSetting[];
  readonly canManage: boolean;
  readonly eventSlug: string;
  readonly formId: string;
}) {
  const [assignedIds, setAssignedIds] = useState(
    () => new Set(administrators.filter(({ role }) => role !== null).map(({ id }) => id)),
  );
  const [newSubmissionIds, setNewSubmissionIds] = useState(
    () => new Set(administrators.filter(({ notifyOnNewSubmission }) => notifyOnNewSubmission).map(({ id }) => id)),
  );
  const [submissionUpdateIds, setSubmissionUpdateIds] = useState(
    () =>
      new Set(administrators.filter(({ notifyOnSubmissionUpdate }) => notifyOnSubmissionUpdate).map(({ id }) => id)),
  );
  const [state, formAction, pending] = useActionState(
    saveCfpAdministrators.bind(null, eventSlug, formId),
    INITIAL_STATE,
  );

  const setAssigned = (administratorId: string, assigned: boolean) => {
    setAssignedIds((current) => {
      const next = new Set(current);
      if (assigned) next.add(administratorId);
      else next.delete(administratorId);
      return next;
    });
    if (!assigned) {
      setNewSubmissionIds((current) => {
        const next = new Set(current);
        next.delete(administratorId);
        return next;
      });
      setSubmissionUpdateIds((current) => {
        const next = new Set(current);
        next.delete(administratorId);
        return next;
      });
    }
  };

  const setAlertRecipient = (setter: typeof setNewSubmissionIds, administratorId: string, enabled: boolean) => {
    setter((current) => {
      const next = new Set(current);
      if (enabled) next.add(administratorId);
      else next.delete(administratorId);
      return next;
    });
  };

  return (
    <form action={formAction}>
      {[...assignedIds].map((administratorId) => (
        <input key={administratorId} type="hidden" name="administratorIds" value={administratorId} />
      ))}
      {[...newSubmissionIds].map((administratorId) => (
        <input key={administratorId} type="hidden" name="newSubmissionAdministratorIds" value={administratorId} />
      ))}
      {[...submissionUpdateIds].map((administratorId) => (
        <input key={administratorId} type="hidden" name="submissionUpdateAdministratorIds" value={administratorId} />
      ))}
      <Card>
        <CardHeader>
          <CardTitle>Administrators and alerts</CardTitle>
          <CardDescription>
            Assign eligible event administrators to this CFP and choose which admin alerts each person receives.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <FieldSet>
            <FieldLegend>Form administrators</FieldLegend>
            <FieldDescription>
              Owners stay assigned so the form always has a responsible administrator.
            </FieldDescription>
            <FieldGroup>
              {administrators.map((administrator) => {
                const isOwner = administrator.role === "OWNER";
                return (
                  <Field
                    key={administrator.id}
                    orientation="horizontal"
                    data-disabled={!canManage || isOwner || undefined}
                  >
                    <Checkbox
                      id={`administrator-${administrator.id}`}
                      checked={assignedIds.has(administrator.id)}
                      onCheckedChange={(checked) => setAssigned(administrator.id, checked === true)}
                      disabled={!canManage || isOwner}
                    />
                    <FieldContent>
                      <FieldLabel htmlFor={`administrator-${administrator.id}`}>
                        {administrator.displayName}
                        {administrator.role ? (
                          <Badge variant="secondary">{administrator.role.toLowerCase()}</Badge>
                        ) : null}
                      </FieldLabel>
                      <FieldDescription>{administrator.externalId}</FieldDescription>
                    </FieldContent>
                  </Field>
                );
              })}
            </FieldGroup>
          </FieldSet>

          <FieldSet>
            <FieldLegend>Admin alert recipients</FieldLegend>
            <FieldDescription>
              These opt-ins are separate; an administrator may receive either, both, or neither alert.
            </FieldDescription>
            <FieldGroup>
              {administrators.map((administrator) => {
                const disabled = !canManage || !assignedIds.has(administrator.id);
                return (
                  <div key={administrator.id} className="flex flex-col gap-3 rounded-lg border p-3">
                    <div>
                      <p className="font-medium text-sm">{administrator.displayName}</p>
                      <p className="text-muted-foreground text-sm">{administrator.externalId}</p>
                    </div>
                    <Field orientation="horizontal" data-disabled={disabled || undefined}>
                      <FieldContent>
                        <FieldLabel htmlFor={`new-submission-${administrator.id}`}>New submissions</FieldLabel>
                        <FieldDescription>Send an alert when this form receives a submission.</FieldDescription>
                      </FieldContent>
                      <Switch
                        id={`new-submission-${administrator.id}`}
                        checked={newSubmissionIds.has(administrator.id)}
                        onCheckedChange={(checked) => setAlertRecipient(setNewSubmissionIds, administrator.id, checked)}
                        disabled={disabled}
                      />
                    </Field>
                    <Field orientation="horizontal" data-disabled={disabled || undefined}>
                      <FieldContent>
                        <FieldLabel htmlFor={`submission-update-${administrator.id}`}>Submission updates</FieldLabel>
                        <FieldDescription>
                          Send an alert when an applicant updates an existing submission.
                        </FieldDescription>
                      </FieldContent>
                      <Switch
                        id={`submission-update-${administrator.id}`}
                        checked={submissionUpdateIds.has(administrator.id)}
                        onCheckedChange={(checked) =>
                          setAlertRecipient(setSubmissionUpdateIds, administrator.id, checked)
                        }
                        disabled={disabled}
                      />
                    </Field>
                  </div>
                );
              })}
            </FieldGroup>
          </FieldSet>

          <Alert>
            <MailCheck />
            <AlertTitle>Submitter confirmation stays mandatory</AlertTitle>
            <AlertDescription>
              Admin alert preferences never replace the confirmation sent to an applicant after a successful submission.
            </AlertDescription>
          </Alert>
          {!canManage ? (
            <Alert>
              <ShieldCheck />
              <AlertTitle>Owner access required</AlertTitle>
              <AlertDescription>
                Only an assigned form owner can change administrators or alert recipients.
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <p className="text-muted-foreground text-sm" aria-live="polite">
            {state.message}
          </p>
          <Button type="submit" disabled={pending || !canManage || administrators.length === 0}>
            {pending ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
            {pending ? "Saving..." : "Save administrators"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
