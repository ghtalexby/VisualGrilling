# VisualGrilling documentation

Context for a new session, whether human or AI. Read in this order:

1. [overview.md](overview.md) — product overview, user workflow, and repository layout.
2. [architecture.md](architecture.md) — server, CLI, UI, state model, and answer lifecycle.
3. [contract.md](contract.md) — CLI commands, HTTP API, event and `apply` formats, and length limits. This is the contract between `grill.mjs` and `SKILL.md`.
4. [development.md](development.md) — debugging with the simulator, test workspace, real Codex or Claude Code sessions, and troubleshooting.
5. [conventions.md](conventions.md) — editing rules, security, synchronization requirements, and known quirks.

The code in `skills/grill/` is the source of truth. If documentation disagrees with the code, trust the code and correct the documentation.

Documentation is in English. The browser interface follows the language of the user's launch request. Exact protocol strings, Russian CLI diagnostics, and simulator trigger phrases are quoted in their original language with English explanations where needed.

Visual explanations: [preview.md](preview.md) documents the project format, API, isolation, versions and retention.
