"use client";

import { useActionState, useMemo, useState } from "react";

import { BellRing, Save } from "lucide-react";

import { SanitizedMarkdown } from "@/components/content/sanitized-markdown";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useActionToast } from "@/hooks/use-action-toast";
import { CFP_MESSAGE_VARIABLE_KEYS, CFP_MESSAGE_VARIABLES } from "@/lib/cfp/messages";
import { EMAIL_TEMPLATE_PREVIEW_VALUES, renderEmailTemplate } from "@/lib/communications/email-templates";

import { type SaveCfpMessageSettingsState, saveCfpMessageSettings } from "../actions";

export interface InitialCfpMessageSettings {
  readonly portalAutoRedirect: boolean;
  readonly portalRedirectDelaySeconds: number;
  readonly remindersEnabled: boolean;
  readonly reminderDaysBeforeClose: number;
  readonly reminderSendAt: string;
  readonly submissionConfirmation: string;
  readonly thankYou: string;
}

interface CfpMessageSettingsProps {
  readonly event: {
    readonly name: string;
    readonly startsAt: string;
    readonly location: string | null;
  };
  readonly eventSlug: string;
  readonly formId: string;
  readonly initialSettings: InitialCfpMessageSettings;
  readonly onSaved: () => void;
}

const INITIAL_STATE: SaveCfpMessageSettingsState = { status: "idle" };

function firstError(state: SaveCfpMessageSettingsState, field: string): string | undefined {
  return state.errors?.[field]?.[0];
}

function preview(bodyTemplate: string, values: Readonly<Record<string, string>>) {
  return renderEmailTemplate(
    {
      key: "cfp-message-preview",
      name: "CFP message preview",
      subjectTemplate: "Message from {{event.name}}",
      bodyTemplate,
    },
    values,
    { allowedVariables: CFP_MESSAGE_VARIABLE_KEYS },
  );
}

export function CfpMessageSettings({ event, eventSlug, formId, initialSettings, onSaved }: CfpMessageSettingsProps) {
  const [remindersEnabled, setRemindersEnabled] = useState(initialSettings.remindersEnabled);
  const [portalAutoRedirect, setPortalAutoRedirect] = useState(initialSettings.portalAutoRedirect);
  const [portalRedirectDelaySeconds, setPortalRedirectDelaySeconds] = useState(
    initialSettings.portalRedirectDelaySeconds.toString(),
  );
  const [reminderDaysBeforeClose, setReminderDaysBeforeClose] = useState(
    initialSettings.reminderDaysBeforeClose.toString(),
  );
  const [reminderSendAt, setReminderSendAt] = useState(initialSettings.reminderSendAt);
  const [submissionConfirmation, setSubmissionConfirmation] = useState(initialSettings.submissionConfirmation);
  const [thankYou, setThankYou] = useState(initialSettings.thankYou);
  const [state, formAction, pending] = useActionState(
    async (previousState: SaveCfpMessageSettingsState, formData: FormData) => {
      const result = await saveCfpMessageSettings(eventSlug, formId, previousState, formData);
      if (result.status === "success") onSaved();
      return result;
    },
    INITIAL_STATE,
  );
  const previewValues = useMemo(
    () => ({
      ...EMAIL_TEMPLATE_PREVIEW_VALUES,
      "event.name": event.name,
      "event.start_date": event.startsAt,
      "event.location": event.location ?? "Online",
    }),
    [event],
  );
  useActionToast(state);
  const confirmationPreview = preview(submissionConfirmation, previewValues);
  const thankYouPreview = preview(thankYou, previewValues);

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <form noValidate action={formAction}>
        <input type="hidden" name="portalAutoRedirect" value={String(portalAutoRedirect)} />
        {!portalAutoRedirect ? (
          <input type="hidden" name="portalRedirectDelaySeconds" value={portalRedirectDelaySeconds} />
        ) : null}
        <input type="hidden" name="remindersEnabled" value={String(remindersEnabled)} />
        {!remindersEnabled ? (
          <>
            <input type="hidden" name="reminderDaysBeforeClose" value={reminderDaysBeforeClose} />
            <input type="hidden" name="reminderSendAt" value={reminderSendAt} />
          </>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>Applicant messages</CardTitle>
            <CardDescription>
              Set submission feedback and choose when applicants with unfinished drafts receive a reminder.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="cfp-portal-auto-redirect">Continue to speaker portal automatically</FieldLabel>
                  <FieldDescription>
                    Applicants can always continue manually. When enabled, the confirmation counts down before opening
                    the lead speaker's portal.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  checked={portalAutoRedirect}
                  id="cfp-portal-auto-redirect"
                  onCheckedChange={setPortalAutoRedirect}
                />
              </Field>
              <Field
                data-disabled={!portalAutoRedirect || undefined}
                data-invalid={Boolean(firstError(state, "portalRedirectDelaySeconds")) || undefined}
              >
                <FieldLabel htmlFor="cfp-portal-redirect-delay">Redirect delay in seconds</FieldLabel>
                <Input
                  aria-invalid={Boolean(firstError(state, "portalRedirectDelaySeconds")) || undefined}
                  disabled={!portalAutoRedirect}
                  id="cfp-portal-redirect-delay"
                  max={60}
                  min={5}
                  name="portalRedirectDelaySeconds"
                  onChange={(event) => setPortalRedirectDelaySeconds(event.target.value)}
                  required={portalAutoRedirect}
                  step={1}
                  type="number"
                  value={portalRedirectDelaySeconds}
                />
                <FieldDescription>Applicants can cancel the redirect from the confirmation screen.</FieldDescription>
                <FieldError>{firstError(state, "portalRedirectDelaySeconds")}</FieldError>
              </Field>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="cfp-reminders-enabled">Draft reminders</FieldLabel>
                  <FieldDescription>
                    Send one reminder before submissions close. Applicants without a draft are never contacted.
                  </FieldDescription>
                </FieldContent>
                <Switch id="cfp-reminders-enabled" checked={remindersEnabled} onCheckedChange={setRemindersEnabled} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  data-disabled={!remindersEnabled || undefined}
                  data-invalid={Boolean(firstError(state, "reminderDaysBeforeClose")) || undefined}
                >
                  <FieldLabel htmlFor="cfp-reminder-days">Days before close</FieldLabel>
                  <Input
                    id="cfp-reminder-days"
                    name="reminderDaysBeforeClose"
                    type="number"
                    min={1}
                    max={90}
                    step={1}
                    value={reminderDaysBeforeClose}
                    onChange={(event) => setReminderDaysBeforeClose(event.target.value)}
                    disabled={!remindersEnabled}
                    aria-invalid={Boolean(firstError(state, "reminderDaysBeforeClose")) || undefined}
                    required={remindersEnabled}
                  />
                  <FieldError>{firstError(state, "reminderDaysBeforeClose")}</FieldError>
                </Field>
                <Field
                  data-disabled={!remindersEnabled || undefined}
                  data-invalid={Boolean(firstError(state, "reminderSendAt")) || undefined}
                >
                  <FieldLabel htmlFor="cfp-reminder-time">Event-local send time</FieldLabel>
                  <Input
                    id="cfp-reminder-time"
                    name="reminderSendAt"
                    type="time"
                    value={reminderSendAt}
                    onChange={(event) => setReminderSendAt(event.target.value)}
                    disabled={!remindersEnabled}
                    aria-invalid={Boolean(firstError(state, "reminderSendAt")) || undefined}
                    required={remindersEnabled}
                  />
                  <FieldError>{firstError(state, "reminderSendAt")}</FieldError>
                </Field>
              </div>
              <Field data-invalid={Boolean(firstError(state, "submissionConfirmation")) || undefined}>
                <FieldLabel htmlFor="cfp-submission-confirmation">Submission confirmation</FieldLabel>
                <Textarea
                  id="cfp-submission-confirmation"
                  name="submissionConfirmation"
                  value={submissionConfirmation}
                  onChange={(event) => setSubmissionConfirmation(event.target.value)}
                  className="min-h-32"
                  aria-invalid={Boolean(firstError(state, "submissionConfirmation")) || undefined}
                  maxLength={20_000}
                  required
                />
                <FieldDescription>
                  Shown immediately after an applicant submits. Markdown is supported.
                </FieldDescription>
                <FieldError>{firstError(state, "submissionConfirmation")}</FieldError>
              </Field>
              <Field data-invalid={Boolean(firstError(state, "thankYou")) || undefined}>
                <FieldLabel htmlFor="cfp-thank-you">Thank-you message</FieldLabel>
                <Textarea
                  id="cfp-thank-you"
                  name="thankYou"
                  value={thankYou}
                  onChange={(event) => setThankYou(event.target.value)}
                  className="min-h-32"
                  aria-invalid={Boolean(firstError(state, "thankYou")) || undefined}
                  maxLength={20_000}
                  required
                />
                <FieldDescription>Used in the follow-up message after a completed submission.</FieldDescription>
                <FieldError>{firstError(state, "thankYou")}</FieldError>
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter className="justify-between gap-3">
            <p className="text-muted-foreground text-sm">Saving changes updates your message templates.</p>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
              {pending ? "Saving..." : "Save and continue"}
            </Button>
          </CardFooter>
        </Card>
      </form>

      <div className="flex min-w-0 flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Variable catalog</CardTitle>
            <CardDescription>Only variables available during the CFP workflow are accepted.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {CFP_MESSAGE_VARIABLES.map(({ key, label }) => (
              <Badge key={key} variant="secondary" title={label}>{`{{${key}}}`}</Badge>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Live preview</CardTitle>
            <CardDescription>Representative event and applicant values are used below.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {[
              { label: "Confirmation", result: confirmationPreview },
              { label: "Thank you", result: thankYouPreview },
            ].map(({ label, result }) => (
              <section key={label} className="flex flex-col gap-2">
                <p className="font-medium text-sm">{label}</p>
                {result.ok ? (
                  <div className="rounded-lg border bg-background p-3">
                    <SanitizedMarkdown content={result.rendered.previewMarkdown} />
                  </div>
                ) : (
                  <Alert variant="destructive">
                    <BellRing />
                    <AlertTitle>Preview unavailable</AlertTitle>
                    <AlertDescription>{result.issues.map(({ message }) => message).join(" ")}</AlertDescription>
                  </Alert>
                )}
              </section>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
