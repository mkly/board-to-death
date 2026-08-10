"use client";

import { useEffect } from "react";

import { AlertCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface OrganizationErrorProps {
  readonly error: Error & { digest?: string };
  readonly retry: () => void;
}

export default function OrganizationError({ error, retry }: OrganizationErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>Organization team unavailable</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>We could not load the organization team. Try the request again.</span>
        <Button type="button" size="sm" variant="outline" onClick={retry}>
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}
