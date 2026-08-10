// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CustomFieldType } from "@/lib/custom-fields";

import { CustomFieldInputs } from "./custom-field-inputs";

afterEach(cleanup);

describe("CustomFieldInputs", () => {
  it("leaves a required single select genuinely empty for native form validation", () => {
    const { container, getByRole } = render(
      <form>
        <CustomFieldInputs
          definitions={[
            {
              id: "session-format",
              label: "Session format",
              description: null,
              type: CustomFieldType.SINGLE_SELECT,
              required: true,
              characterLimit: null,
              options: ["Talk", "Workshop"],
            },
          ]}
        />
      </form>,
    );

    expect(getByRole("combobox", { name: "Session format" }).textContent).toContain("Select an option");
    const nativeSelect = container.querySelector("select");
    expect(nativeSelect?.required).toBe(true);
    expect(nativeSelect?.value).toBe("");
  });
});
