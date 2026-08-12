// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { FormSubmitValidator } from "./form-submit-validator";

describe("FormSubmitValidator", () => {
  afterEach(() => {
    cleanup();
  });

  test("leaves server-rendered controls untouched until validation is triggered", async () => {
    render(
      <>
        <FormSubmitValidator />
        <form>
          <label htmlFor="title">Session title</label>
          <input id="title" name="title" required defaultValue="" />
          <button type="submit">Save</button>
        </form>
      </>,
    );

    const submitButton = screen.getByRole("button", { name: /save/i }) as HTMLButtonElement;

    expect(submitButton.disabled).toBe(false);
    expect(submitButton.dataset.formSubmitValidatorBaseDisabled).toBeUndefined();
    expect(screen.getByRole("textbox").getAttribute("aria-invalid")).toBeNull();

    fireEvent.submit(screen.getByRole("textbox").closest("form") as HTMLFormElement);

    await waitFor(() => {
      expect(submitButton.disabled).toBe(true);
      expect(screen.getByRole("textbox").getAttribute("aria-invalid")).toBe("true");
    });

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "A session" } });

    await waitFor(() => {
      expect(submitButton.disabled).toBe(false);
    });
    expect(screen.getByRole("textbox").getAttribute("aria-invalid")).toBeNull();
  });

  test("does not touch submit controls in forms without validation constraints", async () => {
    render(
      <>
        <FormSubmitValidator />
        <form>
          <input name="title" defaultValue="no constraints" />
          <button type="submit">Save</button>
        </form>
      </>,
    );

    const submitButton = screen.getByRole("button", { name: /save/i }) as HTMLButtonElement;

    await waitFor(() => {
      expect(submitButton.disabled).toBe(false);
    });
  });
});
