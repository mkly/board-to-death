import { privateApiRoute } from "@/server/developer-api/routes";

export async function GET(request: Request, { params }: { readonly params: Promise<{ readonly eventId: string }> }) {
  return privateApiRoute(request, (await params).eventId, "sessions");
}
