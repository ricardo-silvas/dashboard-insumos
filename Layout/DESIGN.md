# Design System Strategy: The Industrial Editorial

## 1. Overview & Creative North Star
**Creative North Star: "The Architectural Ledger"**

This design system is engineered for the high-stakes environment of corporate terminal signage. It moves away from the "app-like" interface and toward an **Industrial Editorial** aesthetic. By combining the authoritative weight of classic serif typography with a rigid, tonal hierarchy, we create an experience that feels like a premium financial journal brought to life on a digital display.

The design breaks the traditional "box-and-line" template through **Intentional Asymmetry**. Significant data points are given massive scale, while secondary metadata is tucked into structured, overlapping layers. This creates a rhythmic "F-pattern" that guides the eye across large TV displays, ensuring legibility at a distance without sacrificing the elegance of a corporate headquarters.

---

## 2. Colors
Our palette is a study in high-contrast restraint. We use the brand's Primary Red not as a utility, but as a "Signature Pulse."

### Core Palette
- **Primary:** `#950F1C` (The core brand pulse)
- **Primary Container:** `#B72C31` (Used for high-visibility highlights)
- **Secondary:** `#5E5E5E` (Derived from the 75% Gray requirement)
- **Surface:** `#FBF9F8` (A warm, bone-white base that feels more premium than pure #FFFFFF)

### The "No-Line" Rule
To maintain an editorial feel, **1px solid borders are strictly prohibited for sectioning.** We define boundaries through background color shifts.
- Use `surface-container-low` (`#F5F3F3`) to define large sidebars or secondary zones.
- Use `surface-container-high` (`#EAE8E7`) to set off interactive or dynamic areas.

### The "Glass & Gradient" Rule
For terminal headers and floating status cards, apply a **Glassmorphism** effect:
- Use `surface` at 80% opacity with a `backdrop-filter: blur(12px)`.
- **Signature Texture:** When using Primary Red for CTAs or Hero Indicators, apply a subtle linear gradient from `primary` (`#950F1C`) to `primary-container` (`#B72C31`). This adds a "machined" depth that flat red cannot achieve.

---

## 3. Typography
The system uses a high-contrast pairing to distinguish between "Narrative" (Serif) and "Utility" (Sans-Serif).

- **Display & Headlines (Noto Serif):** These are the "Voice" of the system. Use these for terminal titles, large metric labels, and high-level summaries. The serif adds a layer of corporate history and trustworthiness.
- **Titles & Body (Plus Jakarta Sans):** These are the "Engine." Use these for data points, purchase values, timestamps, and terminal statuses. The modern geometric sans ensures that numbers remain legible even from 15 feet away.

---

## 4. Elevation & Depth
In this system, depth is a tool for focus, not just decoration.

### The Layering Principle
We achieve hierarchy by stacking surfaces. A `surface-container-lowest` card placed atop a `surface-container-low` background provides a soft, natural lift. No borders are required to signify the "edge" of the data.

### Ambient Shadows
When an element must float (such as a critical alert or a persistent summary card), use the **Ambient Shadow** profile:
- **Shadow-md:** `0 12px 32px -4px rgba(27, 28, 28, 0.08)`
- The shadow is intentionally extra-diffused and low-opacity, mimicking natural light falling on fine paper rather than a digital drop shadow.

### The "Ghost Border" Fallback
If high-contrast TV signage requires a boundary for accessibility, use a **Ghost Border**: `outline-variant` (`#E1BEBC`) at **20% opacity**. It should be felt, not seen.

---

## 5. Components

### Buttons & Indicators
- **Primary:** `primary` background with `on-primary` text. No border. Subtle 4px radius (`md`).
- **Indicator Chips:** Use `primary-fixed` (`#FFDAD7`) as a background for "Critical" status, paired with `on-primary-fixed` (`#410005`) for maximum contrast.

### The "Purchase Card"
Cards must not use divider lines. 
- **Separation:** Use `spacing-6` (1.5rem) of vertical white space between content blocks.
- **Contextual Nesting:** Use a `surface-container-highest` header area within the card to house the metadata, while the main purchase value sits on `surface-container-lowest`.

### Terminals & Lists
- **Layout:** Forbid 1px dividers. Instead, alternate rows using `surface` and `surface-container-low` background colors (zebra striping) but with a subtle 50% opacity on the alternate row to keep it sophisticated.
- **Data Columns:** Right-align all numerical data using `Plus Jakarta Sans` for tabular alignment.

---

## 6. Do's and Don'ts

### Do:
- **DO** use the `display-lg` (Noto Serif) for massive single-digit indicators.
- **DO** leverage `surface-bright` for the main canvas to ensure the TV signage doesn't feel "dim" in a bright lobby.
- **DO** use asymmetric layouts—place the primary purchase indicator off-center to create a dynamic, modern feel.

### Don't:
- **DON'T** use pure black (#000000) for text. Always use `on-surface` (`#1B1C1C`) to maintain tonal harmony.
- **DON'T** use sharp corners. Stick to the `md` (0.375rem) roundedness scale to soften the industrial nature of the data.
- **DON'T** use 100% opaque borders. They clutter the screen and distract from the high-contrast data required for terminal signage.