export const apiTokenScopes = ["sessions:read", "speakers:read", "submissions:read"] as const;
export type ApiTokenScope = (typeof apiTokenScopes)[number];

export const webhookEventTypes = ["submission.created", "submission.status_changed", "session.scheduled"] as const;
export type WebhookEventType = (typeof webhookEventTypes)[number];
