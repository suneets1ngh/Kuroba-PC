#!/usr/bin/env python3
"""
Kuroba Lite — Lightweight Local Thin-Client Server & CORS Proxy
Zero-dependency Python 3 server for Windows, macOS, and Linux.
Serves the static web app and proxies allowlisted imageboard APIs/media.
"""

import argparse
import http.server
import json
import os
import platform
import shutil
import socketserver
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
UPSTREAM_PROXY = os.environ.get("KUROBA_PROXY", "").strip()

ALLOWED_SUFFIXES = (
    "4cdn.org",
    "4chan.org",
    "lainchan.org",
    "8kun.top",
    "128ducks.com",
    "2ch.hk",
    "arisuchan.jp",
    "wizchan.org",
    "sushigirl.us",
    "kohlchan.net",
)

HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "content-encoding",
    "content-length",
}


def is_allowed_host(hostname: str) -> bool:
    if not hostname:
        return False
    host = hostname.lower().strip(".")
    return any(host == suffix or host.endswith("." + suffix) for suffix in ALLOWED_SUFFIXES)


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class KurobaHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def log_message(self, format, *args):
        # Keep console output clean; only log errors unless verbose
        pass

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def send_json(self, code: int, data: dict):
        body = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        global UPSTREAM_PROXY
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/api/proxy-config":
            self.send_error_json(404, "Not found")
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(min(length, 8192))
            data = json.loads(raw.decode("utf-8"))
            proxy_url = str(data.get("upstreamProxy", "")).strip()
            if proxy_url:
                p = urllib.parse.urlparse(proxy_url)
                if p.scheme not in ("http", "https") or not p.netloc:
                    self.send_error_json(400, "Proxy URL must start with http:// or https://")
                    return
            UPSTREAM_PROXY = proxy_url
            self.send_json(200, {"ok": True, "upstreamProxy": UPSTREAM_PROXY})
        except Exception as e:
            self.send_error_json(400, f"Invalid JSON: {e}")

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/health":
            self.send_json(200, {"ok": True, "mode": "proxy", "upstreamProxy": UPSTREAM_PROXY})
            return

        if parsed.path == "/api/proxy":
            self.handle_proxy(parsed)
            return

        if parsed.path == "/":
            self.path = "/index.html"

        return super().do_GET()

    def handle_proxy(self, parsed):
        qs = urllib.parse.parse_qs(parsed.query)
        target = qs.get("url", [""])[0]
        if not target:
            self.send_error_json(400, "Missing 'url' query parameter")
            return

        target_parsed = urllib.parse.urlparse(target)
        if target_parsed.scheme not in ("http", "https"):
            self.send_error_json(400, "Invalid URL scheme")
            return

        if not is_allowed_host(target_parsed.hostname):
            self.send_error_json(403, f"Host not in allowlist: {target_parsed.hostname}")
            return

        origin = f"{target_parsed.scheme}://{target_parsed.netloc}"
        req = urllib.request.Request(
            target,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
                "Accept": "application/json, image/*, video/*, */*;q=0.8",
                "Referer": origin + "/",
            },
        )

        try:
            opener = (
                urllib.request.build_opener(
                    urllib.request.ProxyHandler({"http": UPSTREAM_PROXY, "https": UPSTREAM_PROXY})
                )
                if UPSTREAM_PROXY
                else urllib.request.build_opener()
            )
            with opener.open(req, timeout=20) as resp:
                self.send_response(resp.status)
                for key, val in resp.headers.items():
                    if key.lower() in HOP_BY_HOP_HEADERS:
                        continue
                    if key.lower() == "access-control-allow-origin":
                        continue
                    self.send_header(key, val)
                if "content-type" not in {k.lower() for k in resp.headers.keys()}:
                    self.send_header("Content-Type", "application/octet-stream")
                self.end_headers()

                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except urllib.error.HTTPError as e:
            self.send_error_json(e.code, f"Upstream HTTP {e.code}: {e.reason}")
        except urllib.error.URLError as e:
            self.send_error_json(502, f"Upstream error: {e.reason}")
        except Exception as e:
            self.send_error_json(500, f"Proxy error: {e}")

    def send_error_json(self, code: int, message: str):
        body = f'{{"error":"{message.replace(chr(34), chr(39))}"}}'.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def find_chrome_executable() -> str | None:
    system = platform.system()
    candidates = []
    if system == "Windows":
        local = os.environ.get("LOCALAPPDATA", "")
        pf = os.environ.get("PROGRAMFILES", "")
        pfx86 = os.environ.get("PROGRAMFILES(X86)", "")
        candidates = [
            os.path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
            os.path.join(pfx86, "Google", "Chrome", "Application", "chrome.exe"),
            os.path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
            os.path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
            os.path.join(pfx86, "Microsoft", "Edge", "Application", "msedge.exe"),
        ]
    elif system == "Darwin":
        candidates = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ]
    else:
        for name in ("google-chrome", "chromium", "chromium-browser", "brave-browser", "microsoft-edge"):
            found = shutil.which(name)
            if found:
                return found

    for path in candidates:
        if path and os.path.exists(path):
            return path
    return None


def launch_chrome_app(url: str):
    exe = find_chrome_executable()
    if exe:
        try:
            subprocess.Popen([exe, f"--app={url}"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
        except Exception:
            pass
    import webbrowser
    webbrowser.open(url)


def main():
    global UPSTREAM_PROXY
    parser = argparse.ArgumentParser(description="Kuroba Lite local thin-client server")
    parser.add_argument("--host", default="127.0.0.1", help="Bind address (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8787, help="Port (default: 8787)")
    parser.add_argument("--proxy", default="", help="Upstream HTTP/HTTPS proxy URL (e.g. http://127.0.0.1:8080)")
    parser.add_argument("--no-open", action="store_true", help="Do not launch browser automatically")
    args = parser.parse_args()

    if args.proxy:
        UPSTREAM_PROXY = args.proxy.strip()

    server = ThreadedHTTPServer((args.host, args.port), KurobaHandler)
    url = f"http://{args.host}:{args.port}/"
    print(f"Kuroba Lite running at {url}")
    print("Press Ctrl+C to stop.")

    if not args.no_open:
        launch_chrome_app(url)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
