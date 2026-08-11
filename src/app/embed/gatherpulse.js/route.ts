const WEB_COMPONENT_SOURCE = `
class GatherPulseEmbed extends HTMLElement {
  connectedCallback() {
    if (this.controller) return;
    const source = this.getAttribute("src");
    const instance = this.getAttribute("instance");
    if (!source || !instance || !/^[a-zA-Z0-9_-]{1,80}$/.test(instance)) return;
    const url = new URL(source, document.baseURI);
    if (url.protocol !== "http:" && url.protocol !== "https:") return;

    this.controller = new AbortController();
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    const frame = document.createElement("iframe");
    frame.src = url.toString();
    frame.title = this.getAttribute("title") || "Published event program";
    frame.loading = "lazy";
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    frame.style.cssText = "display:block;width:100%;height:480px;border:0";
    root.replaceChildren(frame);

    window.addEventListener("message", (event) => {
      const data = event.data;
      if (event.origin !== url.origin || event.source !== frame.contentWindow) return;
      if (!data || data.type !== "gatherpulse:resize" || data.instance !== instance) return;
      if (!Number.isFinite(data.height) || data.height < 120 || data.height > 4000) return;
      frame.style.height = Math.ceil(data.height) + "px";
    }, { signal: this.controller.signal });
  }

  disconnectedCallback() {
    this.controller?.abort();
    this.controller = undefined;
  }
}

if (!customElements.get("gatherpulse-embed")) {
  customElements.define("gatherpulse-embed", GatherPulseEmbed);
}
`;

export function GET(): Response {
  return new Response(WEB_COMPONENT_SOURCE, {
    headers: {
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "Content-Type": "text/javascript; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
