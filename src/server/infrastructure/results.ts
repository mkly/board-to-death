import type { InfrastructureFailureCode, InfrastructureResult, InfrastructureServiceName } from "./contracts.ts";

const SAFE_FAILURE_MESSAGES: Readonly<Record<InfrastructureFailureCode, string>> = {
  "invalid-input": "The service rejected the request.",
  unauthorized: "The service rejected its credentials.",
  "not-found": "The requested resource was not found.",
  conflict: "The request conflicts with the current service state.",
  "rate-limited": "The service rate limit was reached.",
  timeout: "The service request timed out.",
  unavailable: "The service is temporarily unavailable.",
  unexpected: "The service request failed unexpectedly.",
};

const RETRYABLE_FAILURES = new Set<InfrastructureFailureCode>(["rate-limited", "timeout", "unavailable"]);

export function infrastructureSuccess<T>(value: T): InfrastructureResult<T> {
  return { ok: true, value };
}

export function infrastructureFailure<T>(
  service: InfrastructureServiceName,
  code: InfrastructureFailureCode,
  retryAfterMs?: number,
): InfrastructureResult<T> {
  const safeRetryAfterMs = retryAfterMs !== undefined && retryAfterMs >= 0 ? retryAfterMs : undefined;

  return {
    ok: false,
    error: {
      service,
      code,
      message: SAFE_FAILURE_MESSAGES[code],
      retryable: RETRYABLE_FAILURES.has(code),
      ...(safeRetryAfterMs === undefined ? {} : { retryAfterMs: safeRetryAfterMs }),
    },
  };
}

export function normalizeInfrastructureFailure<T>(
  service: InfrastructureServiceName,
  _error: unknown,
): InfrastructureResult<T> {
  return infrastructureFailure(service, "unexpected");
}

export async function captureInfrastructureResult<T>(
  service: InfrastructureServiceName,
  operation: () => T | Promise<T>,
): Promise<InfrastructureResult<T>> {
  try {
    return infrastructureSuccess(await operation());
  } catch (error) {
    return normalizeInfrastructureFailure(service, error);
  }
}
