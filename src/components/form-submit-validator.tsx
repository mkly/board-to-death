"use client";

import { useEffect } from "react";

const SUBMIT_SELECTOR = "button[type='submit'], input[type='submit']";
const CONSTRAINT_SELECTOR = "input, select, textarea, output";
const CHECKABLE_CONTROL_SELECTOR = "input, select, textarea";
type ValidatorState = {
  readonly controls: WeakSet<HTMLElement>;
  submitted: boolean;
};

const stateByForm = new WeakMap<HTMLFormElement, ValidatorState>();

function getFormState(form: HTMLFormElement): ValidatorState {
  let state = stateByForm.get(form);
  if (!state) {
    state = { controls: new WeakSet(), submitted: false };
    stateByForm.set(form, state);
  }
  return state;
}

function markControlAsInteracted(form: HTMLFormElement, control: HTMLElement): void {
  const state = getFormState(form);
  state.controls.add(control);
}

function isManagedForm(form: HTMLFormElement): boolean {
  return (
    form.noValidate ||
    form.querySelector("[required]") !== null ||
    form.querySelector("[pattern], [min], [max], [minlength], [maxlength]") !== null
  );
}

function getSubmitControls(form: HTMLFormElement): Array<HTMLButtonElement | HTMLInputElement> {
  const controls: Array<HTMLButtonElement | HTMLInputElement> = Array.from(
    form.querySelectorAll<HTMLButtonElement | HTMLInputElement>(SUBMIT_SELECTOR),
  );

  const { id } = form;
  if (!id) {
    return controls;
  }

  const escapedFormId = CSS.escape(id);
  const externalControls = document.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
    `button[type='submit'][form='${escapedFormId}'], input[type='submit'][form='${escapedFormId}']`,
  );

  const mergedControls = new Map<HTMLButtonElement | HTMLInputElement, true>();
  for (const control of [...controls, ...externalControls]) {
    mergedControls.set(control, true);
  }

  return [...mergedControls.keys()];
}

function syncForm(form: HTMLFormElement): void {
  form.setAttribute("novalidate", "");
  const isValid = form.checkValidity();
  const submitControls = getSubmitControls(form);
  const controls = Array.from(form.querySelectorAll<HTMLElement>(CONSTRAINT_SELECTOR));
  const state = getFormState(form);
  const shouldShowFieldErrors = state.submitted;

  for (const control of submitControls) {
    if (control.dataset.formSubmitValidatorBaseDisabled === undefined) {
      control.dataset.formSubmitValidatorBaseDisabled = control.disabled ? "true" : "false";
    }
    control.disabled = control.dataset.formSubmitValidatorBaseDisabled === "true" || !isValid;
  }

  for (const control of controls) {
    if (control.matches(CHECKABLE_CONTROL_SELECTOR)) {
      if (
        !(
          control instanceof HTMLInputElement ||
          control instanceof HTMLSelectElement ||
          control instanceof HTMLTextAreaElement
        )
      ) {
        continue;
      }

      if (!control.willValidate) {
        control.removeAttribute("aria-invalid");
        continue;
      }

      const valid = control.checkValidity();
      const markAsInvalid = shouldShowFieldErrors || state.controls.has(control);

      if (!markAsInvalid) {
        control.removeAttribute("aria-invalid");
        continue;
      }

      if (valid) {
        control.removeAttribute("aria-invalid");
        continue;
      }

      control.setAttribute("aria-invalid", "true");
    }
  }
}

export function FormSubmitValidator() {
  useEffect(() => {
    const handleChange = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const form = target.closest("form");
      if (form && isManagedForm(form)) {
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLSelectElement ||
          target instanceof HTMLTextAreaElement
        ) {
          markControlAsInteracted(form, target);
        }
        syncForm(form);
      }
    };

    const handleSubmit = (event: SubmitEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLFormElement)) {
        return;
      }

      if (!isManagedForm(target)) {
        return;
      }

      const formState = getFormState(target);
      formState.submitted = true;
      syncForm(target);

      if (target.checkValidity()) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    };

    document.addEventListener("input", handleChange, true);
    document.addEventListener("change", handleChange, true);
    document.addEventListener("submit", handleSubmit, true);

    return () => {
      document.removeEventListener("input", handleChange, true);
      document.removeEventListener("change", handleChange, true);
      document.removeEventListener("submit", handleSubmit, true);
    };
  }, []);

  return null;
}
