## Eto layout

- For a left-aligned label in a `DynamicLayout`, set `label.TextAlignment = forms.TextAlignment.Left` and place it in a nested `DynamicLayout` with `AddRow(label, None)`. This keeps the label left aligned instead of stretching it right.

## Rebuilding Rhino plug-ins

- It is always okay to rebuild and replace the installed `.rhp` under Rhino's Application Support directory while Rhino is running. Rhino uses the new file on its next plug-in load or application restart; replacing the file does not replace an assembly already loaded in the current process. Do not block build/install scripts solely because Rhino is open.

## Testing inside Rhino

- Never test whether a Rhino command or Rhino-hosted API exists by entering a guessed command directly. Ask the user for permission before creating or running any Rhino test.
- Use the sibling `../run-in-rhino` package for approved tests. If it is not installed in this project, install it editable with `uv add --dev --editable ../run-in-rhino`.
- Put test or demo code in a Python script, use `SocketConnection` and `OutputParasite` from `run_in_rhino.rhino_env`, and normally run its watcher in the foreground with `uv run rhino-watch path/to/script.py`.
- Use `--nostop` only when output from handlers must be observed after setup. In that case, do not start the watcher in the agent terminal: agents can lose its buffered output when the user stops it. Give the user the exact `uv run rhino-watch path/to/script.py --nostop` command, ask them to run it and perform the interaction, then ask them to stop it and paste the complete output back.
- For a native Rhino command, use `run_in_rhino.orchestration.run_rhino_command()` or send `run_in_rhino.utils.command_script()` through one foreground server flow. Check the returned `succeeded` value rather than inferring success from command-line text.
- Keep the foreground watcher as the only output channel. Do not use background processes, `nohup`, Terminal.app, PID files, log files, or `tail`. Do not claim a Rhino result until the user performs any required interaction and the watcher output has been observed.
