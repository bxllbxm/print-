---
name: laya-mac-control
description: Control a Mac through an installed Laya-Mac CLI from Codex, including launching Photo Booth, Notes, and Chrome. On Macs without that CLI, use the bundled helper for app launch only. Do not use for unrelated app content editing.
---

# Laya Mac Control

This is a **Codex skill**. When the user asks Codex to open a Mac app or perform a supported Laya-Mac system action, choose the verified local route and complete the request.

## Runtime selection

1. Check whether the Mac has a usable Laya-Mac CLI. A `laya` shell alias may exist only in interactive zsh, so do not assume `command -v laya` in a noninteractive shell proves it is absent. Inspect the actual executable or alias target without hardcoding another user's path.
2. If available, run the user's request through Laya-Mac, for example `laya run '포토부스 켜줘' --dry-run --json` followed by `laya run '포토부스 켜줘' --json`. Use the resolved CLI file directly when `laya` is only a shell alias. Check `action`, `params`, and `engine` before execution. Execute only the action the user requested, then inspect the result and, for app launch, the actual window when a native app tool is available.
3. If Laya-Mac is unavailable and the user requested **only app launch**, use this skill's `scripts/laya_app.py`. It resolves common app names locally and invokes macOS `open -a` without a model:

   ```bash
   python3 scripts/laya_app.py '포토부스 켜줘' --dry-run --json
   python3 scripts/laya_app.py '포토부스 켜줘' --json
   python3 scripts/laya_app.py '메모 열어줘' --json
   python3 scripts/laya_app.py '크롬 실행해' --json
   ```

   Run the helper from this skill directory. For another installed app, use `--app 'Exact macOS App Name'`. It rejects ambiguous and non-launch requests.
4. If Laya-Mac is unavailable for another kind of Mac control, say that the required runtime is missing. Do not present the app-launch helper as full Laya-Mac or Laya-MLX.

## Result and permission checks

- A CLI `open -a` success code means launch was requested. Verify a visible app window when possible. If no window appears, use an available native app tool to launch it and check again; otherwise report only the launch request.
- Read the `engine` field. `fast-path-rule` is deterministic routing, not Laya-MLX inference. Report model use only when the actual result says `laya-mlx`.
- Keep Laya-Mac's safety guard in place. Never add `--confirm` automatically for deletion, app quit, screen locking, or another guarded action. Check the current user's authorization at the action point.
- Opening Notes does not authorize writing a note; opening Chrome does not authorize a search or navigation. Use the appropriate app or browser tool for those separate requests.

Requires macOS and Python 3 for the bundled app-launch helper. The helper has no third-party dependencies.
