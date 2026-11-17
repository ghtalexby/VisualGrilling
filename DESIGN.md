# VisualGrilling Hub interface

This document records the extension surface in `hub/extension/`. It inherits the established colors and compact controls in `skills/grill/ui.html`; it does not claim a full audit of the map interface. The development-only direction contract is `.impeccable/surfaces/hub-extension.md`.

## Color tokens

| Role | Light | Dark |
|---|---|---|
| Background | `#e9edf1` | `#0e131a` |
| Surface | `#ffffff` | `#17202b` |
| Text | `#141c28` | `#e5eaf1` |
| Secondary text | `#5a6576` | `#a5b1c3` |
| Border | `#c6ced8` | `#394657` |
| Action | `#2440c2` | `#8199ff` |
| Action text | `#ffffff` | `#0e131a` |
| Closed questions | `#1d7a4c` | `#4bc389` |
| Stale / waiting | `#895100` | `#efa83a` |
| Error | `#b12822` | `#ff6b5f` |

Use the OS color preference. Status meaning is always stated in text, including freshness and unavailable paths.

## Typography and layout

The body uses the existing Golos Text preference with system UI and Segoe UI fallbacks, 15px/1.5. The extension fetches no external fonts. The primary heading is 30px, 26px below 520px; project headings are 18px and board titles 17px. Data and times use tabular numerals. Paths wrap instead of hiding their identifying suffixes.

The page is at most 1248px wide including 24px side padding (16px on narrow screens). Project sections contain border-separated rows. At wide widths each row places identity and counts, independent statuses, then actions; below 850px actions move beneath; below 520px rows stack. Buttons use a 6px radius, 1px border and 8px/12px padding. Focus uses a 2px action-colored outline with a 3px offset.

## States and interaction

Search, active-only filtering and project grouping operate on the last known list. Active means unfinished, independent of running status. Failed refreshes retain content and identify it as stale; absence of cache is an unavailable state, not a checked empty registry. A 30-second freshness limit also marks old observations. Missing paths use an inline recovery form. Play and Stop have independent busy feedback and never replace the board title with a command status.

Chat displays actual session messages and explicit user requests. Approval details can expand; command/path/reason remain visible. Unknown request types never grant permission. Input values survive failed actions. All content is inserted as text. No shipping raster assets are used.

## Verification evidence

`dev/check-hub-extension-browser.mjs` renders production pages at 390px and 1280px with a deterministic Chrome API fixture; it checks light/dark rendering, filtering, navigation, stale and absent cache, lifecycle controls, recovery, approvals, user input and login. This fixture is not evidence of real extension installation, native registration or Codex-session acceptance.
