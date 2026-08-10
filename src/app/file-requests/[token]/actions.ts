"use server";

import { getDatabaseClient } from "@/server/database/client";
import { createFileRequestFileService } from "@/server/files/file-service";
import { FileRequestFulfillmentLinkError, FileRequestFulfillmentLinkService } from "@/server/files/fulfillment-links";

export type FileRequestUploadState =
  | { readonly status: "idle" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "success"; readonly message: string };

export async function uploadFileRequest(
  token: string,
  _state: FileRequestUploadState,
  formData: FormData,
): Promise<FileRequestUploadState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose a file to upload." };
  }

  try {
    const result = await new FileRequestFulfillmentLinkService({ database: getDatabaseClient() }).fulfill(
      token,
      { fileName: file.name, contentType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) },
      createFileRequestFileService(),
    );
    if (!result.ok) return { status: "error", message: result.error.message };
    return { status: "success", message: "Your file was uploaded. This fulfillment link has now been used." };
  } catch (error) {
    if (error instanceof FileRequestFulfillmentLinkError) {
      return { status: "error", message: "This fulfillment link is invalid, expired, or already used." };
    }
    console.error(error);
    return { status: "error", message: "The file could not be uploaded. Try again." };
  }
}
