# Traccia — design system

The single source of truth is [`src/renderer/src/styles.css`](../src/renderer/src/styles.css): every value below is a CSS custom property declared there, and components only ever use the *semantic* tokens. This document explains the decisions so the next change stays coherent. A rendered board of the tokens and components is in [`design-system.html`](design-system.html) (open it through a local static server so the stylesheet resolves).

## 1. Direction

**A dark studio tool with a single warm colour.** The neutrals are cool graphite (the same family as the app icon's tile); the only accent is *Record Red*, the colour of the icon. Red therefore means exactly one thing across the product — *recording* — and it is spent carefully: the Record/Stop button, the REC indicator, the region frame, "on" toggles, progress and the primary action of a view. Everything that is merely *selected* (sidebar item, segmented control, hover) is a neutral white tint, as in macOS dark mode, so the red always reads as the most important thing on screen.

Consequences that follow from that rule:

- **One red button per view.** Lists never contain red buttons (model downloads, permission requests are neutral). If two things look equally important, neither is.
- **Focus is neutral, never red.** A red ring on a text field reads as "invalid".
- **Destructive is red text, never a red fill.** The filled red pill is the *record* shape; "Delete" is a ghost button with red text and a red-tinted hover.
- **Errors get their own hue treatment**: `--danger-text` (a lighter red for 7:1 contrast on cards) plus a tinted border, and an alert icon — so an error card cannot be confused with the recording panel.

## 2. Identity

| | |
|---|---|
| Name | **Traccia** — Italian for *trace/track*: what the app produces (frames + pointer + clicks + speech on one timeline). Descriptor: *AI screen recorder*. |
| Mark | Ring + dot (the universal record glyph) in `--rec` on a rounded graphite tile — the app icon (`scripts/make-icons.cjs`), the `<Logo>` in the sidebar and the welcome step, and the black *template* version in the menu bar. |
| Voice | Short, concrete, second person. Labels are nouns, buttons are verbs. |

## 3. Tokens

### Colour — primitives

| Token | Value | |
|---|---|---|
| `--n-950 … --n-50` | `#0c0c0f` `#111114` `#16161a` `#1a1a1f` `#232329` `#2c2c34` `#3d3d47` `#55555f` `#858592` `#9a9aa6` `#c8c8d0` `#ececf1` | Graphite scale, cool tint |
| `--red-300/400/500/600/700` | `#f58a8d` `#ec5f63` **`#e5484d`** `#d4373d` `#b32d32` | Record Red; 500 is the icon |
| `--red-a12/a24/a40` | `rgba(229,72,77,.12/.24/.40)` | Tints for soft backgrounds and borders |
| `--green-500`, `--amber-500` | `#3ecf8e`, `#f5a524` | Status only |
| `--w-a05 … --w-a45` | white at 5–45 % | Hover / selection / focus on dark surfaces |

### Colour — semantic (what components use)

| Token | Maps to | Used for |
|---|---|---|
| `--bg` / `--bg-sidebar` / `--bg-elev` / `--bg-elev-2` | n-900 / n-850 / n-800 / n-700 | Window, sidebar, cards, controls |
| `--bg-overlay` | `rgba(22,22,26,.94)` | Floating widget, region toolbar |
| `--border` / `--border-strong` | n-600 / n-500 | Hairlines; hover/focus borders |
| `--hover` / `--selected` / `--selected-strong` | w-a05 / w-a08 / w-a12 | Row hover, active nav, active segment |
| `--text` / `--text-dim` / `--text-muted` | n-50 / n-200 / n-300 | Body, secondary, tertiary |
| `--text-on-accent` | `#fff` | Text on red fills |
| `--accent` / `--accent-hover` / `--accent-active` | red-600 / 500 / 700 | Primary button fill and states |
| `--accent-soft` | red-a12 | Tinted icon tiles |
| `--rec` | red-500 | REC dot, region frame, logo — identical to the icon |
| `--rec-glyph` | `currentColor` | The dot inside a Record button (kept for a possible two-colour scheme) |
| `--ok` / `--ok-soft` / `--ok-border` | green | Success card, badges |
| `--warn` / `--warn-soft` | amber | Warnings, pending permissions |
| `--danger` / `--danger-text` / `--danger-soft` / `--danger-border` | red-500 / red-300 / a12 / a40 | Errors, destructive buttons |
| `--focus` / `--focus-soft` | w-a45 / w-a12 | `:focus-visible` ring, input focus glow |

Contrast (WCAG 2.2 AA, checked): text `#ececf1` on any surface ≥ 13:1; `--text-dim` on cards 6.1:1; `--text-muted` on cards 4.8:1; white on `--accent` (`#d4373d`) **4.8:1** — this is why filled buttons use red-600 rather than the icon's red-500 (3.9:1); `--danger-text` on cards 7.3:1; `--ok` 8.7:1; the focus ring against every surface ≥ 3:1.

### Typography

Bundled with the app (no network): **Inter Variable** (weight + optical-size axes) for UI, **JetBrains Mono Variable** for the timer, sizes and paths. Both load from `@fontsource-variable/*` through `@import` at the top of the stylesheet, latin subsets ≈ 115 KB. System stacks remain as fallbacks.

| Token | Size | Use |
|---|---|---|
| `--fs-xs` 11 | version, fine print |
| `--fs-sm` 12 | hints, labels, section headings (uppercase, +6 % tracking), badges |
| `--fs-md` 13 | controls: buttons, inputs, segments, nav |
| `--fs-base` 14 | body |
| `--fs-lg` 16 | card titles (`h2`), large button |
| `--fs-xl` 20 / `--fs-2xl` 24 | — / page title (`h1`, −1 % tracking) |
| `--fs-timer` 40 | recording timer (mono, tabular figures) |

Line height 1.5 for text, 1.25 for headings. Weights: 400 body, 500 controls and labels, 600 headings and the big Record button.

### Space, radius, elevation, motion

- **Spacing** is a 4 pt scale: `--sp-1` 4 → `--sp-12` 48. Cards pad 20, the content column pads 32, the window's content column is 760 max. Utilities `.mt-1…5` replace inline `style` margins.
- **Radius**: `--r-sm` 6 (segments, code), `--r-md` 8 (controls, nav), `--r-lg` 12 (cards, toolbar), `--r-pill` for the big Record button, badges and switches.
- **Control heights**: `--ctl-h-sm` 26, `--ctl-h` 32, `--ctl-h-lg` 48. The whole row of a toggle is its hit target.
- **Elevation**: three shadows (`sm` for pressed segments, `md` for floating toolbars, `lg` for the widget). Surfaces are separated by tone first, shadow second.
- **Motion**: 120 ms for colour/hover, 180 ms for switches, one easing (`cubic-bezier(.2,0,0,1)`). The REC dot blinks at 1 s; indeterminate progress sweeps at 1.2 s.

## 4. Components

| Component | Classes | Rules |
|---|---|---|
| Sidebar | `.sidebar .brand .nav(.active) .version` | Logo + name at top, 16 px icons, active row = `--selected`, version in `--text-muted`. The sidebar is the drag region. |
| Page header | `.page-header > h1` | Every page has one; it is also a drag region. |
| Card | `.card(.success/.error/.info)` + `.title-row` + `.status-icon(.ok/.bad/.accent)` | Section label is an uppercase `h3`. Status cards get a tinted 32 px icon tile and a border in their hue. |
| Buttons | `.btn` `.primary` `.ghost` `.danger` `.sm` `.icon-btn` `.big` `.record` `.stop` | `.primary` = the one red action of a view. `.record`/`.stop` add the dot/square glyph. `.big` is the pill hero. Icons inside buttons are 15 px. |
| Segmented | `.segmented > button(.active)` | Active = lighter, white text, subtle shadow. Used for every enumerated setting, in Home *and* Settings. |
| Toggle | `.toggle > .text + button.switch(.on)` | A `<label>` row with a `<button role="switch">`: keyboard-operable, whole row clickable. |
| Inputs | `select`, `input[type=text|number]` | 32 px tall, `--bg-elev-2`, neutral focus glow, never stretched to full width inside a field. |
| Badge | `.badge(.ok/.warn/.bad) > .dot` | Tinted pill; the dot takes `currentColor`. |
| Progress / spinner | `.progress(.indeterminate)`, `.spinner` | Red fill; 4 px track. |
| Notice | `.notice(.ok/.warn/.error)` | Inline message with icon, selectable text. |
| Lists | `.list-item`, `.model` | Hairline-separated rows; actions on the right use `.sm` buttons. |
| Record hero | `.record-panel > .btn.primary.big.record + .hint` | Centred; the hint shows the shortcut of the selected mode as `<kbd>⌘⇧5</kbd>` / `<kbd>⌘⇧4</kbd>` (`formatShortcut`). |
| Recording panel | `.card.rec-panel > .timer(.rec-dot) + .btn.primary.big.stop` | Shown in the main window while recording. |
| Floating widget | `.controls > .time(.rec-dot) + .btn.primary.stop` | 320 × 60, overlay background, draggable. |
| Region overlay | `.region-root .region-rect .region-size .region-toolbar .region-hint` | 2 px `--rec` frame on a 40 % dim; toolbar = Record (red) + Cancel (neutral). |
| Wizard | `.wizard .steps(span.done) .feature .actions` | Progress bars in red; features use `.status-icon.accent` with the shared `<Icon>` set. |
| Icons | `<Icon name=…>` in `components/Icon.tsx` | One stroke set (Lucide outlines, 1.75 px, 24 grid): record, settings, monitor, pointer, mic, sparkles, check, x, alert, folder, file. No emoji in the UI (they render differently on Windows). |

## 5. UX review

Findings from the audit of the previous UI, with what was done.

| # | Finding | Status |
|---|---|---|
| 1 | Blue interface vs red icon: the brand colour and the primary action did not match. | **Fixed** — single red accent; the icon is unchanged. |
| 2 | Record button was blue with a white dot; the universal affordance is a red dot. | **Fixed** — red pill with dot glyph; Stop uses the square glyph. |
| 3 | "Recording complete" and "Error" cards used the same accent border; nothing distinguished success from failure except the words. | **Fixed** — `.card.success` (green, check icon) vs `.card.error` (red, alert icon); processing gets a spinner. |
| 4 | Home had no page title while Settings did. | **Fixed** — "New recording" header; both headers are drag regions. |
| 5 | Sidebar: text-only navigation, no mark tying the window to the icon. | **Fixed** — `<Logo>` + name, icons on nav items. |
| 6 | Segmented control: the *active* segment was darker than the inactive ones — reads as "pressed/disabled" on a dark UI. | **Fixed** — active is lighter, white text. |
| 7 | Toggles were `<div>`s: not focusable, not operable with the keyboard, no `disabled` semantics. | **Fixed** — `<button role="switch">` inside a `<label>` row. |
| 8 | No visible keyboard focus anywhere. | **Fixed** — global `:focus-visible` ring. |
| 9 | Shortcut shown raw as `CommandOrControl+Shift+R` in three places. | **Fixed** — `formatShortcut()` renders `⌘⇧R` (`Ctrl+Shift+R` on Windows) in `<kbd>`; the Settings field keeps the accelerator syntax because that is what the user types. |
| 10 | Same setting, different controls: format/resolution were segmented on Home and `<select>`s in Settings. | **Fixed** — shared option lists (`options.ts`), segmented in both. |
| 11 | Emoji feature icons in the wizard render inconsistently across platforms. | **Fixed** — SVG icon set. |
| 12 | Inline `style={{…}}` spacing scattered through components. | **Fixed** — spacing utilities; only dynamic values (progress width, region geometry) remain inline. |
| 13 | `user-select: none` on the whole body made error messages and paths impossible to copy. | **Fixed** — `code`, `kbd`, notices and error text are selectable. |
| 14 | Eight red "Download"/"Request" buttons in lists competed with the primary action. | **Fixed** — neutral in lists; one red button per view. |
| 15 | "Default format" in Settings and "Output format" on Home are the *same* stored value, but the wording suggests a default that Home would override per recording. | **Open** — either drop the duplicate from Settings or make Home's choice session-only. Product decision. |
| 16 | JPG frame rate: Home offers 1/2/4 as a segmented control, Settings a free number 0.25–30. Acceptable as quick vs. advanced, but the labels should say so. | **Open** — suggest "Frames per second (JPG) — advanced" hint in Settings. |
| 17 | Paths are shown absolute (`/Users/name/Movies/Traccia`); `~/Movies/Traccia` is shorter and calmer. | **Open** — needs the home directory from the main process. |
| 18 | The recent-recordings row has three actions of equal weight. | **Partly** — reveal is the default button, the two "open" actions are ghost; consider a single primary + overflow when the list grows. |
| 19 | No light theme. All tokens are semantic, so a light mapping is a `:root[data-theme=light]` block away. | **Open** |
| 20 | The Settings page is long (seven cards); with more options it will need sub-navigation or a search. | **Open** |

## 6. Working with it

- Add a colour by adding a *primitive* and mapping a *semantic* token; never use a hex in a component.
- Need a new spacing? Use the scale. If it does not fit the scale, the layout is probably wrong.
- Run `TRACCIA_SCREENSHOTS=/tmp/shots npx electron .` after a UI change to regenerate the wizard/home/settings pictures in `docs/screenshots` (throwaway profile, no permissions needed).
- Not covered yet: a light theme, Windows-specific chrome (title bar, tray), illustration style, sound.
