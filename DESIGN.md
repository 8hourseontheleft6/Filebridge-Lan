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
- **Signal Blue** (`{colors.primary}`): The bright brand signal used for non-text emphasis and progress. The logo itself is monochrome ink, not blue.
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

The desktop shell is a fixed 208px sidebar with a fluid workspace. The workspace uses `26px` top padding and a `clamp(18px, 3vw, 38px)` horizontal gutter. Content is a stack of task cards on a `16px` gap; cards use `18px` padding and `16px` corners.

The connected dashboard is task-first. Above `900px` it becomes two columns — files on the left, the transfer panels on the right, then connection / nearby — with the clipboard card spanning full width last; below `900px` the same cards stack in one column. The file list and transfer status occupy the first viewport; the QR/connection card follows as setup reference rather than the opening move. On a phone browser the connection card collapses to a one-line `已连接 … · 已配对` identity and never renders the QR. A single-card state such as the Public pause is capped at `760px`; a no-token connection state caps the connection card at `620px`.

At `860px` and below, the sidebar becomes a compact horizontal header and the workspace takes the full width. Navigation labels remain visible, but icons are hidden until `380px`. At `560px`, the page title drops to `1.25rem`, subtitles to `0.75rem`, the QR block stacks vertically, and controls wrap rather than compress. At `380px`, the brand name becomes visually hidden but remains available to assistive technology, and the three nav items become 44px icon-only controls with clipped text labels. Settings opens as a workspace page, and the upload diagnostic disclosure is collapsed by default.

On widths at or below `860px`, and on any coarse-pointer device, interactive controls use a minimum 44px touch target. The workspace, sidebar, footer, and floating controls account for `env(safe-area-inset-*)`; the document uses `viewport-fit=cover` and the canvas color as its browser theme color. There is no horizontal overflow at 320px, 390px, 768px, 1024px, or 1440px, including landscape at 844×390.

Horizontal rhythm is tight inside controls and generous between groups. Do not add another container layer just to create space; use the existing card and grid rhythm.

## Elevation & Depth

The system is flat with a soft lift. White cards sit above the canvas through a one-pixel `Hairline` border and a diffuse `0 3px 12px rgba(35, 55, 90, 0.04)` shadow. The effect should be barely visible at rest: enough to tell a card from the background, never enough to make each card feel like a floating window.

Primary actions carry a small blue-tinted shadow (`0 4px 12px rgba(31, 95, 184, 0.22)`) as a response to their role, not as decoration. The back-to-top control uses a slightly stronger ambient shadow because it is a small, isolated object; the brand mark itself is flat artwork with no shadow or plate. The active mode tab uses a shallow `0 2px 7px rgba(35, 55, 90, 0.09)` lift inside its track.

### Named Rules
**The Border-First Rule.** At rest, separation comes from the hairline border and tonal surface difference. A shadow is a soft secondary cue, not the primary container edge.

**The No-Glass Rule.** No backdrop blur, translucent glass panels, or neon halos. Depth belongs to the light material system already present.

## Shapes

The form language is quietly rounded and tool-like: working cards use a generous `16px` radius, primary and ghost controls use `9px`, inputs use `8px`, and small icon buttons use `7px`. The logo artwork itself is not a rounded tile; it inherits no plate, radius, gradient, or shadow. Pills and status chips are fully rounded (`999px`).

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
- **Corner Style:** `16px` radius for top-level working cards; the drop overlay frame uses a `12px` rounded dashed boundary.
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

### Transfer Modes (sidebar)
- **Structure:** transfer method is chosen in the sidebar (`传输方式` group), not by a top-of-page tab track: `局域网直传` is the primary item, and `跨网络中继` follows as a deliberately secondary item — muted text color, lighter weight, and an `实验` badge pushed to the right edge.
- **Availability:** the relay entry only renders inside the desktop app. A browser client (the phone page) shows only `局域网直传`, `使用说明`, and `设置`, and never fetches the relay bundle.
- **Relay notice:** selecting the relay shows one `mode-notice` banner above the workspace — the experimental warning plus a `返回局域网直传` action — instead of a persistent toggle. Keep it a calm note, not an error.
- **Why not a tab track:** a two-tab `role="group"` switch gave the experimental relay the same visual weight as the default LAN path. Do not reintroduce it.

### Public Pause
- **Style:** a calm, bounded card with a serif or CJK-sans heading, muted explanatory copy, and a single network-settings action. It settles in with a short opacity/translate entrance rather than appearing as an alarm.
- **Behavior:** this is a safety state, not a service error. It must not expose LAN IP, QR, manual pairing, or a retry-loop action while Public/unknown.

### Help
- **Placement:** 使用说明 is a dialog opened from the sidebar, not a permanent card at the foot of the working page.
- **Behavior:** focus moves to the close control, Escape closes it, and the backdrop is dismissible. The guide never competes with the file list or transfer progress.

### Transfer Recovery
- **Upload:** 4MB chunks (2MB on iOS Safari) with server-side offset resume, four automatic retries, then a persistent `继续上传` action. The upload state, chunk id, and offset are retained for the current page session.
- **Batch progress:** when more than one file is selected, the block reports aggregate bytes across the queue with `总进度 · 第 n/N 个` in the title, and the per-file percentage is dropped rather than faked. Do not add a per-file 100% bar on top.
- **Cancel:** user cancellation is a neutral `已取消` state; the same circular slot turns into `重新上传`, with no explanatory sentence added.
- **Completion:** the finished block holds for about `1.6s` showing `已上传`, then collapses with the `.reveal` height transition. Desktop downloads still offer `打开下载文件夹`; success is not only a transient toast.
- **Failure copy:** state the recovery available (继续上传) rather than only naming an error.

### Transfer Panels (1.6.0)

The transfer readout is two equal cards, one per direction, not a single shared meter. They are documented here as the existing implementation, not as a new direction: the palette, the two-voice typography, the border-first material system, and the `16px` card + `9px` control radii all stay as they are.

- **Rate panels.** Upload and download are separate `.rate-panel` cards side by side in `.progress-column`, one blue and one green; the column carries `min-height: 300px` at `≥900px` so the pair lines up with the file card. Every card carries, top to bottom: a label row (`.rate-head` — direction icon + label on the left, `峰值` on the right), the live rate (`.rate-value`), the cumulative total (`.rate-total`, `累计 …`), the optional transfer blocks, and a bottom 24-sample `.rate-chart` fill-and-line sparkline (`62px` tall, bled to the card edges). The chart is anchored to the card's bottom edge and is tinted per direction; an idle card dims the chart rather than hiding it.
- **Idle state.** `.progress-column.is-idle` drops the rate values to muted weight and lowers the chart opacity. Idle is a calm resting state, not an empty placeholder — keep the numbers legible so the user can still read `0 B/s` and the last cumulative total.
- **Progress blocks.** Inside a card, each transfer is one `.progress-block`. Its first row is `.progress-row`: a `.progress-title` on the left (truncating with an ellipsis; `上传中` / `已上传` / `总进度 · 第 n/N 个` / `接收中` / `保存中`) and a `.progress-row-end` group on the right that holds the percentage plus the circular action (`✕` cancel, `↻` retry). The second row is `.progress-meta`: bytes `loaded / total`, the remaining-time hint, and the status text. Percentage and meta stay on the title baseline, so a long filename never pushes the cancel control off the row.
- **Stacked blocks.** When a download is both arriving and being written to disk, the download card shows two blocks at once — `接收中` and `保存中` — separated by a `1px` divider and `12–13px` of space. Do not merge them into one bar: the two phases can finish at different times and the user needs to see which one is still running.
- **File list.** `.file-list-wrap` is a flex region that fills its card, and the inner `.file-list` is capped at `max-height: 300px` with its own scroll. At `≥900px` the files card itself is `300px` tall so the list and the transfer panels share one aligned band; rows (`.file-row`) never compress to fit. A row reads as `.file-select` checkbox → `.file-ext` extension badge → `.file-name` + `.file-status` metadata (`size · SHA-256 prefix…`) → `.file-actions`. The empty state is written inside this list (`.file-list-empty`), not as a separate dashed drop zone.
- **Selection target.** The drawn checkbox is `14px`, but it sits in a `.file-select-hit` label box so the clickable area can grow without moving the row: `44px` hit area at `≤860px` or on a coarse pointer, with the box itself drawn at `18px`. Never enlarge the visible square to `44px` — that would re-break the row rhythm.
- **Drop overlay.** Dragging over the window raises one full-window `.drop-overlay`: a translucent veil, an `inset: 12px` `2px` dashed frame at `12px` radius, and a centered `.drop-overlay-card` with a round plus icon. The entrance is an authored sequence (veil → frame settle → card rise → plus pop) and the exit is faster; `prefers-reduced-motion` removes the animation but keeps the static veil, frame, and card. There is no per-page dashed drop box anymore.
- **Round icon buttons.** `.btn-icon-round` is a `32px` circle (`999px` radius, centered icon) used for row-header and in-progress actions: select-all, choose files, open download folder, refresh, rotate pairing code, cancel, retry. On `≤860px` or any coarse pointer it becomes `44px`; inside `.progress-row-end` the touch size is `36px` so the row still fits. Destructive and batch actions keep their text-button form.
- **Clipboard card.** The clipboard sync panel is its own low-priority card, ordered last in the dashboard (never inside the upload diagnostic). Above `900px` it spans both columns and splits into a latest-text pane and a compose pane; on narrow layouts it stacks and keeps only the text actions.

### Motion
- **Focal moment:** the online status dot settles once (`signal-dot`, 520ms, exponential ease-out). It marks a real state change rather than looping for attention.
- **Continuity:** Public pause enters with `pause-settle` (360ms); new file rows settle with `file-settle` (260ms).
- **Feedback:** drag-over raises the full-window `.drop-overlay` (veil 180ms, frame settle 360ms, target rise 360ms, plus pop 260ms) and drops it faster on release; toast enters with a short translate/fade; controls press 1px. Routine transitions stay at 150–240ms.
- **Bounds:** only transform, opacity, color, and soft shadow move. No layout-driving animation, no bounce, no persistent attention loop.
- **Reduced motion:** remove signal/pause/file/toast entrances and drag/press transforms; retain color and state changes so feedback remains legible.

## Do's and Don'ts

### Do:
- **Do** keep the sidebar at `208px`; keep the working content one column below `900px` and the two-column (files | transfer) grid above it, so the task still reads top to bottom.
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

### Brand Mark and App Icon

**The mark.** A single handwritten `F` with a quarter-round local-network signal (three arcs plus a dot) in the lower right, drawn on a 2048-unit artboard. It is the only product logo; there is no letter tile, plate, gradient, shadow, glass, folder, computer, arrow, or wordmark inside the artwork. "Filebridge Lan" is set in Cambria next to the mark, never inside it.

**Source of truth.** `scripts/brand/render_mark.py` holds the master geometry; `scripts/brand/export_brand.py` exports every raster and vector from it. Every ICO frame is rendered from the vector master, not downscaled from the 256px frame.

| File | Use |
|---|---|
| `src/assets/brand/filebridge-lan-logo-black.svg` (and `.png`, `.ico`) | Light surfaces: sidebar brand, light backgrounds, light taskbars |
| `src/assets/brand/filebridge-lan-logo-white.svg` (and `.png`, `.ico`) | Dark surfaces only: relay receiver header, dark backgrounds |
| `src/assets/brand/filebridge-lan-app-icon.svg` (and `.png`, `.ico`) | White rounded plate with the black mark: favicon, window icon, taskbar, Start menu, NSIS installer |
| `docs/design/brand/` | Archived design assets, same master |

The black and white versions are colour variants of one master and must never change shape. The app icon is white-plate + black mark; a blue app icon is not part of the system.

**Weight.** The `F` stem carries about 12% more weight than the original sketch and the middle bar about 10%, so the mark holds its own against the Cambria wordmark without ever out-shouting it. The top bar, the hand-drawn taper, the dry-brush edges, and the dot proportion are unchanged.

**Size ladder.** 16, 20, 24, 32, 40, 48, 64, 128, 256 px, all rendered from the master.

- 16–24 px: +5% extra stem weight so the `F` never breaks up.
- 16 and 20 px: only the inner signal arc plus a small dot, so the dot never becomes an ink block.
- 32 px and above: the full three-arc signal.
- The mark reads at 16 px on both light and dark backgrounds.

**Surface rules.**

- Light background: black transparent mark.
- Dark background: white transparent mark; never use the white mark on light surfaces.
- Favicon, window icon, taskbar, Start menu, and installer: the white-plate app icon, so it stays legible on both light and dark Windows taskbars.
- The old letter-tile `F` (blue gradient square, white letter, blue shadow) is retired.

**In code.** `src/components/BrandMark.tsx` is the only place the logo paths are referenced; callers pass `tone="ink"` (light surfaces) or `tone="inverse"` (dark surfaces). Do not re-create the mark as text, CSS, or an inline duplicate.