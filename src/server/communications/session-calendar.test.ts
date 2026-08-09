import ICAL from "ical.js";
import { describe, expect, test } from "vitest";

import { attachSessionCalendar, createSessionCalendarAttachment, type SessionCalendarInput } from "./session-calendar";

const baseInput: SessionCalendarInput = {
  action: "request",
  event: {
    eventId: "50b4b1ae-ff11-4615-b461-c4343be643f6",
    eventName: "Board to Death 2027",
    eventTimezone: "America/Los_Angeles",
    sessionId: "0cf4edab-c37b-4355-a9ba-7bd58da56f3e",
    sessionVersionNumber: 1,
    placementVersion: 1,
    title: "Design, Delivery; and the Backslash \\ Test",
    description: `${"A long session description, with punctuation; and escaped \\ content. ".repeat(3)}\nSecond line.`,
    location: "Pacific Room, Floor 2",
    startsAt: new Date("2027-03-14T09:30:00.000Z"),
    endsAt: new Date("2027-03-14T10:30:00.000Z"),
  },
  organizer: { email: "Program@Example.test", name: "Program Team" },
  attendees: [
    { email: "Ada@Example.test", name: "Ada Lovelace" },
    { email: "grace@example.test", name: "Grace Hopper" },
  ],
  sentAt: new Date("2027-02-01T17:00:00.000Z"),
};

function parseAttachment(input: SessionCalendarInput) {
  const attachment = createSessionCalendarAttachment(input);
  const calendar = new ICAL.Component(ICAL.parse(attachment.content));
  const component = calendar.getFirstSubcomponent("vevent");
  if (!component) throw new Error("Expected one VEVENT component.");
  return { attachment, calendar, component, event: new ICAL.Event(component) };
}

function localParts(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")} ${value("hour")}:${value("minute")}`;
}

describe("session calendar invitations", () => {
  test("emits parser-valid request fields used by Gmail, Outlook, and Apple Calendar", () => {
    const { attachment, calendar, component, event } = parseAttachment(baseInput);

    expect(attachment.filename).toBe(`session-${baseInput.event.sessionId}.ics`);
    expect(attachment.contentType).toBe("text/calendar; charset=utf-8; method=REQUEST");
    expect(calendar.getFirstPropertyValue("method")).toBe("REQUEST");
    expect(event.uid).toBe(`${baseInput.event.sessionId}.${baseInput.event.eventId}@board-to-death`);
    expect(event.sequence).toBe(0);
    expect(component.getFirstPropertyValue("status")).toBe("CONFIRMED");
    expect(event.summary).toBe(baseInput.event.title);
    expect(event.description).toBe(baseInput.event.description);
    expect(event.location).toBe(baseInput.event.location);
    expect(component.getFirstProperty("organizer")?.getFirstValue()).toBe("mailto:program@example.test");
    expect(component.getAllProperties("attendee")).toHaveLength(2);
    expect(component.getAllProperties("attendee")[0]?.getParameter("role")).toBe("REQ-PARTICIPANT");
    expect(component.getAllProperties("attendee")[0]?.getParameter("rsvp")).toBe("TRUE");
    expect(component.getAllProperties("attendee")[0]?.getParameter("partstat")).toBe("NEEDS-ACTION");
    expect(attachment.content).toContain("\r\n ");
  });

  test("keeps UTC instants while rendering the event's local time correctly across daylight saving", () => {
    const { component, event } = parseAttachment(baseInput);

    expect(component.getFirstProperty("dtstart")?.getParameter("tzid")).toBeUndefined();
    expect(component.getFirstProperty("dtend")?.getParameter("tzid")).toBeUndefined();
    expect(event.startDate.toJSDate().toISOString()).toBe("2027-03-14T09:30:00.000Z");
    expect(event.endDate.toJSDate().toISOString()).toBe("2027-03-14T10:30:00.000Z");
    expect(localParts(event.startDate.toJSDate(), baseInput.event.eventTimezone)).toBe("2027-03-14 01:30");
    expect(localParts(event.endDate.toJSDate(), baseInput.event.eventTimezone)).toBe("2027-03-14 03:30");
  });

  test("correlates updates and cancellations with a stable UID and increasing sequence", () => {
    const initial = parseAttachment(baseInput);
    const update = parseAttachment({
      ...baseInput,
      event: { ...baseInput.event, sessionVersionNumber: 2, title: "Updated session title" },
    });
    const cancellation = parseAttachment({
      ...baseInput,
      action: "cancel",
      event: { ...baseInput.event, sessionVersionNumber: 2 },
    });

    expect(update.event.uid).toBe(initial.event.uid);
    expect(cancellation.event.uid).toBe(initial.event.uid);
    expect([initial.event.sequence, update.event.sequence, cancellation.event.sequence]).toEqual([0, 1, 2]);
    expect(cancellation.calendar.getFirstPropertyValue("method")).toBe("CANCEL");
    expect(cancellation.component.getFirstPropertyValue("status")).toBe("CANCELLED");
    expect(cancellation.attachment.contentType).toContain("method=CANCEL");
  });

  test("attaches the generated invite without replacing existing email attachments", () => {
    const message = attachSessionCalendar(
      {
        to: [{ address: "ada@example.test", name: "Ada Lovelace" }],
        subject: "Your accepted session",
        text: "Your session has been scheduled.",
        attachments: [
          {
            filename: "speaker-guide.pdf",
            contentType: "application/pdf",
            content: "guide",
          },
        ],
      },
      baseInput,
    );

    expect(message.attachments?.map(({ filename }) => filename)).toEqual([
      "speaker-guide.pdf",
      `session-${baseInput.event.sessionId}.ics`,
    ]);
  });

  test("rejects host-dependent or inconsistent calendar input", () => {
    expect(() =>
      createSessionCalendarAttachment({
        ...baseInput,
        event: { ...baseInput.event, eventTimezone: "local-server-time" },
      }),
    ).toThrow("eventTimezone must be a valid IANA time-zone identifier");
    expect(() =>
      createSessionCalendarAttachment({
        ...baseInput,
        event: { ...baseInput.event, endsAt: baseInput.event.startsAt },
      }),
    ).toThrow("startsAt must be earlier than endsAt");
  });
});
