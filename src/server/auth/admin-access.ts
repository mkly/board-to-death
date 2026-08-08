function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getAllowedAdminEmails(value = process.env.AUTH_ALLOWED_EMAILS): ReadonlySet<string> {
  return new Set((value ?? "").split(",").map(normalizeEmail).filter(Boolean));
}

export function isAllowedAdminEmail(email: string, allowedEmails = getAllowedAdminEmails()): boolean {
  return allowedEmails.has(normalizeEmail(email));
}
