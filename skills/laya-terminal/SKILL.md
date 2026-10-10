---
name: laya-terminal
description: Use Korean natural-language terminal commands such as `laya 메모 켜줘` to launch Mac apps, read the LAYA local notification engine, and perform basic macOS or Windows tasks. Natural-language app launch requires the laya-mac-control skill, while OS commands work without the LAYA app.
---

# LAYA terminal

This is a Codex skill and a small Python CLI companion. It is not an upstream LAYA CLI. Bare Korean app-launch requests use the installed `laya-mac-control` skill's deterministic helper. The `app` commands read the local REST API of [aayushch/laya](https://github.com/aayushch/laya) when its engine is running; the `os` commands use native macOS or Windows facilities independently.

## Use

On this Mac, call `laya` in the terminal. On another machine, run `python3 scripts/laya.py` on macOS or `py -3 scripts/laya.py` on Windows from this skill folder. Python 3.9 or later is required for this companion script. Run `laya --help` for the current command list.

For natural-language app launch on macOS, install the separate `laya-mac-control` skill alongside this skill. Use `laya 메모 켜줘`, `laya 포토부스 켜줘`, or `laya 크롬 실행해` without quotes. Use `laya --dry-run 메모 켜줘` to preview the selected app. The command previews the app choice before execution and reports `launch-requested` after macOS accepts the open request. It supports app launch only; other natural-language system actions are rejected. Its `fast-path-rule` engine is a deterministic alias resolver, not Laya-MLX inference.

| Task | Command |
| --- | --- |
| Launch Notes using Korean | `laya 메모 켜줘` |
| Preview an app request | `laya --dry-run 크롬 실행해` |
| OS details | `laya os info` |
| Open a file, app, or URL | `laya os open TARGET` |
| Reveal a file in Finder or Explorer | `laya os reveal PATH` |
| Read clipboard | `laya os clipboard read` |
| Write clipboard | `laya os clipboard write 'text'` or pipe text to `laya os clipboard write` |
| List a folder | `laya os files list PATH` |
| LAYA engine health | `laya app health` |
| LAYA cards | `laya app cards --status pending --limit 10` |
| LAYA daily summary | `laya app summary --date YYYY-MM-DD` |
| LAYA Omni snapshot | `laya app omni --space-id default` |

Responses from `app`, `os info`, and `os files list` are JSON. LAYA's default endpoint is `http://127.0.0.1:8420`. Set `LAYA_BASE_URL` or pass `--base-url` before `app` if a local engine uses another port; only HTTP loopback addresses are accepted. If the engine is not running, report that the LAYA commands are unavailable, and continue with OS commands when useful.

## Operating boundaries

- Use the `app` commands for reads only. Do not infer permission to approve cards, send messages, or change LAYA settings.
- Confirm the exact target before opening a URL or app if the user's request did not identify it. Treat clipboard contents as potentially sensitive; only read or write them when requested for the task.
- For OS tasks outside this command set, choose the native terminal tool appropriate to the host instead of claiming LAYA implements the action.
- Windows support is provided by the Python script, but must be installed and verified on a Windows machine separately. Do not claim that this Mac run proves Windows behavior.
