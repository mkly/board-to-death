import { describe, expect, it } from "vitest";

import { reminderTimeFromMinute, validateCfpMessageSettings } from "./messages";

const validInput = {
  remindersEnabled: true,
  reminderDaysBeforeClose: "3",
  reminderSendAt: "09:30",
  submissionConfirmation: "We received your proposal for **{{event.name}}**.",
  thankYou: "Thank you, {{recipient.name}}.",
} as const;

describe("CFP message settings", () => {
  it("normalizes safe CFP messages and event-local reminder timing", () => {
    const result = validateCfpMessageSettings(validInput);

    expect(result.fields).toMatchObject({
      remindersEnabled: true,
      reminderDaysBeforeClose: 3,
      reminderSendAtMinute: 570,
    });
    expect(reminderTimeFromMinute(570)).toBe("09:30");
  });

  it("allows disabled reminders without requiring timing fields", () => {
    const result = validateCfpMessageSettings({
      ...validInput,
      remindersEnabled: false,
      reminderDaysBeforeClose: "",
      reminderSendAt: "",
    });

    expect(result.fields).toMatchObject({
      remindersEnabled: false,
      reminderDaysBeforeClose: 3,
      reminderSendAtMinute: 540,
    });
  });

  it("retains the submitted timing when reminders are disabled", () => {
    const result = validateCfpMessageSettings({
      ...validInput,
      remindersEnabled: false,
      reminderDaysBeforeClose: "14",
      reminderSendAt: "07:45",
    });

    expect(result.fields).toMatchObject({
      remindersEnabled: false,
      reminderDaysBeforeClose: 14,
      reminderSendAtMinute: 465,
    });
  });

  it("rejects invalid timing, raw HTML, and variables unavailable to CFP messages", () => {
    const result = validateCfpMessageSettings({
      ...validInput,
      reminderDaysBeforeClose: "0",
      reminderSendAt: "25:00",
      submissionConfirmation: "<script>alert('no')</script>",
      thankYou: "Your session is {{session.title}}.",
    });

    expect(result.fields).toBeNull();
    expect(result.errors.reminderDaysBeforeClose?.[0]).toContain("1 to 90");
    expect(result.errors.reminderSendAt?.[0]).toContain("valid reminder time");
    expect(result.errors.submissionConfirmation?.join(" ")).toContain("Raw HTML is not allowed");
    expect(result.errors.thankYou?.join(" ")).toContain("Unknown variables: session.title");
  });
});
