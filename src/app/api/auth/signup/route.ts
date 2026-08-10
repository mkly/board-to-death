import { z } from "zod";

import { auth } from "@/server/auth/auth";
import { provisionMagicLinkUser } from "@/server/auth/magic-link-user";
import { createOrganizationSignupIntent, organizationSignupCallback } from "@/server/auth/signup-intent";
import { getDatabaseClient } from "@/server/database/client";

const signupSchema = z.object({
  email: z.email(),
  organizationName: z.string().trim().min(2).max(120),
});

export async function POST(request: Request) {
  const parsed = signupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, message: "Enter a valid email address and organization name." }, { status: 400 });
  }

  try {
    const database = getDatabaseClient();
    const token = await createOrganizationSignupIntent(database, parsed.data);
    const callbackURL = organizationSignupCallback(token);
    await provisionMagicLinkUser(database, { email: parsed.data.email });
    await auth.api.signInMagicLink({
      headers: request.headers,
      body: {
        email: parsed.data.email,
        name: parsed.data.email.split("@")[0] ?? "",
        callbackURL,
        errorCallbackURL: "/auth/v1/register?error=invalid-link",
      },
    });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Could not start organization signup", error);
    return Response.json({ ok: false, message: "We could not send a signup link. Please try again." }, { status: 500 });
  }
}
