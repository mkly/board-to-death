"use server";

import { headers } from "next/headers";

import { z } from "zod";

import { auth } from "@/server/auth/auth";
import { getDatabaseClient } from "@/server/database/client";

export type SignInActionState =
  | { readonly status: "idle" }
  | { readonly status: "sent" }
  | { readonly status: "unknown-account"; readonly email: string }
  | { readonly status: "error"; readonly message: string; readonly field?: "email" };

const emailSchema = z.email({ message: "Enter a valid email address." });

function safeCallbackURL(value: FormDataEntryValue | null) {
  const requested = typeof value === "string" ? value : "";
  return requested.startsWith("/") && !requested.startsWith("//") ? requested : "/dashboard";
}

export async function requestSignInLink(_state: SignInActionState, formData: FormData): Promise<SignInActionState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Enter a valid email address.",
      field: "email",
    };
  }

  const email = parsed.data.trim().toLowerCase();

  try {
    const account = await getDatabaseClient().user.findUnique({ where: { email }, select: { id: true } });
    // Magic links have sign-up disabled, so an unknown address can never receive a usable link.
    // Saying so beats a "check your inbox" for mail that is never going to arrive.
    if (!account) return { status: "unknown-account", email };

    await auth.api.signInMagicLink({
      headers: await headers(),
      body: {
        email,
        callbackURL: safeCallbackURL(formData.get("callbackURL")),
        errorCallbackURL: "/auth/v1/login?error=invalid-link",
      },
    });
    return { status: "sent" };
  } catch (error) {
    console.error("Could not send sign-in link", error);
    return { status: "error", message: "We could not send a sign-in link. Please try again." };
  }
}
