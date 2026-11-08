"""Loopback-only HTTP application for the desktop browser UI."""

from functools import partial
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from secrets import token_urlsafe
from threading import Event, Lock, Thread
from urllib.parse import parse_qs, urlsplit
import json
import re
import sqlite3
import traceback

from .catalog import Catalog
from .operations import Operations
from .orders import Orders
from .storage import Database, Problem, number, records


WEB = Path(__file__).resolve().parent.parent / "web"
ASSETS = {
    "/": ("index.html", "text/html"), "/app.js": ("app.js", "text/javascript"),
    "/customer.js": ("customer.js", "text/javascript"), "/workbench.js": ("workbench.js", "text/javascript"),
    "/ui.js": ("ui.js", "text/javascript"), "/style.css": ("style.css", "text/css"),
}
PARAMETERS = re.compile(r"<([a-z_]+)>")


def route(method, path, fn, fields="", optional=""):
    expr = PARAMETERS.sub(r"(?P<\1>[0-9]+)", path)
    return method, re.compile(expr), fn, fields.split(), optional.split()


def optional_id(value):
    return number(value, "编号", minimum=0)


class Application:
    def __init__(self, path, demo=False):
        self.db = Database(path)
        self.db.initialize()
        self.demo = demo
        self.catalog = c = Catalog(self.db)
        self.orders = o = Orders(self.db, demo)
        self.operations = p = Operations(self.db, demo)
        self.sessions, self.lock = {}, Lock()
        self.routes = [
            route("GET", "/search", c.search, "arrival departure guests", "city name room maximum"),
            route("GET", "/hotel/<hotel_id>", c.hotel, "arrival departure guests"),
            route("GET", "/quote/<room_id>", c.offer, "arrival departure guests"),
            route("GET", "/orders", o.list, optional="status"),
            route("POST", "/orders", o.submit, "key room_id arrival departure guests contact phone prices"),
            route("GET", "/orders/<order_id>", o.detail),
            route("GET", "/request", o.request_result, "key"),
            route("POST", "/orders/<order_id>/action", o.staff_action, "action", "reason"),
            route("GET", "/orders/<order_id>/rooms", o.change_options),
            route("GET", "/orders/<order_id>/quote", o.change_quote, "room_id arrival departure guests"),
            route("POST", "/orders/<order_id>/cancel", partial(o.apply, kind="cancel"), "reason"),
            route("POST", "/orders/<order_id>/change", partial(o.apply, kind="change"),
                  "reason room_id arrival departure guests contact phone prices"),
            route("POST", "/amendments/<amendment_id>", o.review, "approve note"),
            route("GET", "/manage", c.manage),
            route("GET", "/hotels", c.hotels),
            route("POST", "/hotels/<hotel_id>", c.edit_hotel, "name city address phone"),
            route("POST", "/hotels/<hotel_id>/approve", c.approve, "note"),
            route("POST", "/rooms/<room_id>", c.edit_room, "name bed capacity description active"),
            route("GET", "/inventory/<room_id>", c.inventory, "start"),
            route("POST", "/inventory/<room_id>", c.set_inventory, "value total price stopped"),
            route("GET", "/closures", p.closure_list),
            route("POST", "/closures", p.request, "start end reason"),
            route("GET", "/closures/<closure_id>", p.closure),
            route("POST", "/closures/<closure_id>/review", p.review, "approve note"),
            route("POST", "/closures/<closure_id>/notes", p.add_note, "order_id note"),
            route("GET", "/stats", p.stats, "start end", "hotel_id"),
            route("GET", "/logs", p.logs, optional="query"),
            route("GET", "/notices", p.notices),
            route("POST", "/notices/<notice_id>", p.deliver, "fail"),
        ]

    def session(self, token, chosen=None):
        if chosen is not None:
            user = self.db.account(number(chosen, "身份"))
            fresh = token_urlsafe(32)
            with self.lock:
                self.sessions.pop(token, None)
                self.sessions[fresh] = user["id"]
            return user, fresh
        with self.lock:
            uid = self.sessions.get(token)
        if uid is None:
            return self.session(token, 1)
        return self.db.account(uid), None

    def bootstrap(self, user):
        with self.db.connect() as db:
            users = records(db, """
                SELECT a.*,h.name AS hotel FROM accounts a LEFT JOIN hotels h ON h.id=a.hotel_id ORDER BY a.id
                """)
        return {
            "account": next(row for row in users if row["id"] == user["id"]),
            "profiles": users, "today": self.db.today().isoformat(), "demo": self.demo,
        }

    def dispatch(self, method, path, user, data):
        for verb, pattern, fn, required, optional in self.routes:
            match = pattern.fullmatch(path)
            if not match or verb != method:
                continue
            if any(name not in data for name in required):
                raise Problem("input", "缺少必要的表单数据。")
            values = {name: data[name] for name in required + optional if name in data}
            values.update(match.groupdict())
            for key, value in values.items():
                if key.endswith("_id"):
                    values[key] = optional_id(value) if key in ("hotel_id", "room_id") else number(value, "编号")
            if "prices" in values and (
                not isinstance(values["prices"], list) or len(values["prices"]) > 90 or
                any(type(item) is not int or item < 0 for item in values["prices"])
            ):
                raise Problem("input", "请先核对逐晚报价。")
            return fn(user, **values)
        raise Problem("missing", "找不到请求的页面或操作。", 404)


class Handler(BaseHTTPRequestHandler):
    server_version = "StayLab/3"

    def log_message(self, fmt, *args):
        if self.server.verbose:
            super().log_message(fmt, *args)

    def do_GET(self):
        self.handle_request("GET")

    def do_POST(self):
        self.handle_request("POST")

    def respond(self, payload, status=HTTPStatus.OK, content_type="application/json", token=None):
        data = payload if isinstance(payload, bytes) else json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; object-src 'none'; frame-ancestors 'none'")
        if token:
            self.send_header("Set-Cookie", f"stay_session={token}; Path=/; HttpOnly; SameSite=Strict")
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def body(self):
        if self.headers.get("X-Stay-Request") != "1":
            raise Problem("forbidden", "请求来源不受信任。", 403)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 100_000:
                raise ValueError
            result = json.loads(self.rfile.read(length))
            if not isinstance(result, dict):
                raise ValueError
            return result
        except (ValueError, UnicodeDecodeError) as exc:
            raise Problem("input", "无法读取请求内容。") from exc

    def handle_request(self, method):
        target = urlsplit(self.path)
        host = self.headers.get("Host", "")
        port = self.server.server_port
        if host not in (f"127.0.0.1:{port}", f"localhost:{port}"):
            self.respond({"error": "host", "message": "仅可在本机访问。"}, 403)
            return
        try:
            if method == "GET" and target.path in ASSETS:
                file, kind = ASSETS[target.path]
                self.respond((WEB / file).read_bytes(), content_type=kind)
                return
            if not target.path.startswith("/api/"):
                raise Problem("missing", "找不到页面。", 404)
            cookie = SimpleCookie(self.headers.get("Cookie", "")).get("stay_session")
            token = cookie.value if cookie else ""
            data = (self.body() if method == "POST" else
                    {key: values[-1] for key, values in parse_qs(target.query, keep_blank_values=True).items()})
            app = self.server.app
            if target.path == "/api/session" and method == "POST":
                previous, _ = app.session(token)
                user, token = app.session(token, data.get("id", ""))
                with app.db.connect(write=True) as db:
                    app.db.log(db, previous, user["hotel_id"], "session.switch", user["id"],
                               "ok", "切换本地演示身份")
                self.respond(app.bootstrap(user), token=token)
                return
            user, token = app.session(token)
            if target.path == "/api/session":
                self.respond(app.bootstrap(user), token=token)
                return
            result = app.dispatch(method, target.path.removeprefix("/api"), user, data)
            self.respond(result if result is not None else {"ok": True}, token=token)
        except Problem as exc:
            self.respond(exc.payload(), status=exc.status)
        except (sqlite3.Error, OSError, ValueError):
            traceback.print_exc()
            self.respond({"error": "storage", "message": "操作未完成。请重试，预订可用原请求编号恢复。"}, 500)


def serve(path, port, demo=False, verbose=False):
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    try:
        server.app = Application(path, demo)
    except BaseException:
        server.server_close()
        raise
    server.verbose = verbose
    return server


def start_expiry(app):
    stop = Event()
    if app.demo:
        def sweep():
            while not stop.wait(20):
                try:
                    app.orders.expire()
                except sqlite3.Error:
                    traceback.print_exc()
        Thread(target=sweep, daemon=True).start()
    return stop
