"use client";

import { useActionState, useMemo, useState } from "react";

import { Save } from "lucide-react";
import { Temporal } from "temporal-polyfill";

import { DateTimePicker } from "@/components/date-time-picker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { type SaveCfpPolicySettingsState, saveCfpPolicySettings } from "../actions";
import type { CfpDraftPolicyValue, CfpPolicySettingsFields } from "../schema";

interface CfpPolicySettingsProps {
  readonly eventSlug: string;
  readonly formId: string;
  readonly timezone: string;
  readonly initialSettings: CfpPolicySettingsFields;
}

const INITIAL_STATE: SaveCfpPolicySettingsState = { status: "idle" };

function firstError(state: SaveCfpPolicySettingsState, field: string): string | undefined {
  return state.errors?.[field]?.[0];
}

function minimumClosingTime(openingTime: string): string | undefined {
  try {
    return Temporal.PlainDateTime.from(openingTime).add({ minutes: 1 }).toString({ smallestUnit: "minute" });
  } catch {
    return undefined;
  }
}

export function CfpPolicySettings({ eventSlug, formId, timezone, initialSettings }: CfpPolicySettingsProps) {
  const [settings, setSettings] = useState(initialSettings);
  const [state, formAction, pending] = useActionState(saveCfpPolicySettings, INITIAL_STATE);
  const minimumClose = useMemo(() => minimumClosingTime(settings.submissionOpensAt), [settings.submissionOpensAt]);

  const updateSetting = <Key extends keyof CfpPolicySettingsFields>(field: Key, value: CfpPolicySettingsFields[Key]) =>
    setSettings((current) => ({ ...current, [field]: value }));

  return (
    <form action={formAction}>
      <input type="hidden" name="eventSlug" value={eventSlug} />
      <input type="hidden" name="formId" value={formId} />
      <input type="hidden" name="draftPolicy" value={settings.draftPolicy} />
      <Card>
        <CardHeader>
          <CardTitle>Submission availability</CardTitle>
          <CardDescription>
            Set the submission window in {timezone}, then choose how speakers can save drafts and collaborate.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={Boolean(firstError(state, "submissionOpensAt")) || undefined}>
                <FieldLabel htmlFor="cfp-submission-opens">Opens at</FieldLabel>
                <DateTimePicker
                  id="cfp-submission-opens"
                  name="submissionOpensAt"
                  value={settings.submissionOpensAt}
                  onChange={(next) => updateSetting("submissionOpensAt", next)}
                  aria-invalid={Boolean(firstError(state, "submissionOpensAt")) || undefined}
                />
                <FieldDescription>{timezone}</FieldDescription>
                <FieldError>{firstError(state, "submissionOpensAt")}</FieldError>
              </Field>
              <Field data-invalid={Boolean(firstError(state, "submissionClosesAt")) || undefined}>
                <FieldLabel htmlFor="cfp-submission-closes">Closes at</FieldLabel>
                <DateTimePicker
                  id="cfp-submission-closes"
                  name="submissionClosesAt"
                  value={settings.submissionClosesAt}
                  min={minimumClose}
                  onChange={(next) => updateSetting("submissionClosesAt", next)}
                  aria-invalid={Boolean(firstError(state, "submissionClosesAt")) || undefined}
                />
                <FieldDescription>Must be after the opening time.</FieldDescription>
                <FieldError>{firstError(state, "submissionClosesAt")}</FieldError>
              </Field>
            </div>

            <FieldSet>
              <FieldLegend variant="label">Draft policy</FieldLegend>
              <FieldDescription>
                Choose whether speakers submit in one sitting or can return to drafts.
              </FieldDescription>
              <ToggleGroup
                type="single"
                variant="outline"
                value={settings.draftPolicy}
                onValueChange={(value) => value && updateSetting("draftPolicy", value as CfpDraftPolicyValue)}
                className="grid w-full grid-cols-1 sm:grid-cols-3"
                aria-label="Draft policy"
              >
                <ToggleGroupItem value="DISABLED">No drafts</ToggleGroupItem>
                <ToggleGroupItem value="ALLOWED">Drafts allowed</ToggleGroupItem>
                <ToggleGroupItem value="REQUIRED">Start as draft</ToggleGroupItem>
              </ToggleGroup>
            </FieldSet>

            <FieldSet>
              <FieldLegend variant="label">Submission limits</FieldLegend>
              <FieldDescription>
                Limits are enforced per speaker and per proposal when submissions open.
              </FieldDescription>
              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={Boolean(firstError(state, "maxSubmissionsPerSpeaker")) || undefined}>
                  <FieldLabel htmlFor="cfp-speaker-limit">Submissions per speaker</FieldLabel>
                  <Input
                    id="cfp-speaker-limit"
                    name="maxSubmissionsPerSpeaker"
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    value={settings.maxSubmissionsPerSpeaker}
                    onChange={(event) => updateSetting("maxSubmissionsPerSpeaker", Number(event.target.value))}
                    aria-invalid={Boolean(firstError(state, "maxSubmissionsPerSpeaker")) || undefined}
                    required
                  />
                  <FieldError>{firstError(state, "maxSubmissionsPerSpeaker")}</FieldError>
                </Field>
                <Field data-invalid={Boolean(firstError(state, "maxParticipantsPerSubmission")) || undefined}>
                  <FieldLabel htmlFor="cfp-participant-limit">Participants per submission</FieldLabel>
                  <Input
                    id="cfp-participant-limit"
                    name="maxParticipantsPerSubmission"
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    value={settings.maxParticipantsPerSubmission}
                    onChange={(event) => updateSetting("maxParticipantsPerSubmission", Number(event.target.value))}
                    aria-invalid={Boolean(firstError(state, "maxParticipantsPerSubmission")) || undefined}
                    required
                  />
                  <FieldError>{firstError(state, "maxParticipantsPerSubmission")}</FieldError>
                </Field>
              </FieldGroup>
            </FieldSet>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <div aria-live="polite">
            {state.message ? (
              <Alert variant={state.status === "error" ? "destructive" : "default"}>
                <AlertTitle>{state.status === "error" ? "Settings not saved" : "Settings saved"}</AlertTitle>
                <AlertDescription>{state.message}</AlertDescription>
              </Alert>
            ) : (
              <p className="text-muted-foreground text-sm">Saving creates a new policy version.</p>
            )}
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
            {pending ? "Saving..." : "Save settings"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
