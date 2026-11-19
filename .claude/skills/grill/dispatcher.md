# Retired level 2 compatibility entry

Per-event delegation is retired. The bound primary session reads, prepares, preflights and applies each event using [worker.md](worker.md) and [handoff.md](handoff.md). Do not select level 2 or start child agents.

Codex uses [hybrid.md](hybrid.md) by default or [monitor.md](monitor.md) on explicit request. Other hosts use inline level 1 with verified background wake-up, otherwise inline level 0; see [SKILL.md](SKILL.md#41-level-1-background-wait). Supported level 1 multi-map handling remains sequential under [parallel-maps.md](parallel-maps.md).
