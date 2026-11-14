# Final summary

On `finish`, use `counts` and `problems` to write plain text in `summary` with `\n` line breaks, in the selected language:

- A one-line verdict equivalent to Viable, Viable if…, or Not viable in its current form, with a reason.
- Three main risks.
- Three checks for the coming week, each with a success criterion (for example, call 20 contractors; success means five willing to pay at least 5%).

```bash
G apply <<'EOF'
{"type":"finish","token":"<event token>","summary":"Verdict: ...\n\nRisks:\n1. ...\n\nChecks for the week:\n1. ..."}
EOF
G report
```

`G report` saves the report in the map directory (`.grill/<name>/report.md` or `.grill/report.md`) and prints its path. Tell the user the one-line verdict and path. Return to the dispatcher; it owns all waiting and stop commands.



Finish events carry `ideas` as context separately from question counts. Finish waits for saved knowledge or explicit user skip.

A new finish closes the executable boundary. Later actions stay saved but paused; do not drain or re-arm them. Explicit continuation releases them through start. In Codex monitor delegation return only prepared summary JSON; the main session applies, rearms/stops and writes report.
