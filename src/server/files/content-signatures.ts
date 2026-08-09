export type ContentSignatureCheck = (bytes: Uint8Array) => boolean;

function startsWithBytes(bytes: Uint8Array, signature: readonly number[]): boolean {
  return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
}

export function isJpeg(bytes: Uint8Array): boolean {
  return startsWithBytes(bytes, [0xff, 0xd8, 0xff]);
}

export function isPng(bytes: Uint8Array): boolean {
  return startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

export function isWebp(bytes: Uint8Array): boolean {
  return (
    startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

export function isPdf(bytes: Uint8Array): boolean {
  return startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46]);
}

export function isZipContainer(bytes: Uint8Array): boolean {
  return startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04]);
}

export function isPlainText(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}
