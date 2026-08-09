"use client";

import { useActionState, useMemo, useRef, useState } from "react";

import { Plus, Save, Trash2 } from "lucide-react";

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
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { type CfpFormDefinition, type CfpVisibilityRule, validateCfpPolicyCategoryRouting } from "@/lib/cfp";

import { type SaveCfpCategoryRoutingState, saveCfpCategoryRouting } from "../actions";
import { CfpVisibilityRuleEditor, initialCondition, type VisibilitySourceQuestion } from "./cfp-visibility-rule-editor";

export interface CfpCategoryOption {
  readonly id: string;
  readonly label: string;
}

interface CfpPolicyCategoryRoute {
  readonly categoryId: string;
  readonly condition: CfpVisibilityRule;
}

interface DraftRoute extends CfpPolicyCategoryRoute {
  readonly editorId: string;
}

interface CfpCategoryRoutingProps {
  readonly eventSlug: string;
  readonly formId: string;
  readonly definition: CfpFormDefinition;
  readonly categories: readonly CfpCategoryOption[];
  readonly initialRouting: readonly CfpPolicyCategoryRoute[];
}

const INITIAL_STATE: SaveCfpCategoryRoutingState = { status: "idle" };

function sourceQuestions(definition: CfpFormDefinition): VisibilitySourceQuestion[] {
  return definition.sections.flatMap((section) =>
    section.questions.map((question) => ({
      editorId: question.id,
      originalId: question.id,
      id: question.id,
      type: question.type,
      label: question.label,
      constraints: question.constraints,
    })),
  );
}

function toDraftRoute(route: CfpPolicyCategoryRoute, editorId: string): DraftRoute {
  return { editorId, categoryId: route.categoryId, condition: route.condition };
}

export function CfpCategoryRouting({
  eventSlug,
  formId,
  definition,
  categories,
  initialRouting,
}: CfpCategoryRoutingProps) {
  const [routes, setRoutes] = useState<DraftRoute[]>(() =>
    initialRouting.map((route, index) => toDraftRoute(route, `initial-${index}`)),
  );
  const nextEditorId = useRef(1);
  const [state, formAction, pending] = useActionState(saveCfpCategoryRouting, INITIAL_STATE);
  const sources = useMemo(() => sourceQuestions(definition), [definition]);
  const categoryIds = useMemo(() => new Set(categories.map((category) => category.id)), [categories]);
  const draftRouting = useMemo<CfpPolicyCategoryRoute[]>(
    () => routes.map(({ categoryId, condition }) => ({ categoryId, condition })),
    [routes],
  );
  const localErrors = useMemo(
    () => validateCfpPolicyCategoryRouting(draftRouting, definition, categoryIds),
    [draftRouting, definition, categoryIds],
  );

  const updateRoute = (editorId: string, update: Partial<Omit<DraftRoute, "editorId">>) => {
    setRoutes((current) => current.map((route) => (route.editorId === editorId ? { ...route, ...update } : route)));
  };

  const addRoute = () => {
    const source = sources[0];
    if (!source) return;
    const editorId = `new-${nextEditorId.current}`;
    nextEditorId.current += 1;
    const usedCategoryIds = new Set(routes.map((route) => route.categoryId));
    const category = categories.find((candidate) => !usedCategoryIds.has(candidate.id)) ?? categories[0];
    if (!category) return;
    setRoutes((current) => [
      ...current,
      { editorId, categoryId: category.id, condition: { logic: "all", conditions: [initialCondition(source)] } },
    ]);
  };

  const removeRoute = (editorId: string) => {
    setRoutes((current) => current.filter((route) => route.editorId !== editorId));
  };

  const canAddRoute = sources.length > 0 && categories.length > 0;

  return (
    <form action={formAction}>
      <input type="hidden" name="eventSlug" value={eventSlug} />
      <input type="hidden" name="formId" value={formId} />
      <input type="hidden" name="routing" value={JSON.stringify(draftRouting)} />
      <Card>
        <CardHeader>
          <CardTitle>Category routing</CardTitle>
          <CardDescription>
            Route matching submissions to a category owned by this event based on applicant answers.
          </CardDescription>
          <CardAction>
            <Button type="button" size="sm" variant="outline" disabled={!canAddRoute} onClick={addRoute}>
              <Plus data-icon="inline-start" />
              Add route
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {categories.length === 0 && (
            <Empty className="py-8">
              <EmptyHeader>
                <EmptyTitle>No categories yet</EmptyTitle>
                <EmptyDescription>Create a category for this event before configuring routing.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {categories.length > 0 && routes.length === 0 && (
            <Empty className="py-8">
              <EmptyHeader>
                <EmptyTitle>No routes configured</EmptyTitle>
                <EmptyDescription>
                  Add a route to automatically assign a category when applicant answers match a rule.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {categories.length > 0 && routes.length > 0 && (
            <div className="flex flex-col gap-4">
              {routes.map((route, routeIndex) => {
                const idPrefix = `category-route-${route.editorId}`;
                return (
                  <Card key={route.editorId} size="sm">
                    <CardHeader>
                      <CardTitle>Route {routeIndex + 1}</CardTitle>
                      <CardDescription>Choose the category applied when the rule below matches.</CardDescription>
                      <CardAction>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Remove route ${routeIndex + 1}`}
                            >
                              <Trash2 />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove this route?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Submissions will no longer be routed to a category by this rule.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction variant="destructive" onClick={() => removeRoute(route.editorId)}>
                                Remove route
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </CardAction>
                    </CardHeader>
                    <CardContent>
                      <Field>
                        <FieldLabel htmlFor={`${idPrefix}-category`}>Target category</FieldLabel>
                        <Select
                          value={route.categoryId}
                          onValueChange={(categoryId) => updateRoute(route.editorId, { categoryId })}
                        >
                          <SelectTrigger id={`${idPrefix}-category`} className="w-full">
                            <SelectValue placeholder="Choose a category" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {categories.map((category) => (
                                <SelectItem key={category.id} value={category.id}>
                                  {category.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>

                      <CfpVisibilityRuleEditor
                        idPrefix={idPrefix}
                        rule={route.condition}
                        sourceQuestions={sources}
                        toggleable={false}
                        onChange={(condition) => {
                          if (condition) updateRoute(route.editorId, { condition });
                        }}
                      />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {localErrors.length > 0 ? (
            <Alert variant="destructive" className="mt-4">
              <AlertTitle>Review category routing</AlertTitle>
              <AlertDescription>
                <ul className="ml-4 flex list-disc flex-col gap-1">
                  {localErrors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          {state.status === "error" ? (
            <Alert variant="destructive" className="mt-4">
              <AlertTitle>Category routing was not saved</AlertTitle>
              <AlertDescription>
                <p>{state.message}</p>
                {state.errors ? (
                  <ul className="ml-4 flex list-disc flex-col gap-1">
                    {state.errors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          {state.status === "success" ? (
            <Alert className="mt-4">
              <AlertTitle>Saved</AlertTitle>
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <p className="text-muted-foreground text-sm">
            The first matching route (in order) determines a submission's category.
          </p>
          <Button type="submit" disabled={pending || localErrors.length > 0}>
            {pending ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
            {pending ? "Saving..." : "Save routing"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
