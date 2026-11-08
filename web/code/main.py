"""Start the local Stay application."""

import argparse
from pathlib import Path
from threading import Timer
import webbrowser

from stay.server import serve, start_expiry


def main():
    parser = argparse.ArgumentParser(description="栖居 STAY · 酒店预订系统")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--db", type=Path)
    parser.add_argument("--demo-policies", action="store_true")
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    project = Path(__file__).resolve().parent.parent
    path = args.db or project / ("stay-demo.sqlite3" if args.demo_policies else "stay.sqlite3")
    try:
        server = serve(path, args.port, args.demo_policies, args.verbose)
    except OSError as exc:
        parser.exit(1, f"无法启动本地服务（{exc}）。可以改用 --port 8766。\n")
    url = f"http://127.0.0.1:{server.server_port}/"
    print(f"栖居 STAY 已启动\n{url}\n按 Ctrl+C 退出。", flush=True)
    stop = start_expiry(server.app)
    if not args.no_browser:
        Timer(.25, webbrowser.open, args=(url,)).start()
    with server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            stop.set()


if __name__ == "__main__":
    main()
