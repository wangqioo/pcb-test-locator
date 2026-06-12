import argparse
import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def find_free_port(start):
    for port in range(start, start + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.2)
            if sock.connect_ex(("127.0.0.1", port)) != 0:
                return port
    raise RuntimeError("No free local port found")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    port = find_free_port(args.port)
    url = f"http://127.0.0.1:{port}/web/index.html"
    print(f"Serving {ROOT}")
    print(f"Open {url}")

    proc = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(port), "--directory", str(ROOT)],
        cwd=str(ROOT),
    )
    try:
        time.sleep(0.8)
        if not args.no_browser:
            webbrowser.open(url)
        proc.wait()
    except KeyboardInterrupt:
        proc.terminate()
    finally:
        if proc.poll() is None:
            proc.terminate()


if __name__ == "__main__":
    main()
