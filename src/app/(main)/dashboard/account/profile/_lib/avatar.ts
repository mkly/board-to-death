import "server-only";

const AVATAR_URL_PREFIX = "/dashboard/account/profile/avatar/";
const FILE_ID_PATTERN = /^[0-9a-f-]{36}$/;

export function avatarUrl(fileId: string): string {
  return `${AVATAR_URL_PREFIX}${fileId}`;
}

export function avatarObjectKey(userId: string, fileId: string): string {
  return `user-avatars/${userId}/${fileId}`;
}

export function avatarFileIdFromImage(image: string | null): string | null {
  if (!image?.startsWith(AVATAR_URL_PREFIX)) return null;
  const fileId = image.slice(AVATAR_URL_PREFIX.length);
  return isAvatarFileId(fileId) ? fileId : null;
}

export function isAvatarFileId(value: string): boolean {
  return FILE_ID_PATTERN.test(value);
}
