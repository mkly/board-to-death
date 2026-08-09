/**
 * Uploaded file names reach storage metadata and download headers, so they are
 * normalized in one place: every service that accepts a browser-supplied name
 * shares these rules rather than re-deriving them.
 */
export function safeFileName(fileName: string): string | undefined {
  if (!fileName.isWellFormed()) {
    return undefined;
  }
  const baseName = fileName
    .split(/[\\/]/)
    .at(-1)
    ?.split("")
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && codePoint !== 127;
    })
    .join("")
    .trim();
  if (!baseName || baseName === "." || baseName === "..") {
    return undefined;
  }
  const truncatedLength = baseName.length > 255 && /[\uD800-\uDBFF]/.test(baseName.at(254) ?? "") ? 254 : 255;
  return baseName.slice(0, truncatedLength);
}

export function contentDisposition(fileName: string): string {
  const asciiName = fileName.replaceAll(/[^a-zA-Z0-9._ -]/g, "_").replaceAll('"', "_") || "download";
  const encodedName = encodeURIComponent(fileName).replaceAll(
    /[()'*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
}
