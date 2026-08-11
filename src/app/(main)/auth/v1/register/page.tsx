import Image from "next/image";
import Link from "next/link";

import { AuthHeroBackground } from "../../_components/auth-hero-background";
import { RegisterForm } from "../../_components/register-form";

interface RegisterV1Props {
  readonly searchParams: Promise<{ email?: string | string[] }>;
}

export default async function RegisterV1({ searchParams }: RegisterV1Props) {
  // The login screen sends unrecognized addresses here, so carry the one they already typed.
  const query = await searchParams;
  const defaultEmail = typeof query.email === "string" ? query.email : undefined;

  return (
    <div className="flex h-dvh">
      <div className="relative hidden bg-slate-950 lg:block lg:w-1/3">
        <AuthHeroBackground sizes="(min-width: 1024px) 33vw, 0px" />
        <div className="absolute inset-0 bg-black/30" />
        <div className="relative flex h-full flex-col items-center justify-center p-12 text-center">
          <div className="flex flex-col gap-6">
            <Image
              src="/brand-mark.png"
              alt=""
              width={64}
              height={64}
              priority
              className="mx-auto size-12 object-contain"
            />
            <div className="flex flex-col gap-2">
              <p className="font-light text-5xl text-white">Your event workspace</p>
              <p className="text-white/80 text-xl">Let&apos;s set it up</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex w-full items-center justify-center bg-background p-8 lg:w-2/3 dark:bg-[#010706]">
        <div className="flex w-full max-w-md flex-col gap-10 py-24 lg:py-32">
          <div className="flex flex-col gap-4 text-center">
            <h1 className="font-medium tracking-tight">Create your workspace</h1>
            <div className="mx-auto max-w-xl text-muted-foreground">
              {defaultEmail
                ? "We didn't find an account for that email — create your workspace to get started."
                : "Start a private workspace for your events with a secure, passwordless signup link."}
            </div>
          </div>
          <div className="flex flex-col gap-4">
            <RegisterForm defaultEmail={defaultEmail} />
            <p className="text-center text-muted-foreground text-xs">
              Already have an account?{" "}
              <Link prefetch={false} href="login" className="text-primary">
                Log in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
