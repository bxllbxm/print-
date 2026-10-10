#!/usr/bin/env python3
"""Small cross-platform terminal companion for Laya and local OS tasks."""

import argparse
import json
import os
import platform
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def print_json(value):
    print(json.dumps(value, ensure_ascii=False, indent=2))


def require_loopback(base_url):
    parsed = urllib.parse.urlparse(base_url)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("Laya API base URL must be an HTTP loopback address")
    if parsed.username or parsed.password or parsed.path not in {"", "/"}:
        raise ValueError("Laya API base URL must contain only the loopback host and port")
    return base_url.rstrip("/")


def get_laya(base_url, endpoint, params=None):
    base_url = require_loopback(base_url)
    query = urllib.parse.urlencode({key: val for key, val in (params or {}).items() if val is not None})
    url = base_url + endpoint + ("?" + query if query else "")
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            return json.load(response)
    except urllib.error.URLError as exc:
        raise RuntimeError("LAYA 엔진에 연결할 수 없습니다. 로컬 엔진 실행 상태를 확인하세요: " + str(exc))


def list_files(path):
    directory = Path(path).expanduser().resolve()
    if not directory.is_dir():
        raise ValueError("디렉터리가 아닙니다: " + str(directory))
    entries = [
        {"name": item.name, "type": "directory" if item.is_dir() else "file"}
        for item in sorted(directory.iterdir(), key=lambda item: item.name.lower())
    ]
    return {"path": str(directory), "entries": entries}


def clipboard(action, value=None):
    if sys.platform == "darwin":
        command = ["pbpaste"] if action == "read" else ["pbcopy"]
    elif os.name == "nt":
        command = ["powershell.exe", "-NoProfile", "-Command", "Get-Clipboard -Raw" if action == "read" else "Set-Clipboard -Value ([Console]::In.ReadToEnd())"]
    else:
        raise RuntimeError("클립보드는 현재 macOS와 Windows에서 지원합니다")
    result = subprocess.run(command, input=value if action == "write" else None,
                            text=True, capture_output=True, check=True)
    return result.stdout if action == "read" else None


def open_target(target, reveal=False):
    if reveal:
        target = str(Path(target).expanduser().resolve())
        if not Path(target).exists():
            raise ValueError("경로가 없습니다: " + target)
    if sys.platform == "darwin":
        subprocess.run(["open", "-R", target] if reveal else ["open", target], check=True)
    elif os.name == "nt":
        if reveal:
            subprocess.run(["explorer.exe", "/select," + target], check=True)
        else:
            os.startfile(target)
    else:
        raise RuntimeError("열기는 현재 macOS와 Windows에서 지원합니다")


def run_app_request(argv):
    parser = argparse.ArgumentParser(prog="laya", description="macOS 앱 실행 요청")
    parser.add_argument("--dry-run", action="store_true", help="실행할 앱만 확인")
    parser.add_argument("prompt", nargs="+", help="예: 메모 켜줘")
    args = parser.parse_args(argv)
    if sys.platform != "darwin":
        raise RuntimeError("자연어 앱 실행은 현재 macOS에서만 지원합니다")

    codex_home = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
    helper = codex_home / "skills" / "laya-mac-control" / "scripts" / "laya_app.py"
    if not helper.is_file():
        raise RuntimeError("laya-mac-control 스킬의 앱 실행 도우미가 없습니다")

    prompt = " ".join(args.prompt)
    command = [sys.executable, str(helper), prompt, "--json"]
    preview = subprocess.run(command + ["--dry-run"], capture_output=True, text=True)
    if preview.returncode:
        raise RuntimeError(preview.stderr.strip() or "앱 실행 요청을 인식하지 못했습니다")
    choice = json.loads(preview.stdout)
    if choice.get("action") != "launch_app" or not choice.get("app") or choice.get("status") != "dry-run":
        raise RuntimeError("앱 실행 미리보기 결과가 올바르지 않습니다")
    if args.dry_run:
        print_json(choice)
        return

    completed = subprocess.run(command, capture_output=True, text=True)
    if completed.returncode:
        raise RuntimeError(completed.stderr.strip() or "앱을 열지 못했습니다")
    result = json.loads(completed.stdout)
    if result.get("action") != "launch_app" or result.get("app") != choice["app"]:
        raise RuntimeError("앱 실행 결과가 미리보기와 다릅니다")
    print_json(result)


def build_parser():
    parser = argparse.ArgumentParser(
        prog="laya",
        description="LAYA 로컬 API 및 macOS/Windows 기본 기능",
        epilog="macOS 앱 실행 예: laya 메모 켜줘 | laya --dry-run 메모 켜줘",
    )
    parser.add_argument("--base-url", default=os.environ.get("LAYA_BASE_URL", "http://127.0.0.1:8420"))
    section = parser.add_subparsers(dest="section", required=True)

    app = section.add_parser("app", help="실행 중인 LAYA 엔진 조회")
    app_commands = app.add_subparsers(dest="command", required=True)
    app_commands.add_parser("health", help="엔진 상태")
    cards = app_commands.add_parser("cards", help="알림 카드 목록")
    cards.add_argument("--status")
    cards.add_argument("--priority")
    cards.add_argument("--limit", type=int, default=20)
    summary = app_commands.add_parser("summary", help="일일 요약")
    summary.add_argument("--date")
    omni = app_commands.add_parser("omni", help="Omni 요약")
    omni.add_argument("--space-id", default="default")

    system = section.add_parser("os", help="macOS/Windows 기본 기능")
    os_commands = system.add_subparsers(dest="command", required=True)
    os_commands.add_parser("info", help="운영체제 정보")
    opener = os_commands.add_parser("open", help="파일, URL 또는 앱 열기")
    opener.add_argument("target")
    reveal = os_commands.add_parser("reveal", help="Finder/Explorer에서 파일 표시")
    reveal.add_argument("path")
    clip = os_commands.add_parser("clipboard", help="클립보드 읽기/쓰기")
    clip_commands = clip.add_subparsers(dest="action", required=True)
    clip_commands.add_parser("read")
    write = clip_commands.add_parser("write")
    write.add_argument("text", nargs="?")
    files = os_commands.add_parser("files", help="파일 조회")
    file_commands = files.add_subparsers(dest="action", required=True)
    listing = file_commands.add_parser("list")
    listing.add_argument("path", nargs="?", default=".")
    return parser


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    try:
        if argv and argv[0] not in {"app", "os", "-h", "--help", "--base-url"}:
            run_app_request(argv)
            return 0
        args = build_parser().parse_args(argv)
        if args.section == "app":
            if args.command == "health":
                result = get_laya(args.base_url, "/health")
            elif args.command == "cards":
                if not 1 <= args.limit <= 200:
                    raise ValueError("--limit 값은 1부터 200까지 가능합니다")
                result = get_laya(args.base_url, "/cards", {"status": args.status, "priority": args.priority, "limit": args.limit})
            elif args.command == "summary":
                result = get_laya(args.base_url, "/summary", {"date": args.date})
            else:
                result = get_laya(args.base_url, "/omni", {"space_id": args.space_id})
            print_json(result)
        elif args.command == "info":
            print_json({"platform": platform.system(), "release": platform.release(), "architecture": platform.machine()})
        elif args.command == "open":
            open_target(args.target)
        elif args.command == "reveal":
            open_target(args.path, reveal=True)
        elif args.command == "clipboard":
            if args.action == "read":
                sys.stdout.write(clipboard("read"))
            else:
                text = args.text if args.text is not None else sys.stdin.read()
                clipboard("write", text)
        elif args.command == "files":
            print_json(list_files(args.path))
        return 0
    except (ValueError, RuntimeError, OSError, subprocess.CalledProcessError, json.JSONDecodeError) as exc:
        print("laya: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
