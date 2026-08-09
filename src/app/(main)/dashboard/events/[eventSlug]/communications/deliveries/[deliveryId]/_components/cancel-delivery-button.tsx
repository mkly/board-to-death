"use client";

import { useActionState } from "react";

import { Ban, CircleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import { type CancelBulkDeliveryState, cancelBulkDelivery } from "../actions";

const initialState: CancelBulkDeliveryState = { status: "idle" };

interface CancelDeliveryButtonProps {
  readonly eventSlug: string;
  readonly deliveryId: string;
}

export function CancelDeliveryButton({ eventSlug, deliveryId }: CancelDeliveryButtonProps) {
  const [state, formAction, pending] = useActionState(cancelBulkDelivery, initialState);
  const formId = `cancel-delivery-${deliveryId}`;

  return (
    <div className="flex flex-col gap-3">
      <form id={formId} action={formAction}>
        <input type="hidden" name="eventSlug" value={eventSlug} />
        <input type="hidden" name="deliveryId" value={deliveryId} />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="destructive" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : <Ban data-icon="inline-start" />}
              {pending ? "Cancelling..." : "Cancel remaining attempts"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogMedia>
                <CircleAlert />
              </AlertDialogMedia>
              <AlertDialogTitle>Cancel this delivery?</AlertDialogTitle>
              <AlertDialogDescription>
                No new provider attempts will start. An attempt already in flight may still finish.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep delivery active</AlertDialogCancel>
              <AlertDialogAction type="submit" form={formId} variant="destructive">
                Cancel remaining attempts
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </form>
      {state.status !== "idle" && (
        <Alert variant={state.status === "error" ? "destructive" : "default"}>
          <AlertTitle>{state.status === "error" ? "Cancellation failed" : "Delivery cancelled"}</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
