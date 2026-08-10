"use client";

import { useRef } from "react";

import { ImageUp, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { cn } from "@/lib/utils";

const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export interface BrandingImagePick {
  readonly file: File;
  readonly previewUrl: string;
}

export function brandingImageError(file: File, label: string, maxMegabytes: number): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
    return `Upload the ${label} as a PNG, JPEG, or WebP image.`;
  }
  if (file.size > maxMegabytes * 1024 * 1024) {
    return `The ${label} must be ${maxMegabytes} MB or smaller.`;
  }
  return null;
}

function formatBytes(size: number): string {
  return size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}

export function BrandingImagePicker({
  id,
  label,
  description,
  pick,
  currentImageUrl,
  error,
  previewClassName,
  disabled = false,
  onSelect,
  onClear,
}: {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly pick: BrandingImagePick | null;
  readonly currentImageUrl?: string;
  readonly error?: string;
  readonly previewClassName: string;
  readonly disabled?: boolean;
  readonly onSelect: (file: File) => void;
  readonly onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrl = pick?.previewUrl ?? currentImageUrl;

  return (
    <Field data-invalid={Boolean(error)} data-disabled={disabled || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        className="sr-only"
        aria-invalid={Boolean(error)}
        disabled={disabled}
        onChange={(changeEvent) => {
          const file = changeEvent.target.files?.[0];
          if (file) onSelect(file);
          changeEvent.target.value = "";
        }}
      />
      {previewUrl ? (
        <div className="flex items-center gap-3 rounded-lg border p-2">
          {/* biome-ignore lint/performance/noImgElement: previews include local object URLs and authenticated routes */}
          <img src={previewUrl} alt="" className={cn("shrink-0 rounded-md border bg-muted", previewClassName)} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-sm">{pick?.file.name ?? `Current ${label.toLowerCase()}`}</p>
            {pick ? <p className="text-muted-foreground text-xs">{formatBytes(pick.file.size)}</p> : null}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            Replace
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${label}`}
            disabled={disabled}
            onClick={onClear}
          >
            <Trash2 />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-muted-foreground text-sm transition-colors hover:border-primary/50 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          <ImageUp className="size-4" aria-hidden="true" />
          Choose image
        </button>
      )}
      <FieldDescription>{description}</FieldDescription>
      <FieldError>{error}</FieldError>
    </Field>
  );
}
