---
name: Emerald Rose Glow
colors:
  surface: '#101415'
  surface-dim: '#101415'
  surface-bright: '#363a3b'
  surface-container-lowest: '#0b0f10'
  surface-container-low: '#191c1e'
  surface-container: '#1d2022'
  surface-container-high: '#272a2c'
  surface-container-highest: '#323537'
  on-surface: '#e0e3e5'
  on-surface-variant: '#c1c8c4'
  inverse-surface: '#e0e3e5'
  inverse-on-surface: '#2d3133'
  outline: '#8b928e'
  outline-variant: '#414845'
  surface-tint: '#a7cfc0'
  primary: '#a7cfc0'
  on-primary: '#0f372c'
  primary-container: '#022c22'
  on-primary-container: '#6e9587'
  inverse-primary: '#406659'
  secondary: '#ffb2bb'
  on-secondary: '#571c27'
  secondary-container: '#73323d'
  on-secondary-container: '#f59da8'
  tertiary: '#4edea3'
  on-tertiary: '#003824'
  tertiary-container: '#002d1c'
  on-tertiary-container: '#00a16f'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#c2ebdc'
  primary-fixed-dim: '#a7cfc0'
  on-primary-fixed: '#002018'
  on-primary-fixed-variant: '#284e42'
  secondary-fixed: '#ffd9dc'
  secondary-fixed-dim: '#ffb2bb'
  on-secondary-fixed: '#3b0613'
  on-secondary-fixed-variant: '#73323d'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#101415'
  on-background: '#e0e3e5'
  surface-variant: '#323537'
typography:
  headline-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 8px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 40px
  container-max: 1440px
---

## Brand & Style
The design system embodies a "Luxe Tech" aesthetic, tailored for high-end B2B event planning. It targets professional organizers who require a tool that feels as sophisticated as the galas they curate, yet remains energetically efficient. 

The style merges **Minimalism** with **Glassmorphism**. It utilizes expansive dark surfaces to create a sense of prestige, punctuated by vibrant, glowing accents. The emotional response is one of "commanding elegance"—the interface feels powerful, premium, and precise. High-contrast edges and subtle light-leak gradients prevent the dark theme from feeling heavy, instead creating a luminous, high-energy environment.

## Colors
The palette is anchored by "Midnight Emerald," a deep, saturated green that serves as the canvas for all interfaces. This provides a more distinctive and luxurious foundation than standard blacks or greys.

- **Primary (Midnight Emerald):** Used for large backgrounds, sidebars, and deep containers.
- **Secondary (Soft Rose):** Reserved strictly for primary call-to-actions, highlights, and critical "active" states to ensure high-energy contrast.
- **Tertiary (Mint/Emerald Gradient):** Used for progress indicators, success states, and decorative accents.
- **Neutral:** A range of cool whites and greys used for legible body text and subtle borders.

Gradients should transition from `emerald-500` to `mint-300` at a 135-degree angle to simulate a digital "glow" against the dark background.

## Typography
Plus Jakarta Sans is the sole typeface for this design system, chosen for its modern, geometric construction and open counters which maintain legibility against dark backgrounds. 

Headlines utilize tight letter-spacing and heavy weights to command attention. Body text should maintain a generous line-height to ensure the dense B2B data remains scannable. Labels and small captions use increased letter-spacing and uppercase styling where appropriate to act as functional "anchors" in the layout.

## Layout & Spacing
The layout follows a **Fluid Grid** system within a max-width container. A strict 8px linear scale governs all padding and margins to ensure visual rhythm.

- **Desktop (12 columns):** 40px margins with 24px gutters. Use for complex event dashboards and scheduling views.
- **Tablet (8 columns):** 24px margins with 16px gutters.
- **Mobile (4 columns):** 16px margins with 12px gutters.

Large sections of content are separated by "Luxe Gaps" (64px+) to reinforce the premium, unhurried brand personality. Components should use dynamic padding that scales with screen size, prioritizing whitespace to prevent "data-clutter."

## Elevation & Depth
Depth is created through **Tonal Layering** and **Backdrop Blurs**. Shadows are rarely used; instead, "light" is used to lift elements.

1.  **Base Layer:** Midnight Emerald (#022C22).
2.  **Surface Layer:** A slightly lighter emerald tint with 40% opacity and a 20px background blur.
3.  **Accent Layer:** Components that need to pop use a 1px inner border (stroke) of Soft Rose or Mint at low opacity (10-20%) to simulate a glass edge.
4.  **Interactive Layer:** Primary actions utilize a subtle outer glow (0px blur, 4px spread) in Soft Rose rather than a traditional drop shadow.

## Shapes
The design system utilizes a consistent 8px (`0.5rem`) corner radius for standard UI components like buttons and input fields. This "Rounded" setting balances professional rigor with a modern, approachable softness. 

Cards and larger containers should step up to `rounded-lg` (16px) or `rounded-xl` (24px) to emphasize their role as structural "hubs." Decorative elements or tags may use pill-shapes to contrast against the more structured grid of the SaaS interface.

## Components

- **Buttons:** Primary buttons feature a solid Soft Rose fill with dark text. Secondary buttons use a Midnight Emerald fill with a 1px Mint border. Tertiary buttons are text-only with a Mint underline on hover.
- **Inputs:** Fields are dark with a 1px border that glows Mint on focus. Labels sit outside the field in `label-sm` weight.
- **Cards:** Use the "Surface Layer" glass effect. Card headers are separated by a subtle 1px line (10% white).
- **Chips/Tags:** Small, pill-shaped elements with low-opacity Mint backgrounds and high-opacity Mint text.
- **Lists:** Rows are separated by 1px "ghost borders" (white at 5% opacity). Hovering a row should apply a slight Emerald-to-Mint gradient tint.
- **Event Timeline:** A custom vertical line component using the Mint gradient, with Soft Rose nodes representing key milestones.