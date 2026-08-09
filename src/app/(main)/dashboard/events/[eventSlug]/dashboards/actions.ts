"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { z } from "zod";

import { CustomDashboardTemplate, DashboardWidgetDataSource } from "@/generated/prisma/client";
import { isAllowedAdminEmail } from "@/server/auth/admin-access";
import { auth } from "@/server/auth/auth";
import { CustomDashboardRepository } from "@/server/dashboard/custom-dashboards";
import { getDatabaseClient } from "@/server/database/client";
import { RepositoryError } from "@/server/events/repositories";

export interface DashboardMutationState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
  readonly dashboardId?: string;
  readonly errors?: Readonly<Record<string, readonly string[]>>;
}

const mutationSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("create"),
    eventSlug: z.string().trim().min(1),
    name: z.string().trim().min(1, "Enter a dashboard name.").max(100, "Keep the name under 100 characters."),
    template: z.enum(CustomDashboardTemplate),
  }),
  z.object({
    intent: z.literal("rename"),
    eventSlug: z.string().trim().min(1),
    dashboardId: z.uuid(),
    name: z.string().trim().min(1, "Enter a dashboard name.").max(100, "Keep the name under 100 characters."),
  }),
  z.object({
    intent: z.literal("filter"),
    eventSlug: z.string().trim().min(1),
    dashboardId: z.uuid(),
    trackId: z.union([z.literal("all"), z.uuid()]),
  }),
  z.object({
    intent: z.literal("add-widget"),
    eventSlug: z.string().trim().min(1),
    dashboardId: z.uuid(),
    dataSource: z.enum(DashboardWidgetDataSource),
  }),
  z.object({
    intent: z.literal("configure-widget"),
    eventSlug: z.string().trim().min(1),
    dashboardId: z.uuid(),
    widgetId: z.uuid(),
    title: z.string().trim().min(1, "Enter a widget title.").max(100, "Keep the title under 100 characters."),
    width: z.enum(["compact", "wide"]),
  }),
  z.object({
    intent: z.literal("move-widget"),
    eventSlug: z.string().trim().min(1),
    dashboardId: z.uuid(),
    widgetId: z.uuid(),
    direction: z.enum(["up", "down"]),
  }),
  z.object({
    intent: z.literal("remove-widget"),
    eventSlug: z.string().trim().min(1),
    dashboardId: z.uuid(),
    widgetId: z.uuid(),
  }),
  z.object({
    intent: z.literal("delete"),
    eventSlug: z.string().trim().min(1),
    dashboardId: z.uuid(),
  }),
]);

function formObject(formData: FormData): Record<string, string> {
  return Object.fromEntries(
    [...formData.entries()].flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])),
  );
}

function validationErrors(error: z.ZodError): Readonly<Record<string, readonly string[]>> {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    errors[field] = [...(errors[field] ?? []), issue.message];
  }
  return errors;
}

async function authorizedEvent(eventSlug: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAllowedAdminEmail(session.user.email)) return null;
  return getDatabaseClient().event.findUnique({ where: { slug: eventSlug }, select: { id: true, slug: true } });
}

function repositoryMessage(error: RepositoryError): string {
  if (error.code === "not-found") return "This dashboard, widget, or filter is not available for the event.";
  return error.message;
}

export async function mutateDashboard(
  _previousState: DashboardMutationState,
  formData: FormData,
): Promise<DashboardMutationState> {
  const parsed = mutationSchema.safeParse(formObject(formData));
  if (!parsed.success) {
    return {
      status: "error",
      message: "Review the highlighted dashboard fields.",
      errors: validationErrors(parsed.error),
    };
  }

  const event = await authorizedEvent(parsed.data.eventSlug);
  if (!event) return { status: "error", message: "This event is not available." };
  const repository = new CustomDashboardRepository(getDatabaseClient());

  try {
    let dashboardId = "dashboardId" in parsed.data ? parsed.data.dashboardId : undefined;
    switch (parsed.data.intent) {
      case "create": {
        const dashboard = await repository.create(event.id, {
          name: parsed.data.name,
          template: parsed.data.template,
        });
        dashboardId = dashboard.id;
        break;
      }
      case "rename":
        await repository.rename(event.id, parsed.data.dashboardId, parsed.data.name);
        break;
      case "filter":
        await repository.setFilters(event.id, parsed.data.dashboardId, {
          trackId: parsed.data.trackId === "all" ? undefined : parsed.data.trackId,
        });
        break;
      case "add-widget":
        await repository.addWidget(event.id, parsed.data.dashboardId, parsed.data.dataSource);
        break;
      case "configure-widget":
        await repository.configureWidget(event.id, parsed.data.dashboardId, parsed.data.widgetId, {
          title: parsed.data.title,
          width: parsed.data.width,
        });
        break;
      case "move-widget":
        await repository.moveWidget(event.id, parsed.data.dashboardId, parsed.data.widgetId, parsed.data.direction);
        break;
      case "remove-widget":
        await repository.removeWidget(event.id, parsed.data.dashboardId, parsed.data.widgetId);
        break;
      case "delete":
        await repository.delete(event.id, parsed.data.dashboardId);
        break;
    }
    revalidatePath(`/dashboard/events/${event.slug}/dashboards`);
    return { status: "success", message: "Dashboard changes saved.", dashboardId };
  } catch (error) {
    if (error instanceof RepositoryError) return { status: "error", message: repositoryMessage(error) };
    throw error;
  }
}
