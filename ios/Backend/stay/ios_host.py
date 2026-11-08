"""Private loopback adapter for the embedded iPhone application."""

from hmac import compare_digest
from http.cookies import SimpleCookie
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from .server import Application, Handler, start_expiry


class AppHandler(Handler):
    def handle_request(self, method):
        cookie = SimpleCookie(self.headers.get("Cookie", "")).get("stay_ios")
        if cookie is None or not compare_digest(cookie.value.encode(), self.server.secret):
            self.respond({"error": "forbidden", "message": "此服务仅供栖居 App 使用。"}, 403)
            return
        super().handle_request(method)


def launch(directory, secret, demo=False):
    """Start the app service after initializing the database in its sandbox."""
    path = Path(directory) / ("stay-demo.sqlite3" if demo else "stay.sqlite3")
    server = ThreadingHTTPServer(("127.0.0.1", 0), AppHandler)
    try:
        server.app = Application(path, demo)
        server.secret = secret.encode()
        server.verbose = False
        Thread(target=server.serve_forever, daemon=True, name="Stay HTTP").start()
        start_expiry(server.app)
    except BaseException:
        server.server_close()
        raise
    return server.server_port
