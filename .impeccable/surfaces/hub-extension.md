# Hub extension

Target: hub/extension/index.html; related: chat.html, styles.css. Mode: Operate.

## Direction contract

THESIS: A working list of persistent boards makes return, inspection and lifecycle control immediate. Status columns explain what is actually observed.

OWN-WORLD: Inherit ui.html's cool neutral ground, white or dark slate surface, blue action accent, modest outlined controls, restrained semantic colors and system UI fallback. No remote fonts or image assets are needed in the extension.

STORY: Find a board across projects, distinguish completion from availability and connection, then open or explicitly start/stop. Failures retain the user's last list and show recovery instructions.

FIRST VIEWPORT: Compact brand header, page title, search with active/group filters, freshness strip, then project-grouped horizontal board rows with counts, three independent status lines and right-aligned actions. At narrow widths each row stacks in reading order. Path recovery expands inline. Refresh keeps search, focus and existing content intact.

FORM: seed: none (pinned). Brief: "Search/group/active controls, clear status/time, busy/error feedback without losing list" and "visually restrained Operate UI matching existing ui.html identity". The existing system is extended, not replaced. A Windows user checks work throughout the day; follow the OS light/dark preference to match the surrounding Chrome workspace.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

This ordinary extension preserves the incumbent system; its code and captured narrow/wide renders are the documentation evidence. No shipping raster assets.
