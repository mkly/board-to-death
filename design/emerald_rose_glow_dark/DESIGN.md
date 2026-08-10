---
name: Emerald & Rose Glow
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#404944'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#707974'
  outline-variant: '#bfc9c3'
  surface-tint: '#2b6954'
  primary: '#003527'
  on-primary: '#ffffff'
  primary-container: '#064e3b'
  on-primary-container: '#80bea6'
  inverse-primary: '#95d3ba'
  secondary: '#a93349'
  on-secondary: '#ffffff'
  secondary-container: '#fe7488'
  on-secondary-container: '#730425'
  tertiary: '#003623'
  on-tertiary: '#ffffff'
  tertiary-container: '#004f34'
  on-tertiary-container: '#31c98f'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#b0f0d6'
  primary-fixed-dim: '#95d3ba'
  on-primary-fixed: '#002117'
  on-primary-fixed-variant: '#0b513d'
  secondary-fixed: '#ffdadc'
  secondary-fixed-dim: '#ffb2b9'
  on-secondary-fixed: '#400010'
  on-secondary-fixed-variant: '#891933'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  display-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 48px
    fontWeight: '800'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '800'
    lineHeight: '1.2'
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '700'
    lineHeight: '1.3'
  title-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: '1.4'
  body-base:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label-uppercase:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '700'
    lineHeight: '1.0'
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  xs: 4px
  sm: 12px
  md: 24px
  lg: 48px
  xl: 80px
  container-max: 1280px
  gutter: 24px
---

## Brand & Style
The brand personality strikes a balance between **institutional reliability** and **creative luxury**. As a B2B SaaS for event planning, the design system must convey the logistical precision required for large-scale operations while celebrating the aesthetic vibrancy of the events industry.

The design style is **Corporate Modern with Tactile Accents**. It utilizes high-quality typography and a disciplined grid, but breaks the corporate monotony with lush gradients, glassmorphism on secondary surfaces, and high-contrast accents. The goal is to evoke a sense of "Luxe Tech"—an environment that feels like a premium digital concierge.

- **Minimalism** provides the structural foundation through generous whitespace.
- **Glassmorphism** is applied to overlays and floating panels to maintain a sense of depth and airiness.
- **Vibrant Gradients** act as focal points, leading the eye to primary calls to action.

## Colors
The palette is built on the concept of **Midnight Emerald**. 

- **Primary:** Deep Emerald (#064e3b) is used for structural branding, primary navigation, and heavy-weight typography.
- **Secondary/Accent:** Rose Gold (#fb7185) is reserved for "magic moments"—key conversions, notifications, and highlight states. 
- **Gradients:** Use the Emerald-to-Forest gradient for large interactive areas (buttons, hero sections). Use the Rose-to-Peach gradient for celebratory UI elements like status badges or progress indicators.
- **Dark Mode Logic:** The foundation is not pure black, but "Midnight Emerald" (#022c22). Surfaces rise in elevation by becoming slightly lighter and greener (#064e3b), ensuring the brand color is always felt.

## Typography
This design system relies exclusively on **Plus Jakarta Sans** for its geometric clarity and friendly proportions.

- **Headlines:** Use tight letter-spacing and bold/extra-bold weights to create a strong visual anchor.
- **Body:** Stick to the 400 weight for maximum legibility. Use "body-base" for primary content and "body-sm" for metadata or dense dashboard information.
- **Labels:** Use uppercase for category headers or small UI labels to create a distinct hierarchy between data and navigation.
- **Color usage:** Headlines should always use the primary Emerald (Light Mode) or Off-white (Dark Mode). Never use pure black for text.

## Layout & Spacing
The layout follows a **8px linear scale** to ensure geometric harmony with the 8px corner radius.

- **Desktop:** 12-column fluid grid with a maximum container width of 1280px. Gutters are fixed at 24px.
- **Tablet:** 8-column grid with 16px margins.
- **Mobile:** 4-column grid with 16px margins. Content should stack vertically, prioritizing data visualization and scheduled tasks.
- **Philosophy:** Use "Whitespace as Luxury." Dashboard components should not be cramped; instead, use generous internal padding (24px) within cards to create a premium feel.

## Elevation & Depth
Depth is created through a mix of **Tonal Layers** and **Ambient Shadows**.

1.  **Level 0 (Background):** The base canvas (Light: #f8fafc | Dark: #022c22).
2.  **Level 1 (Cards/Panels):** Raised surfaces with a subtle 1px border (#e2e8f0 in light, #065f46 in dark). Use a very soft, diffused shadow: `0 4px 20px rgba(6, 78, 59, 0.05)`.
3.  **Level 2 (Modals/Dropdowns):** Elevated elements that use a **Backdrop Blur** (20px) and a slightly higher opacity shadow. 
4.  **Interaction:** On hover, cards should subtly lift by increasing the shadow spread and shifting 2px upwards.

## Shapes
The shape language is consistently **Rounded**. 

- **Standard Elements:** Buttons, Input fields, and Cards use the base **8px (rounded-md)** radius. This reflects the "bringing people together" vibe—approachable but professional.
- **Special Elements:** Tags and Chips use a **Pill (rounded-full)** shape to distinguish them from actionable buttons.
- **Icons:** Use a 1.5pt stroke weight with rounded terminals to match the typography's soft geometry.

## Components

### Buttons
- **Primary:** Gradient background (Emerald to Forest), white text, 8px radius. High shadow on hover.
- **Secondary:** Transparent background, 1.5px border in Emerald, Emerald text.
- **Accent:** Gradient background (Rose to Peach), white text. Reserved for "Create Event" or "Live Now" buttons.

### Cards
- White/Dark Emerald background with a 1px stroke. Internal padding of 24px. Titles in `title-sm`.

### Input Fields
- Subtle grey background (#f1f5f9) in Light mode. On focus, the border transitions to Rose Gold with a faint Rose glow (box-shadow).

### Chips & Badges
- **Status Active:** Soft green background with dark green text.
- **Status Pending:** Soft rose background with dark rose text.
- Always pill-shaped.

### Lists
- Clean, unbordered lists with 12px vertical spacing. Use a subtle hover state highlight (5% primary color opacity).

### Specialized Components
- **Timeline/Gantt:** Use Rose Gold for the "Current Time" indicator and Emerald for completed tasks.
- **Event Header:** Large display typography over a background blur or high-resolution image with an Emerald overlay.