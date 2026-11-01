---
name: Filebridge-Lan
description: A calm local workbench for direct LAN file transfer between a Windows computer and browser clients.
colors:
  canvas: "#f3f5f9"
  surface: "#ffffff"
  surface-soft: "#f7f8fb"
  primary: "#2f7cf6"
  primary-strong: "#1f5fb8"
  ink: "#1b2533"
  ink-muted: "#5f6b7e"
  line: "#e6eaf1"
  line-strong: "#d9e0eb"
  success: "#0b7a49"
  success-soft: "#e9f9f1"
  warning: "#8a5a0a"
  warning-soft: "#fff6e6"
  danger: "#b52b30"
  danger-soft: "#fff0f0"
typography:
  display:
    fontFamily: 'Cambria, "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", Georgia, serif'
    fontSize: "1.55rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  brand:
    fontFamily: 'Cambria, "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", Georgia, serif'
    fontSize: "0.96rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  body:
    fontFamily: 'Inter, "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Segoe UI", sans-serif'
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  body-small:
    fontFamily: 'Inter, "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Segoe UI", sans-serif'
    fontSize: "0.8rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: 'Inter, "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Segoe UI", sans-serif'
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.2
  data:
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace'
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  xs: "7px"
  sm: "8px"
  md: "9px"
  lg: "10px"
  xl: "11px"
  card: "16px"
  pill: "999px"
spacing:
  xxs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "18px"
  xl: "26px"
components:
  button-primary:
    backgroundColor: "{colors.primary-strong}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "9px 14px"
    typography: "{typography.label}"
  button-ghost:
    backgroundColor: "#f4f7fb"
    textColor: "#5e6c82"
    rounded: "{rounded.md}"
    padding: "9px 14px"
    typography: "{typography.label}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "18px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "#263448"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
    typography: "{typography.body-small}"
  status-pill:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success}"
    rounded: "{rounded.pill}"
    padding: "4px 9px"
    typography: "{typography.label}"
---

# Design System: Filebridge-Lan

## Overview

**Creative North Star: "The Local Workbench"**

Filebridge-Lan should feel like a well-kept local workbench: the files, devices, connection state, and next action are visible without ceremony. It is an Operate surface, not a marketing surface. Density is moderate, hierarchy is carried by grouping and spacing, and the blue signal appears where the user can act or needs to notice a state.

The interface is calm and precise rather than expressive. White working surfaces sit on a cool, low-contrast canvas; borders do most of the separation, with shadows only supplying a soft sense of lift. The emotional promise is trust: the user should be able to tell what is local, what is paused, what is connected, and what will happen next.

The visual identity now has a deliberate two-voice relationship. A serif voice—Cambria on Windows—marks the product name and the most important headings; the working language stays in a neutral sans, with Microsoft YaHei for Chinese and a bundled Inter variable face for Latin body and compact data. The serif is a signature, not a global skin.

**Key Characteristics:**
- Cool light canvas, white task cards, thin cool-gray borders.
- Signal Blue reserved for action, active navigation, links, and current state.
- Serif brand voice against a neutral, highly legible working sans.
- Soft, low-offset elevation; never heavy floating panels.
- Dense operational controls with generous grouping space.
- Safety states read as calm system states, not generic errors.

## Colors

The palette is a cool, blue-tinted neutral field with one functional signal color and a small semantic status set.

### Primary
- **Signal Blue** (`{colors.primary}`): The bright brand signal used for non-text emphasis, progress, and the brand mark.
- **Signal Blue Ink** (`{colors.primary-strong}`): The accessible text/action variant used for primary button fills, links, and active navigation. Its white-on-blue contrast is above the small-text floor.

### Neutral
- **Cloud Canvas** (`{colors.canvas}`): The application background behind all working surfaces.
- **Paper White** (`{colors.surface}`): Cards, inputs, and the stable task surface.
- **Mist Surface** (`{colors.surface-soft}`): Quiet inset areas, secondary rows, and low-priority grouping.
- **Ink** (`{colors.ink}`): Primary text and headings.
- **Slate Muted** (`{colors.ink-muted}`): Supporting copy, metadata, inactive navigation, and descriptions.
- **Hairline** (`{colors.line}`): Default card and divider border.
- **Strong Hairline** (`{colors.line-strong}`): Controls and separators that need a slightly clearer edge.

### Semantic
- **Clear Success** (`{colors.success}` / `{colors.success-soft}`): Online, ready, completed, and paired states.
- **Amber Warning** (`{colors.warning}` / `{colors.warning-soft}`): Experimental labels, cautionary state, and attention that is not failure.
- **Signal Red** (`{colors.danger}` / `{colors.danger-soft}`): Errors, destructive actions, and genuine service faults.

### Named Rules
**The One Signal Rule.** Signal Blue marks an action or a live state; it does not decorate cards, headings, or backgrounds. If everything is blue, nothing is a signal.

**The Calm Fault Rule.** Red is for a fault the user can act on. A Public-network pause is a calm warning state, not a red error.

## Typography

The upload/download rate values, percentages, and byte counts use Cambria with tabular lining figures; the arrow indicators use the same Cambria voice. This gives the transfer metrics the same editorial serif signature as the brand and page title.

**Display Font:** Cambria (with Microsoft YaHei, PingFang SC, Noto Sans CJK SC, Georgia, serif)
**Body Font:** Inter (bundled Latin variable face; Microsoft YaHei, PingFang SC, Noto Sans CJK SC, Segoe UI for fallback)
**Label Font:** Inter / Microsoft YaHei
**Data Font:** System monospace for pairing codes, URLs, and measurement-like values

**Character:** A restrained serif signature over a neutral working sans. Cambria gives the product name and principal heading a memorable, slightly editorial confidence; the rest of the interface stays quiet and operational. Chinese glyphs continue through Microsoft YaHei, so the serif never forces a synthetic or mismatched CJK face.

### Hierarchy
- **Display** (700, 1.55rem desktop / 1.25rem under 560px, 1.2 line-height): Page title and the rare high-emphasis heading. On Windows the Latin text renders in Cambria; Chinese falls through to YaHei.
- **Brand** (700, 0.96rem, 1.1 line-height): The Filebridge name in the sidebar and the compact about section.
- **Section title** (700, 0.96rem, 1.3 line-height): Card headings; stays in the working sans so the serif remains a signature rather than a section pattern.
- **Body** (400, 1rem base; 0.8–0.82rem for dense operational copy, 1.5 line-height): Descriptions, hints, and instructions.
- **Label** (700, 0.75rem, 1.2 line-height): Navigation, controls, status, and compact labels.
- **Data** (400, 0.75rem monospace): Pairing codes, URLs, ports, and measurement-like values. Numeric status roles use tabular lining figures.
- **Operational floor:** body, meta, status, rate labels, and footer text stay at or above `0.75rem`. The only intentional micro-label is the extension badge inside a file icon; the full filename is adjacent and carries the same information.

**Type-scale note:** the implementation still contains legacy display and headline sizes outside these roles; treat those as surface-specific refinements, not new system-wide steps. The display, brand, body, label, and data roles above are the authority for new work.

### Named Rules
**The Two-Voice Rule.** Cambria is for the product name, the page title, and a small number of emphasis headings only. Body copy, buttons, labels, statuses, and file rows stay in the neutral working sans.

**The Chinese Fallback Rule.** Never force Cambria onto Chinese glyphs. Chinese headings, body text, controls, statuses, and file rows resolve through Microsoft YaHei (or the platform CJK sans fallback), preserving native readability.

**The Dense Data Rule.** Compact structural data uses Inter or monospace with lining tabular numerals. Transfer metrics (rate, percent, byte count) use Cambria tabular lining figures; do not set Chinese labels or file names in Cambria.

## Layout

The desktop shell is a fixed 208px sidebar with a fluid workspace. The workspace uses `26px` top padding and a `clamp(18px, 3vw, 38px)` horizontal gutter. Content is a single-column stack of task cards with a `16px` gap; cards use `18px` padding and `16px` corners.

The connected dashboard is deliberately single-column and task-first: files → progress → connection → nearby computers. The drop zone and transfer status occupy the first viewport; the QR/connection card follows as setup reference rather than the opening move. On a phone browser the connection card collapses to a one-line `已连接 … · 已配对` identity and never renders the QR. A single-card state such as the Public pause is capped at `760px`; a no-token connection state caps the connection card at `620px`.

At `860px` and below, the sidebar becomes a compact horizontal header and the workspace takes the full width. Navigation labels remain visible, but icons are hidden until `380px`. At `560px`, the page title drops to `1.25rem`, subtitles to `0.75rem`, the QR block stacks vertically, and controls wrap rather than compress. At `380px`, the brand name becomes visually hidden but remains available to assistive technology, and the three nav items become 44px icon-only controls with clipped text labels. Settings opens as a workspace page, and the upload diagnostic disclosure is collapsed by default.

On widths at or below `860px`, and on any coarse-pointer device, interactive controls use a minimum 44px touch target. The workspace, sidebar, footer, and floating controls account for `env(safe-area-inset-*)`; the document uses `viewport-fit=cover` and the canvas color as its browser theme color. There is no horizontal overflow at 320px, 390px, 768px, 1024px, or 1440px, including landscape at 844×390.

Horizontal rhythm is tight inside controls and generous between groups. Do not add another container layer just to create space; use the existing card and grid rhythm.

## Elevation & Depth

The system is flat with a soft lift. White cards sit above the canvas through a one-pixel `Hairline` border and a diffuse `0 3px 12px rgba(35, 55, 90, 0.04)` shadow. The effect should be barely visible at rest: enough to tell a card from the background, never enough to make each card feel like a floating window.

Primary actions carry a small blue-tinted shadow (`0 4px 12px rgba(31, 95, 184, 0.22)`) as a response to their role, not as decoration. The brand mark and the back-to-top control use a slightly stronger ambient shadow because they are small, isolated objects. The active mode tab uses a shallow `0 2px 7px rgba(35, 55, 90, 0.09)` lift inside its track.

### Named Rules
**The Border-First Rule.** At rest, separation comes from the hairline border and tonal surface difference. A shadow is a soft secondary cue, not the primary container edge.

**The No-Glass Rule.** No backdrop blur, translucent glass panels, or neon halos. Depth belongs to the light material system already present.

## Shapes

The form language is quietly rounded and tool-like: working cards use a generous `16px` radius, primary and ghost controls use `9px`, inputs use `8px`, and small icon buttons use `7px`. The brand mark and compact logo surfaces use `10px`. Pills and status chips are fully rounded (`999px`).

Borders are one pixel and cool gray; do not use thick colored side borders, hard offset shadows, or geometric cutout masks. The rounded rectangle is the recurring form, but its radius changes by role rather than by arbitrary taste.

## Components

### Buttons
- **Shape:** restrained rounded rectangle (`9px`), compact `9px 14px` padding, label-scale text at `0.82rem` / 700.
- **Primary:** Signal Blue Ink background, white text, soft blue shadow. Use for the one action that advances the task.
- **Hover / Focus:** Primary remains solid; ghost and icon controls shift to a slightly cooler surface. Focus uses a `2px` pale blue outline with `2px` offset.
- **Secondary / Ghost / Danger:** Secondary is a pale blue utility surface; ghost is a quiet `Mist Surface` with a hairline border; danger is a pale red surface with red text for destructive file actions only.

### Status Pills
- **Style:** fully rounded, `4px 9px` padding, `0.75rem` / 700 label, a `5px` leading dot.
- **State:** green for online/paired/healthy, amber for experimental or caution, red for genuine faults, neutral for unavailable. The dot and text share the semantic color; the background is the corresponding soft tint. An online pill plays one short signal-settle on its dot when it becomes active.

### Cards / Containers
- **Corner Style:** `16px` radius for top-level working cards; the drop target uses a `12px` rounded dashed boundary.
- **Background:** Paper White for top-level cards; nested regions use spacing, dividers, or a border only—never a second white card surface.
- **Shadow Strategy:** soft border-first lift as described above.
- **Border:** one-pixel Hairline.
- **Internal Padding:** `18px`; the Public pause card uses `26px 28px`.

### Inputs / Fields
- **Style:** white fill, one-pixel cooler gray border, `8px` radius, `8px 10px` padding, `0.8rem` working text.
- **Focus:** border shifts to a pale blue and gains a `3px` low-opacity blue ring.
- **Error / Disabled:** errors use red text and a pale red notice surface; disabled controls reduce opacity rather than changing their geometry.

### Navigation
- **Style:** a 208px white sidebar with a fixed foot; items are quiet `0.88rem` / 600 labels with a small icon slot.
- **States:** transparent default, cool gray hover, pale blue active surface with Signal Blue Ink text. On mobile the sidebar becomes a compact horizontal row with the same active treatment; at 380px it becomes 44px icon-only navigation with visually clipped but accessible labels.

### Mode Switch
- **Style:** a full-width inset track in a cool gray, `11px` radius, `4px` padding; each tab is `8px` radius.
- **Semantics:** a two-button `role="group"` toggle exposed through `aria-pressed`; it is not a tablist because there is no tabpanel relationship.
- **States:** the inactive tab is transparent and muted; the active tab is Paper White with a small shadow and a short authored scale/opacity entrance.

### Public Pause
- **Style:** a calm, bounded card with a serif or CJK-sans heading, muted explanatory copy, and a single network-settings action. It settles in with a short opacity/translate entrance rather than appearing as an alarm.
- **Behavior:** this is a safety state, not a service error. It must not expose LAN IP, QR, manual pairing, or a retry-loop action while Public/unknown.

### Help
- **Placement:** 使用说明 is a dialog opened from the sidebar, not a permanent card at the foot of the working page.
- **Behavior:** focus moves to the close control, Escape closes it, and the backdrop is dismissible. The guide never competes with the file list or transfer progress.

### Transfer Recovery
- **Upload:** 4MB chunks with server-side offset resume, four automatic retries, then a persistent `继续上传` action. The upload state, chunk id, and offset are retained for the current page session.
- **Batch progress:** when more than one file is selected, the progress bar reports aggregate bytes and percentage across the queue, with `第 n/N 个 · 当前文件名` in the title. Do not replace it with a per-file 100% bar.
- **Cancel:** user cancellation is a neutral `已取消` state with `重新上传`; it never reads as a transfer failure.
- **Completion:** the completed block stays visible with `打开下载文件夹`; success is not only a transient toast.
- **Failure copy:** state the recovery available (继续上传) rather than only naming an error.

### Motion
- **Focal moment:** the online status dot settles once (`signal-dot`, 520ms, exponential ease-out). It marks a real state change rather than looping for attention.
- **Continuity:** Public pause enters with `pause-settle` (360ms); new file rows settle with `file-settle` (260ms).
- **Feedback:** the drop zone lifts 2px and its plus mark grows on drag-over; toast enters with a short translate/fade; controls press 1px. Routine transitions stay at 150–240ms.
- **Bounds:** only transform, opacity, color, and soft shadow move. No layout-driving animation, no bounce, no persistent attention loop.
- **Reduced motion:** remove signal/pause/file/toast entrances and drag/press transforms; retain color and state changes so feedback remains legible.

## Do's and Don'ts

### Do:
- **Do** keep the sidebar at `208px` and the working content single-column; the task reads top to bottom.
- **Do** use Signal Blue only for primary actions, active navigation, links, and current-state emphasis.
- **Do** use Cambria for the product name, page title, and a small number of emphasis headings; let Chinese fall through to Microsoft YaHei.
- **Do** keep body and operational controls in the neutral sans stack; use Inter for English body and compact data.
- **Do** use `16px` cards, one-pixel hairlines, and the existing soft shadow rather than adding a new elevation level.
- **Do** distinguish Public pause, service fault, and unavailable host with different copy and color semantics.
- **Do** let text wrap with `text-wrap: balance` on headings and keep the 390px layout free of horizontal scroll.
- **Do** use motion for signal/state feedback only; keep the online settle one-shot and honor `prefers-reduced-motion`.
- **Do** flatten secondary regions—rate metrics, QR, disclosures, nearby empty states—into dividers and inset spacing inside a single card.

### Don't:
- **Don't** set Cambria on body copy, buttons, labels, statuses, or file lists; the serif is a signature, not the interface voice.
- **Don't** introduce a second accent color or use blue as a decorative wash.
- **Don't** use glass, blur, neon halos, gradient text, or heavy floating shadows.
- **Don't** use thick colored side borders, zero-blur hard shadows, or nested cards as a layout strategy.
- **Don't** make a safety pause look like a crash or an app-not-started error.
- **Don't** hide the current connectability behind a bare "paired" label.
- **Don't** add looping attention animations, bounce/elastic curves, or animate width/height/margins for decorative effect.
- **Don't** give secondary regions their own background, border, and radius at the same time; that reads as a card inside a card.
