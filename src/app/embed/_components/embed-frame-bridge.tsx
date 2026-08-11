"use client";

import { useEffect } from "react";

export function EmbedFrameBridge({ instance }: { readonly instance: string }) {
  useEffect(() => {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(instance) || window.parent === window || !document.referrer) return;
    const parent = new URL(document.referrer);
    if (parent.protocol !== "http:" && parent.protocol !== "https:") return;

    const notify = () => {
      window.parent.postMessage(
        {
          type: "gatherpulse:resize",
          instance,
          height: Math.ceil(document.documentElement.getBoundingClientRect().height),
        },
        parent.origin,
      );
    };
    const observer = new ResizeObserver(notify);
    observer.observe(document.documentElement);
    notify();
    return () => observer.disconnect();
  }, [instance]);

  return null;
}
