import Image from "next/image";
import Link from "next/link";

import { LoginForm } from "../../_components/login-form";

interface LoginV1Props {
  readonly searchParams: Promise<{ callbackURL?: string | string[] }>;
}

export default async function LoginV1({ searchParams }: LoginV1Props) {
  const query = await searchParams;
  const requestedCallback = typeof query.callbackURL === "string" ? query.callbackURL : "/dashboard";
  const callbackURL =
    requestedCallback.startsWith("/") && !requestedCallback.startsWith("//") ? requestedCallback : "/dashboard";
  return (
    <div className="flex h-dvh">
      <div className="relative hidden bg-primary lg:block lg:w-1/3">
        <Image
          src="/auth-background.png"
          alt=""
          fill
          priority
          sizes="(min-width: 1024px) 33vw, 0px"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-primary/40" />
        <div className="relative flex h-full flex-col items-center justify-center p-12 text-center">
          <div className="space-y-6">
            <Image
              src="/brand-mark.png"
              alt=""
              width={64}
              height={64}
              priority
              className="mx-auto size-12 object-contain"
            />
            <div className="space-y-2">
              <h1 className="font-light! text-5xl text-primary-foreground tracking-normal!">Hello again</h1>
              <p className="text-primary-foreground/80 text-xl">Login to continue</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex w-full items-center justify-center bg-background p-8 lg:w-2/3">
        <div className="w-full max-w-md space-y-10 py-24 lg:py-32">
          <div className="space-y-4 text-center">
            <div className="font-medium tracking-tight">Login</div>
            <div className="mx-auto max-w-xl text-muted-foreground">
              Enter your account email address and we&apos;ll send you a secure, single-use sign-in link.
            </div>
          </div>
          <div className="space-y-4">
            <LoginForm callbackURL={callbackURL} />
            <p className="text-center text-muted-foreground text-xs">
              Don&apos;t have an account?{" "}
              <Link prefetch={false} href="/auth/v1/register" className="text-primary">
                Create your organization
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
