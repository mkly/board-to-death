"use client";

import { useEffect } from "react";

import { toast } from "sonner";

export interface ActionToastState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
}

export function actionResultToast(result: ActionToastState): void {
  if (!result.message) return;
  if (result.status === "success") toast.success(result.message);
  else if (result.status === "error") toast.error(result.message);
}

export function useActionToast(state: ActionToastState): void {
  // The state object identity changes on every dispatch, so repeated saves re-toast the same message.
  useEffect(() => {
    actionResultToast(state);
  }, [state]);
}
