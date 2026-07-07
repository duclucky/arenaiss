#!/usr/bin/env python3
"""Run Renaiss Arena locally and open it in the default browser.

Usage:
  python run_local.py
  python run_local.py --port 3001

The script uses the project's existing npm dev command, waits until the app
responds, opens the browser once, and keeps streaming the server output until
Ctrl+C.
"""

from __future__ import annotations

import argparse
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the local Renaiss Arena web app.")
    parser.add_argument("--host", default="localhost", help="Host to bind/open. Default: localhost")
    parser.add_argument("--port", type=int, default=3000, help="Port to bind/open. Default: 3000")
    parser.add_argument("--no-open", action="store_true", help="Do not open the browser automatically")
    return parser.parse_args()


def wait_until_ready(url: str, timeout_seconds: int = 90) -> bool:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if 200 <= response.status < 500:
                    return True
        except (urllib.error.URLError, TimeoutError, OSError):
            time.sleep(1)
    return False


def npm_command() -> str:
    cmd = "npm.cmd" if os.name == "nt" else "npm"
    found = shutil.which(cmd)
    if not found:
        raise RuntimeError(f"Could not find {cmd}. Install Node.js/npm or add it to PATH.")
    return found


def main() -> int:
    args = parse_args()
    url = f"http://{args.host}:{args.port}"
    env = os.environ.copy()
    env["PORT"] = str(args.port)
    env["HOSTNAME"] = args.host

    if not (ROOT / "package.json").exists():
        print(f"package.json not found in {ROOT}", file=sys.stderr)
        return 1

    command = [npm_command(), "run", "dev", "--", "--hostname", args.host, "--port", str(args.port)]
    print(f"Starting dev server: {' '.join(command)}")
    print(f"Project: {ROOT}")
    print(f"URL: {url}")
    print("Press Ctrl+C to stop.")

    creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    proc = subprocess.Popen(command, cwd=ROOT, env=env, creationflags=creationflags)

    try:
        if wait_until_ready(url):
            print(f"Ready: {url}")
            if not args.no_open:
                webbrowser.open(url)
        else:
            print(f"Server did not respond within the timeout. Check the terminal output above.", file=sys.stderr)

        return proc.wait()
    except KeyboardInterrupt:
        print("\nStopping dev server...")
        if os.name == "nt":
            proc.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            proc.terminate()
        try:
            return proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            return proc.wait()


if __name__ == "__main__":
    raise SystemExit(main())
