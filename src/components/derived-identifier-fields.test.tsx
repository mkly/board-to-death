// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { DerivedIdentifierFields, identifierFromName } from "./derived-identifier-fields";

afterEach(cleanup);

describe("DerivedIdentifierFields", () => {
  test("derives a hyphenated identifier while the source is typed", () => {
    render(
      <DerivedIdentifierFields
        identifierId="key"
        identifierLabel="Stable key"
        identifierName="key"
        sourceId="name"
        sourceLabel="Name"
        sourceName="name"
      />,
    );

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Program Fit & Clarity" } });

    expect((screen.getByLabelText("Stable key") as HTMLInputElement).value).toBe("program-fit-clarity");
  });

  test("stops deriving after the identifier is edited directly", () => {
    render(
      <DerivedIdentifierFields
        identifierId="key"
        identifierLabel="Stable key"
        identifierName="key"
        sourceId="name"
        sourceLabel="Name"
        sourceName="name"
      />,
    );

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Program Fit" } });
    fireEvent.change(screen.getByLabelText("Stable key"), { target: { value: "custom-key" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Program Fit Updated" } });

    expect((screen.getByLabelText("Stable key") as HTMLInputElement).value).toBe("custom-key");
  });

  test("supports underscore-separated API keys", () => {
    expect(identifierFromName("Dietary requirements", "_")).toBe("dietary_requirements");
  });
});
