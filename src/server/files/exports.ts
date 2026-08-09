import JSZip from "jszip";

import type { CollectedEventFile } from "./request-files.ts";

function safeArchiveSegment(value: string): string {
  const segment = value
    .split(/[\\/]/)
    .at(-1)
    ?.split("")
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && codePoint !== 127;
    })
    .join("")
    .trim();
  return segment && segment !== "." && segment !== ".." ? segment.slice(0, 180) : "file";
}

/**
 * Packs every current file collected for an event into one archive, foldered by request key so
 * an administrator downloading it can tell which request a document answered. A manifest carries
 * the target and content type, which the file name alone cannot.
 */
export async function createFileRequestBundle(files: readonly CollectedEventFile[]): Promise<Uint8Array> {
  const zip = new JSZip();
  const usedPaths = new Set<string>();
  const manifest: Array<{
    requestKey: string;
    requestTitle: string;
    target: string;
    fileName: string;
    archivePath: string;
    contentType: string;
    size: number;
    uploadedAt: string;
  }> = [];

  for (const entry of files) {
    const folder = safeArchiveSegment(entry.requestKey);
    const baseName = `${safeArchiveSegment(entry.targetLabel)}-${safeArchiveSegment(entry.file.fileName)}`;
    let archivePath = `${folder}/${baseName}`;
    for (let suffix = 2; usedPaths.has(archivePath); suffix += 1) {
      archivePath = `${folder}/${suffix}-${baseName}`;
    }
    usedPaths.add(archivePath);
    zip.file(archivePath, entry.bytes);
    manifest.push({
      requestKey: entry.requestKey,
      requestTitle: entry.requestTitle,
      target: entry.targetLabel,
      fileName: entry.file.fileName,
      archivePath,
      contentType: entry.file.contentType,
      size: entry.file.size,
      uploadedAt: entry.file.uploadedAt.toISOString(),
    });
  }

  zip.file("manifest.json", JSON.stringify({ generatedAt: new Date().toISOString(), files: manifest }, null, 2));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
