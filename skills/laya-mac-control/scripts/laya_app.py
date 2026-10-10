#!/usr/bin/env python3
"""Portable Laya-Mac-style fast path for launching macOS apps."""

import argparse
import json
import platform
import re
import subprocess
import sys
import unicodedata


APP_ALIASES = {
    "Photo Booth": ("포토부스", "포토 부스", "photo booth", "photobooth"),
    "Notes": ("메모", "메모장", "notes"),
    "Google Chrome": ("크롬", "chrome", "google chrome"),
    "Safari": ("사파리", "safari"),
    "Finder": ("파인더", "finder"),
    "Calendar": ("캘린더", "달력", "calendar"),
}
LAUNCH_WORD = re.compile(r"켜|킨|열|실행|시작|\b(?:open|launch|start)\b", re.I)
NON_LAUNCH_WORD = re.compile(r"종료|닫|삭제|적어|써|기록|\b(?:quit|close|delete|write)\b", re.I)


def resolve_app(prompt: str) -> str:
    text = unicodedata.normalize("NFC", prompt).strip().casefold()
    if not text or not LAUNCH_WORD.search(text) or NON_LAUNCH_WORD.search(text):
        raise ValueError("앱 실행 요청을 인식하지 못했습니다.")

    matches = set()
    for app, aliases in APP_ALIASES.items():
        for alias in aliases:
            if re.search(
                r"(?<![a-z가-힣])"
                + re.escape(alias.casefold())
                + r"(?=$|[^a-z가-힣]|(?:를|을|은|는|이|가|과|와|앱)?\s*(?:켜|킨|열|실행|시작)|(?:과|와)\s)",
                text,
            ):
                matches.add(app)
                break
    if len(matches) != 1:
        raise ValueError("앱 이름을 하나만 명확히 지정해 주세요. 다른 앱은 --app으로 지정할 수 있습니다.")
    return matches.pop()


def launch_app(app: str, dry_run: bool = False) -> dict:
    if not app.strip():
        raise ValueError("앱 이름이 비어 있습니다.")
    result = {"engine": "fast-path-rule", "action": "launch_app", "app": app}
    if dry_run:
        result["status"] = "dry-run"
        return result
    if platform.system() != "Darwin":
        raise RuntimeError("앱 실행은 macOS에서만 지원합니다.")
    completed = subprocess.run(["open", "-a", app], capture_output=True, text=True, check=False)
    if completed.returncode:
        raise RuntimeError(completed.stderr.strip() or f"'{app}' 앱을 열지 못했습니다.")
    result["status"] = "launch-requested"
    return result


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Open a macOS app using a local Laya-Mac-style fast path")
    parser.add_argument("prompt", nargs="?", help="e.g. 포토부스 켜줘")
    parser.add_argument("--app", help="exact installed macOS application name")
    parser.add_argument("--dry-run", action="store_true", help="show the selected app without opening it")
    parser.add_argument("--json", action="store_true", help="output JSON")
    args = parser.parse_args(argv)
    if bool(args.prompt) == bool(args.app):
        parser.error("자연어 요청 또는 --app 중 하나를 지정하세요.")
    try:
        app = args.app if args.app else resolve_app(args.prompt)
        result = launch_app(app, args.dry_run)
    except (ValueError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        print(f"{result['app']}: {result['status']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
