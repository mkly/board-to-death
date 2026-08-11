import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/server/auth/auth";

export default async function Home() {
  // Signed-out arrivals at the root are new visitors, so send them to register rather than to the
  // dashboard, which would bounce them to login through the proxy.
  const session = await auth.api.getSession({ headers: await headers() });
  redirect(session ? "/dashboard" : "/auth/v1/register");
}
