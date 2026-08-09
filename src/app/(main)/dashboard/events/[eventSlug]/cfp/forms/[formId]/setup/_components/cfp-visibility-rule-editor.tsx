"use client";

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  CFP_CONDITION_OPERATOR_LABELS,
  type CfpCondition,
  type CfpConditionOperator,
  type CfpQuestionConstraints,
  type CfpVisibilityRule,
  conditionOperatorsForQuestion,
} from "@/lib/cfp";

export interface VisibilitySourceQuestion {
  readonly editorId: string;
  readonly originalId: string | null;
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly constraints?: CfpQuestionConstraints;
}

interface CfpVisibilityRuleEditorProps {
  readonly idPrefix: string;
  readonly questionEditorId?: string;
  readonly rule: CfpVisibilityRule | undefined;
  readonly sourceQuestions: readonly VisibilitySourceQuestion[];
  readonly onChange: (rule: CfpVisibilityRule | undefined) => void;
  /** When false, the rule is mandatory: the enable/disable toggle is hidden and the
   * condition editor renders unconditionally. Callers must keep `rule` defined. */
  readonly toggleable?: boolean;
}

function findSource(
  sources: readonly VisibilitySourceQuestion[],
  questionId: string,
): VisibilitySourceQuestion | undefined {
  return sources.find((source) => source.id === questionId || source.originalId === questionId);
}

function initialValue(source: VisibilitySourceQuestion, operator: CfpConditionOperator): unknown {
  if (operator === "is_empty" || operator === "is_not_empty") return undefined;
  if (operator === "in" || operator === "not_in")
    return source.constraints?.options?.[0] ? [source.constraints.options[0].value] : [];
  if (source.type === "checkbox") return true;
  if (source.type === "number") return 0;
  if (source.type === "select") return source.constraints?.options?.[0]?.value ?? "";
  return "";
}

export function initialCondition(source: VisibilitySourceQuestion): CfpCondition {
  const operator = conditionOperatorsForQuestion(source.type)[0] ?? "is_empty";
  return { questionId: source.id, operator, value: initialValue(source, operator) };
}

function comparisonInputType(type: string): "date" | "number" | "text" {
  if (type === "number") return "number";
  if (type === "date") return "date";
  return "text";
}

function withConditionValue(
  condition: CfpCondition,
  source: VisibilitySourceQuestion,
  operator: CfpConditionOperator,
): CfpCondition {
  const value = initialValue(source, operator);
  return value === undefined
    ? { questionId: condition.questionId, operator }
    : { questionId: condition.questionId, operator, value };
}

function ConditionValue({
  condition,
  idPrefix,
  source,
  onChange,
}: {
  readonly condition: CfpCondition;
  readonly idPrefix: string;
  readonly source: VisibilitySourceQuestion;
  readonly onChange: (condition: CfpCondition) => void;
}) {
  if (condition.operator === "is_empty" || condition.operator === "is_not_empty") {
    return <FieldDescription className="sm:col-span-2">This comparison does not need a value.</FieldDescription>;
  }

  if (condition.operator === "in" || condition.operator === "not_in") {
    const selected = Array.isArray(condition.value) ? condition.value : [];
    return (
      <FieldSet className="sm:col-span-2">
        <FieldLegend variant="label">Comparison values</FieldLegend>
        <FieldDescription>Select at least one configured option.</FieldDescription>
        <FieldGroup data-slot="checkbox-group">
          {(source.constraints?.options ?? []).map((option) => (
            <Field key={option.value} orientation="horizontal">
              <Checkbox
                id={`${idPrefix}-value-${option.value}`}
                checked={selected.includes(option.value)}
                onCheckedChange={(checked) =>
                  onChange({
                    ...condition,
                    value: checked ? [...selected, option.value] : selected.filter((value) => value !== option.value),
                  })
                }
              />
              <FieldLabel htmlFor={`${idPrefix}-value-${option.value}`}>{option.label}</FieldLabel>
            </Field>
          ))}
        </FieldGroup>
      </FieldSet>
    );
  }

  if (source.type === "select") {
    return (
      <Field className="sm:col-span-2">
        <FieldLabel htmlFor={`${idPrefix}-value`}>Comparison value</FieldLabel>
        <Select
          value={typeof condition.value === "string" ? condition.value : ""}
          onValueChange={(value) => onChange({ ...condition, value })}
        >
          <SelectTrigger id={`${idPrefix}-value`} className="w-full">
            <SelectValue placeholder="Choose an option" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {(source.constraints?.options ?? []).map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
    );
  }

  if (source.type === "checkbox") {
    return (
      <Field className="sm:col-span-2">
        <FieldLabel htmlFor={`${idPrefix}-value`}>Comparison value</FieldLabel>
        <Select
          value={condition.value === false ? "false" : "true"}
          onValueChange={(value) => onChange({ ...condition, value: value === "true" })}
        >
          <SelectTrigger id={`${idPrefix}-value`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="true">Checked</SelectItem>
              <SelectItem value="false">Not checked</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
    );
  }

  return (
    <Field className="sm:col-span-2">
      <FieldLabel htmlFor={`${idPrefix}-value`}>Comparison value</FieldLabel>
      <Input
        id={`${idPrefix}-value`}
        type={comparisonInputType(source.type)}
        value={typeof condition.value === "number" || typeof condition.value === "string" ? condition.value : ""}
        onChange={(event) =>
          onChange({
            ...condition,
            value: source.type === "number" ? Number(event.target.value) : event.target.value,
          })
        }
        required
      />
    </Field>
  );
}

export function CfpVisibilityRuleEditor({
  idPrefix,
  questionEditorId,
  rule,
  sourceQuestions,
  onChange,
  toggleable = true,
}: CfpVisibilityRuleEditorProps) {
  const sources = sourceQuestions.filter(
    (source) => source.editorId !== questionEditorId && source.id.trim() !== "" && source.type.trim() !== "",
  );
  const enableRule = (enabled: boolean) => {
    if (!enabled) {
      onChange(undefined);
      return;
    }
    const source = sources[0];
    if (source) onChange({ logic: "all", conditions: [initialCondition(source)] });
  };
  const updateCondition = (index: number, condition: CfpCondition) => {
    if (!rule) return;
    onChange({ ...rule, conditions: rule.conditions.map((current, i) => (i === index ? condition : current)) });
  };

  return (
    <FieldGroup className="sm:col-span-2">
      {toggleable ? (
        <Field orientation="horizontal" data-disabled={(sources.length === 0 && !rule) || undefined}>
          <div className="flex flex-col gap-1">
            <FieldTitle id={`${idPrefix}-visibility-label`}>Conditional visibility</FieldTitle>
            <FieldDescription>Show this question only when applicant answers match the rule.</FieldDescription>
          </div>
          <Switch
            aria-labelledby={`${idPrefix}-visibility-label`}
            checked={Boolean(rule)}
            disabled={sources.length === 0 && !rule}
            onCheckedChange={enableRule}
          />
        </Field>
      ) : null}
      {sources.length === 0 ? <FieldDescription>Add another question before creating a rule.</FieldDescription> : null}
      {rule ? (
        <>
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-logic`}>Match behavior</FieldLabel>
            <Select value={rule.logic} onValueChange={(logic) => onChange({ ...rule, logic: logic as "all" | "any" })}>
              <SelectTrigger id={`${idPrefix}-logic`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">All conditions must match</SelectItem>
                  <SelectItem value="any">Any condition may match</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {rule.conditions.map((condition, conditionIndex) => {
            const source = findSource(sources, condition.questionId);
            const conditionPrefix = `${idPrefix}-condition-${conditionIndex}`;
            return (
              <Card key={conditionPrefix} size="sm">
                <CardHeader>
                  <CardTitle>Condition {conditionIndex + 1}</CardTitle>
                  <CardDescription>Compare an answer from another question.</CardDescription>
                  <CardAction>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove condition ${conditionIndex + 1}`}
                      disabled={rule.conditions.length === 1}
                      onClick={() =>
                        onChange({
                          ...rule,
                          conditions: rule.conditions.filter((_, index) => index !== conditionIndex),
                        })
                      }
                    >
                      <Trash2 />
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <FieldGroup className="sm:grid sm:grid-cols-2">
                    <Field data-invalid={!source || undefined}>
                      <FieldLabel htmlFor={`${conditionPrefix}-source`}>Source question</FieldLabel>
                      <Select
                        value={source?.id ?? ""}
                        onValueChange={(questionId) => {
                          const nextSource = sources.find((candidate) => candidate.id === questionId);
                          if (nextSource) updateCondition(conditionIndex, initialCondition(nextSource));
                        }}
                      >
                        <SelectTrigger id={`${conditionPrefix}-source`} className="w-full" aria-invalid={!source}>
                          <SelectValue placeholder="Choose a question" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {sources.map((candidate) => (
                              <SelectItem key={candidate.editorId} value={candidate.id}>
                                {candidate.label || candidate.id}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field data-invalid={!source || undefined}>
                      <FieldLabel htmlFor={`${conditionPrefix}-operator`}>Comparison</FieldLabel>
                      <Select
                        value={condition.operator}
                        disabled={!source}
                        onValueChange={(operator) => {
                          if (source) {
                            updateCondition(
                              conditionIndex,
                              withConditionValue(condition, source, operator as CfpConditionOperator),
                            );
                          }
                        }}
                      >
                        <SelectTrigger id={`${conditionPrefix}-operator`} className="w-full" aria-invalid={!source}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {(source ? conditionOperatorsForQuestion(source.type) : []).map((operator) => (
                              <SelectItem key={operator} value={operator}>
                                {CFP_CONDITION_OPERATOR_LABELS[operator]}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    {source ? (
                      <ConditionValue
                        condition={condition}
                        idPrefix={conditionPrefix}
                        source={source}
                        onChange={(nextCondition) => updateCondition(conditionIndex, nextCondition)}
                      />
                    ) : (
                      <FieldDescription className="sm:col-span-2">
                        The source question is missing. Choose another source or turn off this rule.
                      </FieldDescription>
                    )}
                  </FieldGroup>
                </CardContent>
              </Card>
            );
          })}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            disabled={sources.length === 0}
            onClick={() => {
              const source = sources[0];
              if (source) onChange({ ...rule, conditions: [...rule.conditions, initialCondition(source)] });
            }}
          >
            <Plus data-icon="inline-start" />
            Add condition
          </Button>
        </>
      ) : null}
    </FieldGroup>
  );
}
