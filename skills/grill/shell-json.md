## Pass JSON safely

`G` expands to `node "<skill directory>/grill.mjs" <command> --name <name>`; preserve `--dir`, omit name for legacy.

Bash: quoted heredoc (`<<'EOF'`). PowerShell (including 5.1): UTF-8 stdin and a single-quoted here-string:

```powershell
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
@'
{"type":"discuss","id":"<event id>","token":"<event token>","reply":"Localized reply"}
'@ | node "<skill directory>/grill.mjs" apply --name <name>
```

Never interpolate JSON into shell code; encode JSON string newlines as `\n`.
