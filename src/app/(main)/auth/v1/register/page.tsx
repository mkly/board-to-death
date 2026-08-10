import Link from "next/link";

import { Command } from "lucide-react";

import { RegisterForm } from "../../_components/register-form";

export default function RegisterV1() {
  return (
    <div className="flex h-dvh">
      <div className="flex w-full items-center justify-center bg-background p-8 lg:w-2/3">
        <div className="flex w-full max-w-md flex-col gap-10 py-24 lg:py-32">
          <div className="flex flex-col gap-4 text-center">
            <h1 className="font-medium tracking-tight">Create your organization</h1>
            <div className="mx-auto max-w-xl text-muted-foreground">
              Start a private workspace for your events with a secure, passwordless signup link.
            </div>
          </div>
          <div className="flex flex-col gap-4">
            <RegisterForm />
            <p className="text-center text-muted-foreground text-xs">
              Already have an account?{" "}
              <Link prefetch={false} href="login" className="text-primary">
                Login
              </Link>
            </p>
          </div>
        </div>
      </div>

      <div className="hidden bg-primary lg:block lg:w-1/3">
        <div className="flex h-full flex-col items-center justify-center p-12 text-center">
          <div className="flex flex-col gap-6">
            <Command className="mx-auto size-12 text-primary-foreground" />
            <div className="flex flex-col gap-2">
              <p className="font-light text-5xl text-primary-foreground">Your event workspace</p>
              <p className="text-primary-foreground/80 text-xl">One link away.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
