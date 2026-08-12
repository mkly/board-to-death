"use client";

import { useActionState, useState, useTransition } from "react";

import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from "lucide-react";

import { DerivedIdentifierFields } from "@/components/derived-identifier-fields";
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
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  CustomFieldEntityType,
  type CustomFieldEntityType as CustomFieldEntityTypeValue,
  CustomFieldType,
  type CustomFieldType as CustomFieldTypeValue,
} from "@/lib/custom-fields";

import {
  type CustomFieldActionState,
  createCustomField,
  deleteCustomField,
  moveCustomField,
  updateCustomField,
} from "../actions";

export interface EditableCustomField {
  readonly id: string;
  readonly entityType: CustomFieldEntityTypeValue;
  readonly key: string;
  readonly label: string;
  readonly description: string | null;
  readonly type: CustomFieldTypeValue;
  readonly required: boolean;
  readonly characterLimit: number | null;
  readonly options: readonly string[];
}

interface CustomFieldWorkspaceProps {
  readonly event: { readonly name: string; readonly slug: string };
  readonly definitions: readonly EditableCustomField[];
}

const INITIAL_STATE: CustomFieldActionState = { status: "idle" };

const entityLabels: Readonly<Record<CustomFieldEntityTypeValue, string>> = {
  CONTACT: "Contacts",
  PROGRAM_SESSION: "Sessions",
  CONTACT_GROUP: "Groups",
  CFP_SUBMISSION: "Submissions",
};

const typeLabels: Readonly<Record<CustomFieldTypeValue, string>> = {
  SINGLE_LINE_TEXT: "Single-line text",
  LONG_TEXT: "Long text",
  NUMBER: "Number",
  DATE: "Date",
  SINGLE_SELECT: "Single select",
  MULTI_SELECT: "Multi select",
  CHECKBOX: "Checkbox",
  URL: "URL",
  FILE: "File",
};

function supportsOptions(type: CustomFieldTypeValue) {
  return type === CustomFieldType.SINGLE_SELECT || type === CustomFieldType.MULTI_SELECT;
}

function supportsLimit(type: CustomFieldTypeValue) {
  return (
    type === CustomFieldType.SINGLE_LINE_TEXT || type === CustomFieldType.LONG_TEXT || type === CustomFieldType.URL
  );
}

function FieldTypeSelect({
  value,
  onValueChange,
}: {
  readonly value: CustomFieldTypeValue;
  readonly onValueChange: (value: CustomFieldTypeValue) => void;
}) {
  return (
    <Select name="type" value={value} onValueChange={(next) => onValueChange(next as CustomFieldTypeValue)}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        <SelectGroup>
          {Object.values(CustomFieldType).map((type) => (
            <SelectItem key={type} value={type}>
              {typeLabels[type]}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function DefinitionFields({ definition }: { readonly definition?: EditableCustomField }) {
  const [type, setType] = useState(definition?.type ?? CustomFieldType.SINGLE_LINE_TEXT);
  return (
    <FieldGroup>
      <div className="grid gap-4 sm:grid-cols-2">
        <DerivedIdentifierFields
          identifierDescription="Stable key used by filters and exports."
          identifierId={`custom-field-key-${definition?.id ?? "new"}`}
          identifierInitialValue={definition?.key}
          identifierLabel="API key"
          identifierName="key"
          identifierPlaceholder="dietary_requirements"
          separator="_"
          sourceId={`custom-field-label-${definition?.id ?? "new"}`}
          sourceInitialValue={definition?.label}
          sourceLabel="Label"
          sourceMaxLength={120}
          sourceName="label"
        />
      </div>
      <Field>
        <FieldLabel>Description</FieldLabel>
        <Input name="description" defaultValue={definition?.description ?? ""} maxLength={500} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel>Field type</FieldLabel>
          <FieldTypeSelect value={type} onValueChange={setType} />
        </Field>
        {supportsLimit(type) ? (
          <Field>
            <FieldLabel>Character limit</FieldLabel>
            <Input
              name="characterLimit"
              type="number"
              min={1}
              max={100000}
              defaultValue={definition?.characterLimit ?? ""}
            />
          </Field>
        ) : null}
      </div>
      {supportsOptions(type) ? (
        <Field>
          <FieldLabel>Options</FieldLabel>
          <Textarea
            name="options"
            defaultValue={definition?.options.join("\n")}
            placeholder={"Beginner\nIntermediate\nAdvanced"}
            required
          />
          <FieldDescription>Enter one unique option per line.</FieldDescription>
        </Field>
      ) : null}
      <Field orientation="horizontal">
        <Checkbox id={`required-${definition?.id ?? "new"}`} name="required" defaultChecked={definition?.required} />
        <FieldLabel htmlFor={`required-${definition?.id ?? "new"}`}>Require a value</FieldLabel>
      </Field>
    </FieldGroup>
  );
}

function ExistingField({
  eventSlug,
  definition,
  index,
  count,
  orderedIds,
}: {
  readonly eventSlug: string;
  readonly definition: EditableCustomField;
  readonly index: number;
  readonly count: number;
  readonly orderedIds: readonly string[];
}) {
  const [state, action, pending] = useActionState(
    updateCustomField.bind(null, eventSlug, definition.id),
    INITIAL_STATE,
  );
  const [mutationMessage, setMutationMessage] = useState("");
  const [mutating, startMutation] = useTransition();
  const move = (offset: -1 | 1) => {
    const next = [...orderedIds];
    const destination = index + offset;
    [next[index], next[destination]] = [next[destination], next[index]];
    startMutation(async () => {
      const result = await moveCustomField(eventSlug, definition.entityType, next);
      setMutationMessage(result.message ?? "");
    });
  };
  const remove = () => {
    startMutation(async () => {
      const result = await deleteCustomField(eventSlug, definition.id);
      setMutationMessage(result.message ?? "");
    });
  };
  return (
    <form noValidate action={action}>
      <Card>
        <CardHeader>
          <CardTitle>{definition.label}</CardTitle>
          <CardDescription>{typeLabels[definition.type]}</CardDescription>
          <CardAction className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Move ${definition.label} up`}
              disabled={index === 0 || mutating}
              onClick={() => move(-1)}
            >
              <ArrowUp />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Move ${definition.label} down`}
              disabled={index === count - 1 || mutating}
              onClick={() => move(1)}
            >
              <ArrowDown />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <DefinitionFields definition={definition} />
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <p className="text-muted-foreground text-sm" aria-live="polite">
            {state.message ?? mutationMessage}
          </p>
          <div className="flex gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="outline" disabled={mutating}>
                  <Trash2 data-icon="inline-start" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {definition.label}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Deletion is blocked when any record still has a saved value, preventing silent data loss.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={remove}>
                    Delete field
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button type="submit" disabled={pending || mutating}>
              {pending ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
              Save
            </Button>
          </div>
        </CardFooter>
      </Card>
    </form>
  );
}

function EntityFields({
  eventSlug,
  entityType,
  definitions,
}: {
  readonly eventSlug: string;
  readonly entityType: CustomFieldEntityTypeValue;
  readonly definitions: readonly EditableCustomField[];
}) {
  const [state, action, pending] = useActionState(createCustomField.bind(null, eventSlug), INITIAL_STATE);
  const orderedIds = definitions.map(({ id }) => id);
  return (
    <div className="flex flex-col gap-5">
      {definitions.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No {entityLabels[entityType].toLocaleLowerCase()} fields</EmptyTitle>
            <EmptyDescription>Create the first field for this record type below.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        definitions.map((definition, index) => (
          <ExistingField
            key={definition.id}
            eventSlug={eventSlug}
            definition={definition}
            index={index}
            count={definitions.length}
            orderedIds={orderedIds}
          />
        ))
      )}
      <form noValidate action={action}>
        <input type="hidden" name="entityType" value={entityType} />
        <Card>
          <CardHeader>
            <CardTitle>New {entityLabels[entityType].toLocaleLowerCase()} field</CardTitle>
            <CardDescription>Fields are event-scoped and appear in the order shown here.</CardDescription>
            <CardAction>
              <Badge variant="outline">{definitions.length + 1}</Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <DefinitionFields />
          </CardContent>
          <CardFooter className="justify-between gap-3">
            <p className="text-muted-foreground text-sm" aria-live="polite">
              {state.message}
            </p>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
              Add field
            </Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}

export function CustomFieldWorkspace({ event, definitions }: CustomFieldWorkspaceProps) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-muted-foreground text-sm">{event.name}</p>
        <h1 className="font-heading font-semibold text-2xl tracking-tight">Custom fields</h1>
        <p className="text-muted-foreground text-sm">
          Extend contacts, sessions, groups, and submissions with event-specific data.
        </p>
      </header>
      <Tabs defaultValue={CustomFieldEntityType.CONTACT}>
        <TabsList variant="line" className="max-w-full overflow-x-auto">
          {Object.values(CustomFieldEntityType).map((entityType) => (
            <TabsTrigger key={entityType} value={entityType}>
              {entityLabels[entityType]}
            </TabsTrigger>
          ))}
        </TabsList>
        {Object.values(CustomFieldEntityType).map((entityType) => (
          <TabsContent key={entityType} value={entityType}>
            <EntityFields
              eventSlug={event.slug}
              entityType={entityType}
              definitions={definitions.filter((field) => field.entityType === entityType)}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
