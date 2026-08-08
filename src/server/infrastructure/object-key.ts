const SAFE_OBJECT_KEY_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export function isSafeObjectKey(key: string): boolean {
  if (key.length === 0 || key.length > 1_024 || key.startsWith("/") || key.includes("\\") || key.includes("\0")) {
    return false;
  }

  return key
    .split("/")
    .every((segment) => segment !== "." && segment !== ".." && SAFE_OBJECT_KEY_SEGMENT.test(segment));
}
