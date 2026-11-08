"""Persistence, input validation and service-side identity boundaries."""

from contextlib import closing, contextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
import re
import sqlite3


POLICY = "退改截止时间及费用待确认。入住前可提交取消申请，酒店处理改单期间原订单继续有效。"


class Problem(Exception):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.status = code, status

    def payload(self):
        return {"error": self.code, "message": str(self)}


def clean(value, label, maximum=120, required=True):
    if not isinstance(value, str) or len(value.strip()) > maximum:
        raise Problem("input", f"{label}需为不超过 {maximum} 字的文字。")
    value = value.strip()
    if required and not value:
        raise Problem("input", f"请填写{label}。")
    return value


def number(value, label, minimum=1, maximum=1_000_000_000):
    if isinstance(value, bool) or not re.fullmatch(r"[0-9]{1,10}", str(value)):
        raise Problem("input", f"{label}需填写整数。")
    value = int(value)
    if not minimum <= value <= maximum:
        raise Problem("input", f"{label}需在 {minimum} 至 {maximum} 之间。")
    return value


def flag(value):
    if not isinstance(value, bool):
        raise Problem("input", "请选择有效的开关状态。")
    return int(value)


def cents(value):
    if not re.fullmatch(r"[0-9]{1,5}(?:\.[0-9]{1,2})?", str(value)):
        raise Problem("input", "价格需为 0 至 99999.99 元，最多两位小数。")
    try:
        return int(Decimal(str(value)) * 100)
    except InvalidOperation as exc:
        raise Problem("input", "价格格式有误。") from exc


def day(value):
    try:
        if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
            raise ValueError
        return date.fromisoformat(value)
    except ValueError as exc:
        raise Problem("date", "请选择有效日期（YYYY-MM-DD）。") from exc


def days(start, end, limit=90):
    first, last = day(start), day(end)
    count = (last - first).days
    if not 1 <= count <= limit:
        raise Problem("date", f"结束日期须晚于开始日期，且区间不得超过 {limit} 天。")
    return [(first + timedelta(days=offset)).isoformat() for offset in range(count)]


def one(db, sql, args, label):
    row = db.execute(sql, args).fetchone()
    if row is None:
        raise Problem("missing", f"找不到{label}。", 404)
    return dict(row)


def records(db, sql, args=()):
    return [dict(row) for row in db.execute(sql, args)]


def require(user, *roles):
    if user["role"] not in roles:
        raise Problem("forbidden", "当前身份没有此操作权限。", 403)


def scope(user, alias="o"):
    if user["role"] == "guest":
        return f"{alias}.guest_id = ?", (user["id"],)
    if user["role"] == "staff":
        return f"{alias}.hotel_id = ?", (user["hotel_id"],)
    return "1 = 1", ()


def own(user, hotel):
    require(user, "staff")
    if user["hotel_id"] != hotel:
        raise Problem("forbidden", "只能管理本店数据。", 403)


class Database:
    def __init__(self, path, now=None, today=None):
        self.path = Path(path)
        self.now = now or (lambda: datetime.now(timezone.utc))
        self.today = today or date.today

    def timestamp(self):
        return self.now().isoformat(timespec="seconds")

    @contextmanager
    def connect(self, write=False):
        db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        try:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA foreign_keys = ON")
            db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            try:
                yield db
            except BaseException:
                db.rollback()
                raise
            else:
                db.commit()
        finally:
            db.close()

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path)) as db:
            db.execute("PRAGMA journal_mode = WAL")
            db.executescript(Path(__file__).with_name("schema.sql").read_text(encoding="utf-8"))
        with self.connect(write=True) as db:
            if not db.execute("SELECT 1 FROM accounts LIMIT 1").fetchone():
                self.seed(db)

    def account(self, uid):
        with self.connect() as db:
            return one(db, "SELECT * FROM accounts WHERE id = ?", (uid,), "身份")

    def log(self, db, user, hotel, action, target, result, detail=""):
        db.execute(
            """INSERT INTO audit(account_id,hotel_id,action,target,result,detail,created)
               VALUES(?,?,?,?,?,?,?)""",
            (user["id"] if user else None, hotel, action, str(target), result,
             detail, self.timestamp()),
        )

    @contextmanager
    def write(self, user, action, target, hotel=None):
        error = None
        with self.connect(write=True) as db:
            db.execute("SAVEPOINT business")
            audit = {"target": target, "hotel": hotel, "detail": ""}
            try:
                yield db, audit
            except Problem as exc:
                db.execute("ROLLBACK TO business")
                error = exc
                self.log(db, user, audit["hotel"], action, audit["target"], exc.code, str(exc))
            else:
                self.log(db, user, audit["hotel"], action, audit["target"],
                         audit.get("result", "ok"), audit["detail"])
            finally:
                db.execute("RELEASE business")
        if error:
            raise error

    def seed(self, db):
        submitted = self.timestamp()
        db.executemany("INSERT INTO hotels VALUES(?,?,?,?,?,?,?,?)", [
            (1, "栖居 · 金陵酒店", "南京", "秦淮区中山南路 168 号（示例）", "025-0000-0000", submitted, 1, "演示资料核验完成"),
            (2, "云栖 · 玄武湖酒店", "南京", "玄武区湖景路 28 号（示例）", "025-0000-0001", submitted, 1, "演示资料核验完成"),
            (3, "青屿 · 城南旅店", "南京", "雨花台区软件大道 8 号（示例）", "025-0000-0002", submitted, 0, ""),
            (4, "平江 · 姑苏酒店", "苏州", "姑苏区平江路 28 号（示例）", "0512-0000-0001", submitted, 1, "演示资料核验完成"),
        ])
        db.executemany("INSERT INTO accounts VALUES(?,?,?,?)", [
            (1, "演示顾客甲", "guest", None),
            (2, "演示顾客乙", "guest", None),
            (3, "金陵酒店员工", "staff", 1),
            (4, "玄武湖酒店员工", "staff", 2),
            (5, "平台管理员", "admin", None),
            (6, "青屿酒店员工", "staff", 3),
            (7, "姑苏酒店员工", "staff", 4),
        ])
        db.executemany("INSERT INTO rooms VALUES(?,?,?,?,?,?,?)", [
            (1, 1, "雅致大床房", "大床", 2, "一张大床，临窗书桌，可住两位。", 1),
            (2, 1, "庭景双床房", "双床", 2, "两张独立单人床，朝向庭院。", 1),
            (3, 2, "湖景大床房", "大床", 2, "湖景窗与一张大床。", 1),
            (4, 2, "园景双床房", "双床", 2, "安静园景，适合同行住客。", 1),
            (5, 3, "标准大床房", "大床", 2, "旅店基础房型，等待平台审核。", 1),
            (6, 4, "家庭套房", "大床与单人床", 3, "独立休息区，可住三位。", 1),
        ])
        first = self.today()
        db.executemany("INSERT INTO inventory VALUES(?,?,?,?,?)", [
            (room, (first + timedelta(days=offset)).isoformat(),
             max(0, total - (offset % 3)), price + (6000 if offset % 7 in (1, 5) else 0), 0)
            for room, total, price in [(1, 5, 36800), (2, 3, 39800), (3, 4, 45800),
                                       (4, 2, 48800), (5, 5, 26800), (6, 4, 53800)]
            for offset in range(180)
        ])
