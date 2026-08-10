"use client";

/**
 * Lightweight, theme-native confetti burst.
 *
 * Draws to a throwaway full-viewport canvas appended to `document.body`, so it
 * paints above the app and keeps animating across a client-side navigation
 * (e.g. the create-event wizard routing to the new event). Colors are sampled
 * live from the active theme's CSS tokens, so the celebration matches whatever
 * preset and light/dark mode is in effect. Honors `prefers-reduced-motion`.
 *
 * Kept bespoke rather than adding a confetti dependency: the effect is
 * self-contained with no ongoing edge cases, and reading straight from the
 * theme's oklch tokens is the cleanest way to keep it on-brand.
 */

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  spin: number;
  round: boolean;
};

const GRAVITY = 0.3;
const DRAG = 0.992;
const FADE_MS = 2600;

/** Theme tokens that tend to carry the palette's accent colors across presets. */
const PALETTE_TOKENS = [
  "--primary",
  "--ring",
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--accent-foreground",
  "--secondary-foreground",
];

function themeColors(): string[] {
  const styles = getComputedStyle(document.documentElement);
  const colors = PALETTE_TOKENS.map((token) => styles.getPropertyValue(token).trim()).filter(
    (value) => value.length > 0,
  );
  return colors.length > 0 ? colors : ["oklch(0.7 0.15 30)"];
}

export function fireConfetti(): void {
  if (typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:9999;";
  document.body.appendChild(canvas);

  const context = canvas.getContext("2d");
  if (!context) {
    canvas.remove();
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  context.scale(dpr, dpr);

  const colors = themeColors();
  const particles: Particle[] = [];

  const cannon = (originX: number, angleDegrees: number, count: number) => {
    for (let index = 0; index < count; index += 1) {
      const spread = (Math.random() - 0.5) * 50;
      const angle = ((angleDegrees + spread) * Math.PI) / 180;
      const speed = 11 + Math.random() * 9;
      particles.push({
        x: originX,
        y: height * 0.96,
        vx: Math.cos(angle) * speed,
        vy: -Math.sin(angle) * speed,
        size: 6 + Math.random() * 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.3,
        round: Math.random() < 0.35,
      });
    }
  };

  // Two angled cannons rising from the bottom corners toward the center.
  cannon(width * 0.15, 65, 70);
  cannon(width * 0.85, 115, 70);

  const start = performance.now();
  let frame = 0;

  const tick = (now: number) => {
    const elapsed = now - start;
    const alpha = elapsed < FADE_MS ? 1 : Math.max(0, 1 - (elapsed - FADE_MS) / 500);
    context.clearRect(0, 0, width, height);
    context.globalAlpha = alpha;

    let alive = false;
    for (const particle of particles) {
      particle.vx *= DRAG;
      particle.vy = particle.vy * DRAG + GRAVITY;
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.rotation += particle.spin;

      if (particle.y < height + particle.size) alive = true;

      context.save();
      context.translate(particle.x, particle.y);
      context.rotate(particle.rotation);
      context.fillStyle = particle.color;
      if (particle.round) {
        context.beginPath();
        context.arc(0, 0, particle.size / 2, 0, Math.PI * 2);
        context.fill();
      } else {
        context.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size * 0.6);
      }
      context.restore();
    }

    frame += 1;
    if (alive && alpha > 0 && frame < 600) {
      window.requestAnimationFrame(tick);
    } else {
      canvas.remove();
    }
  };

  window.requestAnimationFrame(tick);
}
