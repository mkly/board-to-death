import { expect, type Locator } from "@playwright/test";

/**
 * Waits until React has hydrated the given element.
 *
 * The browser suite runs against `next dev`, which compiles routes on demand: the server HTML is
 * painted long before the client bundle finishes loading. A `fill` or `click` that lands in that
 * window is silently dropped — the DOM changes but React never sees the event, so component state
 * and everything derived from it (a dependent `min` attribute, a `disabled` submit button, a filter
 * list) stays at its initial value and the interaction appears to do nothing.
 *
 * React marks every host node it hydrates with an own `__reactFiber$…` property, so that is the
 * signal we poll. Pass the element that is about to be interacted with, or its nearest container.
 */
export async function waitForHydration(locator: Locator): Promise<void> {
  await expect
    .poll(
      async () => locator.evaluate((element) => Object.keys(element).some((key) => key.startsWith("__reactFiber$"))),
      { timeout: 30_000, message: "Expected React to hydrate the element before interacting with it." },
    )
    .toBe(true);
}
