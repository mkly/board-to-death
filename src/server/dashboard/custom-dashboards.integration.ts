import { PrismaPg } from "@prisma/adapter-pg";

import {
  CustomDashboardTemplate,
  DashboardWidgetDataSource,
  EventType,
  PrismaClient,
} from "../../generated/prisma/client.ts";
import { EventRepository, RepositoryError } from "../events/repositories.ts";
import { CustomDashboardRepository, dashboardTemplates } from "./custom-dashboards.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for custom dashboard integration tests.");

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const events = new EventRepository(client);
const repository = new CustomDashboardRepository(client);

async function createEvent(slug: string) {
  return events.create({
    name: slug,
    slug,
    type: EventType.CONFERENCE,
    timezone: "America/Los_Angeles",
    startsAt: new Date("2027-05-10T16:00:00.000Z"),
    endsAt: new Date("2027-05-12T00:00:00.000Z"),
  });
}

describe("custom dashboards", () => {
  before(async () => {
    await client.$connect();
  });

  beforeEach(async () => {
    await client.event.deleteMany();
  });

  after(async () => {
    await client.$disconnect();
  });

  test("creates every supported template with its allowlisted ordered widget set", async () => {
    const event = await createEvent("dashboard-templates");

    for (const template of dashboardTemplates) {
      const dashboard = await repository.create(event.id, { name: template.label, template: template.id });
      assert.equal(dashboard.template, template.id);
      assert.deepEqual(
        dashboard.widgets.map(({ dataSource, position }) => ({ dataSource, position })),
        template.widgets.map(({ dataSource }, position) => ({ dataSource, position })),
      );
    }

    const dashboards = await repository.list(event.id);
    assert.equal(dashboards.length, dashboardTemplates.length);
    assert.deepEqual(dashboards.at(-1)?.widgets, []);
  });

  test("persists naming, event filters, widget configuration, ordering, removal, and deletion", async () => {
    const event = await createEvent("dashboard-persistence");
    const track = await client.track.create({
      data: { eventId: event.id, name: "Design", color: "neutral", sortOrder: 0 },
    });
    const dashboard = await repository.create(event.id, {
      name: "  Operations  ",
      template: CustomDashboardTemplate.MANUAL,
    });
    assert.equal(dashboard.name, "Operations");

    await repository.rename(event.id, dashboard.id, "Program health");
    await repository.setFilters(event.id, dashboard.id, { trackId: track.id });
    const first = await repository.addWidget(event.id, dashboard.id, DashboardWidgetDataSource.SUBMISSION_TOTAL);
    const second = await repository.addWidget(event.id, dashboard.id, DashboardWidgetDataSource.UNSCHEDULED_SESSIONS);
    await repository.configureWidget(event.id, dashboard.id, second.id, { title: "Schedule gaps", width: "compact" });
    await repository.moveWidget(event.id, dashboard.id, second.id, "up");

    const [reloaded] = await repository.list(event.id);
    assert.equal(reloaded?.name, "Program health");
    assert.deepEqual(reloaded?.filters, { trackId: track.id });
    assert.deepEqual(
      reloaded?.widgets.map(({ id, title, position, settings }) => ({ id, title, position, settings })),
      [
        { id: second.id, title: "Schedule gaps", position: 0, settings: { width: "compact" } },
        { id: first.id, title: "Submissions", position: 1, settings: { width: "compact" } },
      ],
    );

    await repository.removeWidget(event.id, dashboard.id, second.id);
    assert.deepEqual(
      (await repository.list(event.id))[0]?.widgets.map(({ position }) => position),
      [0],
    );
    await repository.delete(event.id, dashboard.id);
    assert.deepEqual(await repository.list(event.id), []);
  });

  test("rejects cross-event dashboard, widget, and track mutations", async () => {
    const event = await createEvent("dashboard-event-a");
    const otherEvent = await createEvent("dashboard-event-b");
    const dashboard = await repository.create(event.id, {
      name: "Event A",
      template: CustomDashboardTemplate.EVENT_OVERVIEW,
    });
    const otherTrack = await client.track.create({
      data: { eventId: otherEvent.id, name: "Other", color: "neutral", sortOrder: 0 },
    });

    await assert.rejects(
      () => repository.rename(otherEvent.id, dashboard.id, "Cross-event"),
      (error: unknown) => error instanceof RepositoryError && error.code === "not-found",
    );
    await assert.rejects(
      () => repository.setFilters(event.id, dashboard.id, { trackId: otherTrack.id }),
      (error: unknown) => error instanceof RepositoryError && error.code === "not-found",
    );
    await assert.rejects(
      () => repository.removeWidget(otherEvent.id, dashboard.id, dashboard.widgets[0]?.id ?? ""),
      (error: unknown) => error instanceof RepositoryError && error.code === "not-found",
    );
    assert.equal((await repository.list(event.id)).length, 1);
    assert.deepEqual(await repository.list(otherEvent.id), []);
  });
});
