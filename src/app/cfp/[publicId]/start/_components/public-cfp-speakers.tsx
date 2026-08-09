"use client";

import { useRef, useState } from "react";

import { PlusIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type { CfpFormDefinition } from "@/lib/cfp";

import type { PublicCfpFormActionState } from "../actions";

interface SpeakerFields {
  readonly key: number;
  readonly givenName: string;
  readonly familyName: string;
  readonly email: string;
  readonly phone: string;
  readonly biography: string;
  readonly consent: boolean;
}

interface PublicCfpSpeakersProps {
  readonly definition: CfpFormDefinition;
  readonly state: PublicCfpFormActionState;
  readonly initialParticipants?: readonly Record<string, string>[];
}

function emptySpeaker(key: number): SpeakerFields {
  return { key, givenName: "", familyName: "", email: "", phone: "", biography: "", consent: false };
}

function speakerFromRecord(record: Record<string, string> | undefined, key: number): SpeakerFields {
  return {
    key,
    givenName: record?.givenName ?? "",
    familyName: record?.familyName ?? "",
    email: record?.email ?? "",
    phone: record?.phone ?? "",
    biography: record?.biography ?? "",
    consent: Boolean(record?.consent),
  };
}

function fieldErrors(state: PublicCfpFormActionState, name: string) {
  return state.errors?.[name]?.map((message) => ({ message }));
}

export function PublicCfpSpeakers({ definition, state, initialParticipants }: PublicCfpSpeakersProps) {
  const minimum = definition.minimumSpeakerCount;
  const maximum = definition.maximumSpeakerCount;
  const nextKey = useRef(Math.max(initialParticipants?.length ?? 0, minimum ?? 0));
  const [speakers, setSpeakers] = useState<readonly SpeakerFields[]>(() =>
    initialParticipants && initialParticipants.length > 0
      ? initialParticipants.map((participant, index) => speakerFromRecord(participant, index))
      : Array.from({ length: minimum ?? 0 }, (_, index) => emptySpeaker(index)),
  );
  if (minimum === undefined || maximum === undefined) return null;

  const requiredFields = new Set(definition.requiredSpeakerFields ?? []);
  const updateSpeaker = <K extends keyof Omit<SpeakerFields, "key">>(
    index: number,
    field: K,
    value: SpeakerFields[K],
  ) => {
    setSpeakers((current) =>
      current.map((speaker, position) => (position === index ? { ...speaker, [field]: value } : speaker)),
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Speakers</h2>
        </CardTitle>
        <CardDescription>
          Add {minimum === maximum ? `${minimum}` : `${minimum}–${maximum}`} speaker{maximum === 1 ? "" : "s"} in
          presentation order. Email addresses must be unique.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {state.errors?.participants ? <FieldError errors={fieldErrors(state, "participants")} /> : null}
          {speakers.map((speaker, index) => (
            <FieldSet key={speaker.key}>
              {index > 0 ? <Separator /> : null}
              <div className="flex items-center justify-between gap-3">
                <FieldLegend>Speaker {index + 1}</FieldLegend>
                <Button
                  aria-label={`Remove speaker ${index + 1}`}
                  disabled={speakers.length <= minimum}
                  onClick={() => setSpeakers((current) => current.filter((_, position) => position !== index))}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Trash2Icon />
                </Button>
              </div>
              <FieldGroup>
                {(["givenName", "familyName", "email"] as const).map((field) => {
                  const name = `speaker.${index}.${field}`;
                  const error = state.errors?.[name]?.[0];
                  const labels = { givenName: "First name", familyName: "Last name", email: "Email" } as const;
                  return (
                    <Field data-invalid={Boolean(error) || undefined} key={field}>
                      <FieldLabel htmlFor={name}>{labels[field]} *</FieldLabel>
                      <Input
                        aria-invalid={Boolean(error) || undefined}
                        id={name}
                        name={name}
                        onChange={(event) => updateSpeaker(index, field, event.target.value)}
                        required
                        type={field === "email" ? "email" : "text"}
                        value={speaker[field]}
                      />
                      <FieldError errors={fieldErrors(state, name)} />
                    </Field>
                  );
                })}
                {requiredFields.has("contact") ? (
                  <Field data-invalid={Boolean(state.errors?.[`speaker.${index}.phone`]) || undefined}>
                    <FieldLabel htmlFor={`speaker.${index}.phone`}>Phone *</FieldLabel>
                    <Input
                      aria-invalid={Boolean(state.errors?.[`speaker.${index}.phone`]) || undefined}
                      id={`speaker.${index}.phone`}
                      name={`speaker.${index}.phone`}
                      onChange={(event) => updateSpeaker(index, "phone", event.target.value)}
                      required
                      type="tel"
                      value={speaker.phone}
                    />
                    <FieldError errors={fieldErrors(state, `speaker.${index}.phone`)} />
                  </Field>
                ) : null}
                {requiredFields.has("biography") ? (
                  <Field data-invalid={Boolean(state.errors?.[`speaker.${index}.biography`]) || undefined}>
                    <FieldLabel htmlFor={`speaker.${index}.biography`}>Biography *</FieldLabel>
                    <Textarea
                      aria-invalid={Boolean(state.errors?.[`speaker.${index}.biography`]) || undefined}
                      id={`speaker.${index}.biography`}
                      name={`speaker.${index}.biography`}
                      onChange={(event) => updateSpeaker(index, "biography", event.target.value)}
                      required
                      value={speaker.biography}
                    />
                    <FieldError errors={fieldErrors(state, `speaker.${index}.biography`)} />
                  </Field>
                ) : null}
                {requiredFields.has("consent") ? (
                  <Field
                    data-invalid={Boolean(state.errors?.[`speaker.${index}.consent`]) || undefined}
                    orientation="horizontal"
                  >
                    <Checkbox
                      aria-invalid={Boolean(state.errors?.[`speaker.${index}.consent`]) || undefined}
                      checked={speaker.consent}
                      id={`speaker.${index}.consent`}
                      name={`speaker.${index}.consent`}
                      onCheckedChange={(checked) => updateSpeaker(index, "consent", checked === true)}
                      required
                    />
                    <div>
                      <FieldLabel htmlFor={`speaker.${index}.consent`}>Speaker profile consent *</FieldLabel>
                      <FieldDescription>
                        I consent to the event storing this profile, contacting me, and publishing approved speaker
                        details.
                      </FieldDescription>
                      <FieldError errors={fieldErrors(state, `speaker.${index}.consent`)} />
                    </div>
                  </Field>
                ) : null}
              </FieldGroup>
            </FieldSet>
          ))}
          <Button
            className="self-start"
            disabled={speakers.length >= maximum}
            onClick={() => {
              const key = nextKey.current;
              nextKey.current += 1;
              setSpeakers((current) => [...current, emptySpeaker(key)]);
            }}
            type="button"
            variant="outline"
          >
            <PlusIcon data-icon="inline-start" />
            Add speaker
          </Button>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
