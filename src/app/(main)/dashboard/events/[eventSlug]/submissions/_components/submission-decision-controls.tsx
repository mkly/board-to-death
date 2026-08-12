"use client";

import { startTransition, useActionState, useState } from "react";

import { CheckIcon, ChevronDownIcon, CircleAlertIcon, Clock3Icon, XIcon } from "lucide-react";

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
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import type { CfpSubmissionStatus } from "@/generated/prisma/client";
import { useActionToast } from "@/hooks/use-action-toast";

import { recordSubmissionDecision, type SubmissionDecisionActionState } from "../actions";

type SubmissionDecision = "WAITLISTED" | "ACCEPTED" | "REJECTED";

interface SubmissionDecisionControlsProps {
  readonly eventSlug: string;
  readonly submissionId: string;
  readonly status: CfpSubmissionStatus;
  readonly compact?: boolean;
}

const initialState: SubmissionDecisionActionState = { status: "idle" };

const decisionCopy: Readonly<
  Record<SubmissionDecision, { readonly label: string; readonly title: string; readonly description: string }>
> = {
  ACCEPTED: {
    label: "Accept proposal",
    title: "Accept this proposal?",
    description: "This records a final accepted decision for the proposal.",
  },
  WAITLISTED: {
    label: "Waitlist proposal",
    title: "Waitlist this proposal?",
    description: "This records the proposal as waitlisted. You can accept or reject it later.",
  },
  REJECTED: {
    label: "Reject proposal",
    title: "Reject this proposal?",
    description: "This records a final rejected decision for the proposal.",
  },
};

function decisionIcon(decision: SubmissionDecision) {
  if (decision === "ACCEPTED") return <CheckIcon data-icon="inline-start" />;
  if (decision === "WAITLISTED") return <Clock3Icon data-icon="inline-start" />;
  return <XIcon data-icon="inline-start" />;
}

function decisionVariant(decision: SubmissionDecision): "default" | "outline" | "destructive" {
  if (decision === "REJECTED") return "destructive";
  if (decision === "WAITLISTED") return "outline";
  return "default";
}

function canDecide(status: CfpSubmissionStatus): boolean {
  return status === "SUBMITTED" || status === "UNDER_REVIEW" || status === "WAITLISTED";
}

export function SubmissionDecisionControls({
  eventSlug,
  submissionId,
  status,
  compact = false,
}: SubmissionDecisionControlsProps) {
  const [state, formAction, pending] = useActionState(recordSubmissionDecision, initialState);
  useActionToast(state);
  const [decision, setDecision] = useState<SubmissionDecision | null>(null);
  const availableDecisions: readonly SubmissionDecision[] =
    status === "WAITLISTED" ? ["ACCEPTED", "REJECTED"] : ["ACCEPTED", "WAITLISTED", "REJECTED"];
  const submitDecision = () => {
    if (!decision) return;
    const formData = new FormData();
    formData.set("eventSlug", eventSlug);
    formData.set("submissionId", submissionId);
    formData.set("decision", decision);
    startTransition(() => formAction(formData));
    setDecision(null);
  };

  return (
    <div className="flex flex-col gap-3">
      {canDecide(status) && compact ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label="Record decision" disabled={pending} size="sm" variant="outline">
              {pending ? <Spinner data-icon="inline-start" /> : null}
              Decide
              <ChevronDownIcon data-icon="inline-end" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              {availableDecisions.map((option) => (
                <DropdownMenuItem key={option} onSelect={() => setDecision(option)}>
                  {decisionIcon(option)}
                  {decisionCopy[option].label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {canDecide(status) && !compact ? (
        <div className="flex flex-wrap gap-2">
          {availableDecisions.map((option) => (
            <Button
              disabled={pending}
              key={option}
              onClick={() => setDecision(option)}
              type="button"
              variant={decisionVariant(option)}
            >
              {decisionIcon(option)}
              {decisionCopy[option].label}
            </Button>
          ))}
        </div>
      ) : null}

      <AlertDialog open={decision !== null} onOpenChange={(open) => !open && setDecision(null)}>
        <AlertDialogContent>
          {decision ? (
            <>
              <AlertDialogHeader>
                <AlertDialogMedia>
                  <CircleAlertIcon />
                </AlertDialogMedia>
                <AlertDialogTitle>{decisionCopy[decision].title}</AlertDialogTitle>
                <AlertDialogDescription>{decisionCopy[decision].description}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={pending}
                  onClick={submitDecision}
                  type="button"
                  variant={decision === "REJECTED" ? "destructive" : "default"}
                >
                  {decisionCopy[decision].label}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
