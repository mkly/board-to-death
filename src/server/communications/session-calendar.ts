import ical, { ICalAttendeeRole, ICalAttendeeStatus, ICalCalendarMethod, ICalEventStatus } from "ical-generator";

import type { EmailAttachment, EmailMessage } from "../infrastructure/index.ts";

const calendarProductId = {
  company: "GatherPulse",
  product: "Session Communications",
  language: "EN",
} as const;

export interface SessionCalendarOrganizer {
  readonly email: string;
  readonly name: string;
}

export interface SessionCalendarAttendee {
  readonly email: string;
  readonly name?: string;
}

export interface SessionCalendarEvent {
  readonly eventId: string;
  readonly eventName: string;
  readonly eventTimezone: string;
  readonly sessionId: string;
  readonly sessionVersionNumber: number;
  readonly placementVersion: number;
  readonly title: string;
  readonly description?: string | null;
  readonly location?: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface SessionCalendarInput {
  readonly action: "request" | "cancel";
  readonly event: SessionCalendarEvent;
  readonly organizer: SessionCalendarOrganizer;
  readonly attendees: readonly SessionCalendarAttendee[];
  readonly sentAt: Date;
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new TypeError(`${field} is required.`);
  return normalized;
}

function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${field} must be a positive integer.`);
  return value;
}

function requireDate(value: Date, field: string): Date {
  const normalized = new Date(value);
  if (!Number.isFinite(normalized.getTime())) throw new TypeError(`${field} must be a valid date.`);
  return normalized;
}

function requireTimezone(value: string): string {
  const timezone = requireText(value, "eventTimezone");
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    throw new TypeError("eventTimezone must be a valid IANA time-zone identifier.");
  }
  return timezone;
}

function normalizeEmail(value: string, field: string): string {
  const email = requireText(value, field).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new TypeError(`${field} must be a valid email address.`);
  return email;
}

function calendarUid(event: SessionCalendarEvent): string {
  return `${requireText(event.sessionId, "sessionId")}.${requireText(event.eventId, "eventId")}@gatherpulse`;
}

function calendarSequence(input: SessionCalendarInput): number {
  const sessionVersion = requirePositiveInteger(input.event.sessionVersionNumber, "sessionVersionNumber");
  const placementVersion = requirePositiveInteger(input.event.placementVersion, "placementVersion");
  return sessionVersion + placementVersion - 2 + (input.action === "cancel" ? 1 : 0);
}

export function createSessionCalendarAttachment(input: SessionCalendarInput): EmailAttachment {
  requireTimezone(input.event.eventTimezone);
  const startsAt = requireDate(input.event.startsAt, "startsAt");
  const endsAt = requireDate(input.event.endsAt, "endsAt");
  const sentAt = requireDate(input.sentAt, "sentAt");
  if (startsAt >= endsAt) throw new TypeError("startsAt must be earlier than endsAt.");
  if (input.attendees.length === 0) throw new TypeError("At least one attendee is required.");

  const method = input.action === "cancel" ? ICalCalendarMethod.CANCEL : ICalCalendarMethod.REQUEST;
  const calendar = ical({ method, name: requireText(input.event.eventName, "eventName"), prodId: calendarProductId });
  calendar.createEvent({
    id: calendarUid(input.event),
    sequence: calendarSequence(input),
    start: startsAt,
    end: endsAt,
    stamp: sentAt,
    lastModified: sentAt,
    summary: requireText(input.event.title, "title"),
    description: input.event.description?.trim() || null,
    location: input.event.location?.trim() || null,
    organizer: {
      email: normalizeEmail(input.organizer.email, "organizer.email"),
      name: requireText(input.organizer.name, "organizer.name"),
    },
    attendees: input.attendees.map((attendee, index) => ({
      email: normalizeEmail(attendee.email, `attendees[${index}].email`),
      name: attendee.name?.trim() || null,
      role: ICalAttendeeRole.REQ,
      rsvp: input.action !== "cancel",
      status: ICalAttendeeStatus.NEEDSACTION,
    })),
    status: input.action === "cancel" ? ICalEventStatus.CANCELLED : ICalEventStatus.CONFIRMED,
  });

  return {
    filename: `session-${requireText(input.event.sessionId, "sessionId")}.ics`,
    contentType: `text/calendar; charset=utf-8; method=${method}`,
    content: calendar.toString(),
    disposition: "attachment",
  };
}

export function attachSessionCalendar(message: EmailMessage, input: SessionCalendarInput): EmailMessage {
  return {
    ...message,
    attachments: [...(message.attachments ?? []), createSessionCalendarAttachment(input)],
  };
}
