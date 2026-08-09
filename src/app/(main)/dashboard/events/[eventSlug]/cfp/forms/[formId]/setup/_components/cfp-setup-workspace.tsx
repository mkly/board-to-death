"use client";

import { useActionState, useState } from "react";

import { useRouter } from "next/navigation";

import { ArrowRight, Check, FileText, Save, Settings2, Sparkles, UserRound } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { CfpFormDefinition } from "@/lib/cfp";

import { type SaveCfpSetupState, saveCfpSetupStep } from "../actions";

type SetupStep = "setup" | "speakers" | "welcome" | "terms";

const INITIAL_STATE: SaveCfpSetupState = { status: "idle" };

function firstError(state: SaveCfpSetupState, field: string): string | undefined {
  return state.errors?.[field]?.[0];
}

function SaveMessage({ state }: { readonly state: SaveCfpSetupState }) {
  if (state.status === "idle") return <span />;
  return (
    <p
      aria-live="polite"
      className={state.status === "error" ? "text-destructive text-sm" : "text-muted-foreground text-sm"}
    >
      {state.message}
    </p>
  );
}

function SetupForm({
  action,
  definition,
  eventSlug,
  formId,
  onSaved,
}: {
  readonly action: typeof saveCfpSetupStep;
  readonly definition: CfpFormDefinition;
  readonly eventSlug: string;
  readonly formId: string;
  readonly onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState(async (previousState: SaveCfpSetupState, formData: FormData) => {
    const result = await action(eventSlug, formId, previousState, formData);
    if (result.status === "success") onSaved();
    return result;
  }, INITIAL_STATE);

  return (
    <form action={formAction}>
      <input type="hidden" name="step" value="setup" />
      <Card>
        <CardHeader>
          <CardTitle>Form setup</CardTitle>
          <CardDescription>Name the form, choose what it collects, and decide who can open it.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field data-invalid={Boolean(firstError(state, "title")) || undefined}>
              <FieldLabel htmlFor="cfp-title">Form name</FieldLabel>
              <Input
                id="cfp-title"
                name="title"
                defaultValue={definition.title}
                minLength={3}
                maxLength={120}
                aria-invalid={Boolean(firstError(state, "title")) || undefined}
                required
              />
              <FieldDescription>
                Admins see this name in the CFP workspace; applicants see it during submission.
              </FieldDescription>
              <FieldError>{firstError(state, "title")}</FieldError>
            </Field>

            <FieldSet>
              <FieldLegend variant="label">Submission type</FieldLegend>
              <FieldDescription>Choose the workflow every response to this form will follow.</FieldDescription>
              <RadioGroup name="submissionKind" defaultValue={definition.submissionKind ?? "ABSTRACT"} required>
                <FieldLabel htmlFor="submission-abstract">
                  <Field orientation="horizontal">
                    <RadioGroupItem id="submission-abstract" value="ABSTRACT" />
                    <FieldContent>
                      <FieldTitle>Abstract proposal</FieldTitle>
                      <FieldDescription>
                        Applicants propose a session for evaluation and a later decision.
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                </FieldLabel>
                <FieldLabel htmlFor="submission-guaranteed">
                  <Field orientation="horizontal">
                    <RadioGroupItem id="submission-guaranteed" value="GUARANTEED_SESSION" />
                    <FieldContent>
                      <FieldTitle>Guaranteed session</FieldTitle>
                      <FieldDescription>
                        Accepted invitees provide details for a session already promised a place.
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                </FieldLabel>
              </RadioGroup>
              <FieldError>{firstError(state, "submissionKind")}</FieldError>
            </FieldSet>

            <FieldSet>
              <FieldLegend variant="label">Access</FieldLegend>
              <FieldDescription>
                Restricted forms are intended for applicants who receive a private access link.
              </FieldDescription>
              <RadioGroup name="accessPolicy" defaultValue={definition.accessPolicy ?? "OPEN"} required>
                <FieldLabel htmlFor="access-open">
                  <Field orientation="horizontal">
                    <RadioGroupItem id="access-open" value="OPEN" />
                    <FieldContent>
                      <FieldTitle>Open</FieldTitle>
                      <FieldDescription>Anyone with the published form URL can start a submission.</FieldDescription>
                    </FieldContent>
                  </Field>
                </FieldLabel>
                <FieldLabel htmlFor="access-restricted">
                  <Field orientation="horizontal">
                    <RadioGroupItem id="access-restricted" value="RESTRICTED" />
                    <FieldContent>
                      <FieldTitle>Restricted</FieldTitle>
                      <FieldDescription>Only applicants with event-issued access can continue.</FieldDescription>
                    </FieldContent>
                  </Field>
                </FieldLabel>
              </RadioGroup>
              <FieldError>{firstError(state, "accessPolicy")}</FieldError>
            </FieldSet>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <SaveMessage state={state} />
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : <ArrowRight data-icon="inline-end" />}
            {pending ? "Saving..." : "Save and continue"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

function WelcomeForm({
  action,
  definition,
  eventSlug,
  formId,
  onSaved,
}: {
  readonly action: typeof saveCfpSetupStep;
  readonly definition: CfpFormDefinition;
  readonly eventSlug: string;
  readonly formId: string;
  readonly onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState(async (previousState: SaveCfpSetupState, formData: FormData) => {
    const result = await action(eventSlug, formId, previousState, formData);
    if (result.status === "success") onSaved();
    return result;
  }, INITIAL_STATE);

  return (
    <form action={formAction}>
      <input type="hidden" name="step" value="welcome" />
      <Card>
        <CardHeader>
          <CardTitle>Welcome and instructions</CardTitle>
          <CardDescription>Set expectations before applicants begin answering questions.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field data-invalid={Boolean(firstError(state, "welcomeTitle")) || undefined}>
              <FieldLabel htmlFor="welcome-title">Welcome heading</FieldLabel>
              <Input
                id="welcome-title"
                name="welcomeTitle"
                defaultValue={definition.welcomeTitle ?? "Submit your session"}
                minLength={3}
                maxLength={120}
                aria-invalid={Boolean(firstError(state, "welcomeTitle")) || undefined}
                required
              />
              <FieldError>{firstError(state, "welcomeTitle")}</FieldError>
            </Field>
            <Field data-invalid={Boolean(firstError(state, "welcomeContent")) || undefined}>
              <FieldLabel htmlFor="welcome-content">Welcome message</FieldLabel>
              <Textarea
                id="welcome-content"
                name="welcomeContent"
                defaultValue={definition.welcomeContent ?? ""}
                minLength={10}
                maxLength={4_000}
                className="min-h-32"
                aria-invalid={Boolean(firstError(state, "welcomeContent")) || undefined}
                required
              />
              <FieldDescription>Introduce the opportunity and explain what makes a strong submission.</FieldDescription>
              <FieldError>{firstError(state, "welcomeContent")}</FieldError>
            </Field>
            <Field data-invalid={Boolean(firstError(state, "instructions")) || undefined}>
              <FieldLabel htmlFor="submission-instructions">Submission instructions</FieldLabel>
              <Textarea
                id="submission-instructions"
                name="instructions"
                defaultValue={definition.instructions ?? ""}
                minLength={10}
                maxLength={4_000}
                className="min-h-32"
                aria-invalid={Boolean(firstError(state, "instructions")) || undefined}
                required
              />
              <FieldDescription>
                Share preparation notes, review criteria, or information applicants should gather.
              </FieldDescription>
              <FieldError>{firstError(state, "instructions")}</FieldError>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <SaveMessage state={state} />
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : <ArrowRight data-icon="inline-end" />}
            {pending ? "Saving..." : "Save and continue"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

function SpeakerRequirementsForm({
  action,
  definition,
  eventSlug,
  formId,
  onSaved,
}: {
  readonly action: typeof saveCfpSetupStep;
  readonly definition: CfpFormDefinition;
  readonly eventSlug: string;
  readonly formId: string;
  readonly onSaved: () => void;
}) {
  const requiredFields = new Set(definition.requiredSpeakerFields ?? []);
  const [minimumSpeakerCount, setMinimumSpeakerCount] = useState(String(definition.minimumSpeakerCount ?? 1));
  const [maximumSpeakerCount, setMaximumSpeakerCount] = useState(String(definition.maximumSpeakerCount ?? 1));
  const [biographyRequired, setBiographyRequired] = useState(requiredFields.has("biography"));
  const [contactRequired, setContactRequired] = useState(requiredFields.has("contact"));
  const [speakerConsentRequired, setSpeakerConsentRequired] = useState(requiredFields.has("consent"));
  const [state, formAction, pending] = useActionState(async (previousState: SaveCfpSetupState, formData: FormData) => {
    const result = await action(eventSlug, formId, previousState, formData);
    if (result.status === "success") onSaved();
    return result;
  }, INITIAL_STATE);

  return (
    <form action={formAction}>
      <input type="hidden" name="step" value="speakers" />
      <input type="hidden" name="biographyRequired" value={String(biographyRequired)} />
      <input type="hidden" name="contactRequired" value={String(contactRequired)} />
      <input type="hidden" name="speakerConsentRequired" value={String(speakerConsentRequired)} />
      <Card>
        <CardHeader>
          <CardTitle>Speaker requirements</CardTitle>
          <CardDescription>Set team-size boundaries and the details every listed speaker must provide.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={Boolean(firstError(state, "minimumSpeakerCount")) || undefined}>
                <FieldLabel htmlFor="minimum-speaker-count">Minimum speakers</FieldLabel>
                <Input
                  id="minimum-speaker-count"
                  name="minimumSpeakerCount"
                  type="number"
                  value={minimumSpeakerCount}
                  onChange={(event) => setMinimumSpeakerCount(event.target.value)}
                  min={1}
                  max={20}
                  aria-invalid={Boolean(firstError(state, "minimumSpeakerCount")) || undefined}
                  required
                />
                <FieldDescription>The fewest speakers an applicant can list.</FieldDescription>
                <FieldError>{firstError(state, "minimumSpeakerCount")}</FieldError>
              </Field>
              <Field data-invalid={Boolean(firstError(state, "maximumSpeakerCount")) || undefined}>
                <FieldLabel htmlFor="maximum-speaker-count">Maximum speakers</FieldLabel>
                <Input
                  id="maximum-speaker-count"
                  name="maximumSpeakerCount"
                  type="number"
                  value={maximumSpeakerCount}
                  onChange={(event) => setMaximumSpeakerCount(event.target.value)}
                  min={1}
                  max={20}
                  aria-invalid={Boolean(firstError(state, "maximumSpeakerCount")) || undefined}
                  required
                />
                <FieldDescription>The most speakers an applicant can list.</FieldDescription>
                <FieldError>{firstError(state, "maximumSpeakerCount")}</FieldError>
              </Field>
            </FieldGroup>

            <FieldSet>
              <FieldLegend variant="label">Required details</FieldLegend>
              <FieldDescription>Choose the information each speaker must complete before submission.</FieldDescription>
              <FieldGroup className="gap-3">
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="speaker-biography-required">Biography</FieldLabel>
                    <FieldDescription>Require a public-facing speaker biography.</FieldDescription>
                  </FieldContent>
                  <Switch
                    id="speaker-biography-required"
                    checked={biographyRequired}
                    onCheckedChange={setBiographyRequired}
                  />
                </Field>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="speaker-contact-required">Contact details</FieldLabel>
                    <FieldDescription>Require direct contact information for each speaker.</FieldDescription>
                  </FieldContent>
                  <Switch
                    id="speaker-contact-required"
                    checked={contactRequired}
                    onCheckedChange={setContactRequired}
                  />
                </Field>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="speaker-consent-required">Consent</FieldLabel>
                    <FieldDescription>Require each speaker to confirm the event's consent terms.</FieldDescription>
                  </FieldContent>
                  <Switch
                    id="speaker-consent-required"
                    checked={speakerConsentRequired}
                    onCheckedChange={setSpeakerConsentRequired}
                  />
                </Field>
              </FieldGroup>
            </FieldSet>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <SaveMessage state={state} />
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : <ArrowRight data-icon="inline-end" />}
            {pending ? "Saving..." : "Save and continue"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

function TermsForm({
  action,
  definition,
  eventSlug,
  formId,
  onSaved,
}: {
  readonly action: typeof saveCfpSetupStep;
  readonly definition: CfpFormDefinition;
  readonly eventSlug: string;
  readonly formId: string;
  readonly onSaved: () => void;
}) {
  const [consentRequired, setConsentRequired] = useState(definition.consentRequired ?? false);
  const [state, formAction, pending] = useActionState(async (previousState: SaveCfpSetupState, formData: FormData) => {
    const result = await action(eventSlug, formId, previousState, formData);
    if (result.status === "success") onSaved();
    return result;
  }, INITIAL_STATE);

  return (
    <form action={formAction}>
      <input type="hidden" name="step" value="terms" />
      <input type="hidden" name="consentRequired" value={String(consentRequired)} />
      <Card>
        <CardHeader>
          <CardTitle>Terms and consent</CardTitle>
          <CardDescription>Explain the terms applicants should understand before submitting.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field data-invalid={Boolean(firstError(state, "termsContent")) || undefined}>
              <FieldLabel htmlFor="terms-content">Terms or consent statement</FieldLabel>
              <Textarea
                id="terms-content"
                name="termsContent"
                defaultValue={definition.termsContent ?? ""}
                minLength={consentRequired ? 10 : undefined}
                maxLength={8_000}
                className="min-h-48"
                aria-invalid={Boolean(firstError(state, "termsContent")) || undefined}
                required={consentRequired}
              />
              <FieldDescription>
                Include recording, publication, conduct, or data-use terms when relevant.
              </FieldDescription>
              <FieldError>{firstError(state, "termsContent")}</FieldError>
            </Field>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="consent-required">Require explicit consent</FieldLabel>
                <FieldDescription>Applicants must accept the statement before they can submit.</FieldDescription>
              </FieldContent>
              <Switch id="consent-required" checked={consentRequired} onCheckedChange={setConsentRequired} />
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <SaveMessage state={state} />
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
            {pending ? "Saving..." : "Save terms"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

export function CfpSetupWorkspace({
  definition,
  eventSlug,
  formId,
}: {
  readonly definition: CfpFormDefinition;
  readonly eventSlug: string;
  readonly formId: string;
}) {
  const [step, setStep] = useState<SetupStep>("setup");
  const router = useRouter();
  const saved = (nextStep?: SetupStep) => {
    router.refresh();
    if (nextStep) setStep(nextStep);
  };

  return (
    <Tabs
      value={step}
      onValueChange={(value) => setStep(value as SetupStep)}
      orientation="vertical"
      className="flex-col gap-6 md:flex-row"
    >
      <TabsList variant="line" aria-label="CFP setup steps" className="w-full shrink-0 items-stretch md:w-56">
        <TabsTrigger value="setup">
          <Settings2 data-icon="inline-start" />
          Setup
        </TabsTrigger>
        <TabsTrigger value="speakers">
          <UserRound data-icon="inline-start" />
          Speakers
        </TabsTrigger>
        <TabsTrigger value="welcome">
          <Sparkles data-icon="inline-start" />
          Welcome
        </TabsTrigger>
        <TabsTrigger value="terms">
          <FileText data-icon="inline-start" />
          Terms
        </TabsTrigger>
      </TabsList>
      <div className="min-w-0 flex-1">
        <TabsContent value="setup">
          <SetupForm
            action={saveCfpSetupStep}
            definition={definition}
            eventSlug={eventSlug}
            formId={formId}
            onSaved={() => saved("speakers")}
          />
        </TabsContent>
        <TabsContent value="speakers">
          <SpeakerRequirementsForm
            action={saveCfpSetupStep}
            definition={definition}
            eventSlug={eventSlug}
            formId={formId}
            onSaved={() => saved("welcome")}
          />
        </TabsContent>
        <TabsContent value="welcome">
          <WelcomeForm
            action={saveCfpSetupStep}
            definition={definition}
            eventSlug={eventSlug}
            formId={formId}
            onSaved={() => saved("terms")}
          />
        </TabsContent>
        <TabsContent value="terms">
          <TermsForm
            action={saveCfpSetupStep}
            definition={definition}
            eventSlug={eventSlug}
            formId={formId}
            onSaved={() => saved()}
          />
          <Alert className="mt-4">
            <Check />
            <AlertTitle>Setup saves are versioned</AlertTitle>
            <AlertDescription>
              Every saved step preserves the previous draft so later editors never rewrite history.
            </AlertDescription>
          </Alert>
        </TabsContent>
      </div>
    </Tabs>
  );
}
