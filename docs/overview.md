# Overview

## What this is

**VisualGrilling** is a Codex and Claude Code skill for visual project grilling: a tough review in which the agent asks questions that can determine whether a project survives, grades answers, and probes weak spots.

The interaction takes place on a browser map:

- The agent works in the user's **current Codex or Claude Code session**, without an additional API key.
- The map is a local page at `http://127.0.0.1:<port>/`, served by `grill.mjs`.
- The browser queues events on the local server; the agent retrieves them with `wait` calls or a background `watch` on hosts with automatic wake-up and responds with `apply`.

## User workflow

1. In the project, ask Claude Code to `grill my project`, or ask Codex `$grill grill my project`. You can include an idea brief.
2. Following `SKILL.md`, the agent selects the language of the request before running `grill.mjs start`. The browser opens with a localized loading message.
3. The agent reads the README, code, and configuration, then sends `init`: title, brief, MVP architecture, and exactly five main questions (P1–P5, most critical first).
4. Answer on the map with an option or free text. Answers are queued; you can submit several without waiting.
5. The agent repeats `wait → grade → apply`, assigning Closed / Weak / Gap / Verify, explaining the verdict, and adding follow-up questions. Code claims are checked against files. The discussion tab lets you clarify or dispute a verdict without grading or changing status.
6. Add three main questions sends `more`. Stop in the header (visible only while the agent is connected) and Finish and get the summary in the summary panel both send `finish`; the agent supplies a verdict, three risks, three checks for the week, and saves `.grill/<name>/report.md`.
7. If the session closes or the agent stops after about 30 idle minutes in blocking mode, ask it to `continue grilling`. State and queued events are preserved.

A project can have several named maps, such as `arch` and `money`, each in `.grill/<name>/`. Ask which grillings exist to list them (`grill.mjs list`), or `continue grilling money` to resume one. At levels 1/2, one session can serve several maps; level 0 (Codex) requires separate sessions. Use the header switcher to visit sibling maps. Finishing drains queued actions, then stops listening while leaving the page readable.

## Language

The agent uses the language of the user's launch request for the page, questions, options, verdicts, discussion replies, summary, report, and generated specification. An explicit requested language takes precedence. Language is stored per map and survives restart and `init`; resuming with an explicit launch request selects the language again. Merely answering in another language does not switch the interface.

English and Russian UI dictionaries are built in. Other languages use a complete plain-text dictionary supplied by the agent before opening the page. Legacy maps default to Russian until a language is selected. Developer documentation is in English.

## Question statuses

At any stage, Create spec generates an implementation plan from graded answers at `docs/specs/grill-<name>.md`. Update spec rebuilds the entire file; manual edits are replaced and unrelated documents are protected. Grilling continues. Without an agent, the request waits in the saved queue.

| Code | English label | Meaning |
|---|---|---|
| `open` | Open | No answer yet |
| `ok` | Closed | Specific, convincing answer |
| `weak` | Weak | Vague or flawed answer |
| `gap` | Gap | No substantive answer |
| `verify` | Verify | Based on an untested assumption |

Queued and Reviewing are visual processing states stored in `node.pending`, not question statuses.

## Repository layout

```text
skills/grill/          working skill; edit this copy
  SKILL.md             map setup and waiting/dispatch loops
  worker.md            shared grading and event-handling rules
  config.default.json  default griller model (inherit)
  grill.mjs            HTTP server and CLI bridge
  ui.html              self-contained vanilla JavaScript map template
  i18n.mjs             locale validation and page rendering
  locales/en.json      English translations; keys are Russian source phrases
test-project/          simulator workspace (.gitkeep is tracked; application sources are absent)
dev/                   simulator, linking, reset, and API checks
  fixtures/init.json   simulator's initial questions
docs/                  developer documentation
Examples/              original claude-grill reference; leave untouched
CLAUDE.md              Claude Code context and documentation links
AGENTS.md              Codex instructions and documentation links
package.json           npm scripts; no dependencies
```

Requires Node 18+ (`fetch` and `AbortSignal.timeout`). No build step, linter, or automated test framework is configured; standalone API checks are available.

Use `npm run link:codex` for the test workspace or `npm run link:codex:global` to also link `~/.agents/skills/grill`. Invoke with `$grill grill my project`. `link` and `link:global` are the Claude Code equivalents. After installation, restart the host; the agent starts the server itself.
