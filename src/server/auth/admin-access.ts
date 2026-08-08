import { getRuntimeConfig } from "@/config/runtime-env.server";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getAllowedAdminEmails(value = getRuntimeConfig().server.AUTH_ALLOWED_EMAILS): ReadonlySet<string> {
  return new Set((value ?? "").split(",").map(normalizeEmail).filter(Boolean));
}

export function isAllowedAdminEmail(email: string, allowedEmails = getAllowedAdminEmails()): boolean {
  return allowedEmails.has(normalizeEmail(email));
}

interface AdminSession {
  readonly user: {
    readonly email: string;
  };
}

export function isAuthorizedAdminSession<T extends AdminSession>(session: T | null | undefined): session is T {
  return session !== null && session !== undefined && isAllowedAdminEmail(session.user.email);
}
