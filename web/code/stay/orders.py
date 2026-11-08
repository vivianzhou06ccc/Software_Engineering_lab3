"""Booking lifecycle and atomic inventory allocation."""

from datetime import timedelta
import json

from .catalog import quote, room_data
from .storage import POLICY, Problem, clean, days, number, one, own, records, require, scope


STATES = ("pending", "confirmed", "in_house", "completed", "cancelled")
OPEN = ("pending", "confirmed")
ORDER_LIST = """
SELECT o.*, h.name AS hotel, r.name AS room
FROM orders o JOIN hotels h ON h.id=o.hotel_id JOIN rooms r ON r.id=o.room_id
"""


def get_order(db, user, order_id):
    order = one(db, ORDER_LIST + " WHERE o.id=?", (order_id,), "订单")
    rule, values = scope(user)
    if not db.execute("SELECT 1 FROM orders o WHERE o.id=? AND " + rule, (order_id, *values)).fetchone():
        raise Problem("forbidden", "当前身份不能访问该订单。", 403)
    return order


def ensure_no_overlap(db, user_id, room_id, start, end, excluding=0):
    if db.execute(
        """SELECT 1 FROM orders WHERE guest_id=? AND room_id=? AND arrival < ?
           AND departure > ? AND id<>? AND status IN ('pending','confirmed','in_house') LIMIT 1""",
        (user_id, room_id, end, start, excluding),
    ).fetchone():
        raise Problem("overlap", "你在该酒店同房型已有重叠的有效订单。", 409)


def invalidate(db, order_id, reason):
    db.execute(
        "UPDATE amendments SET status='invalid',resolution=? WHERE order_id=? AND status='pending'",
        (reason, order_id),
    )


def cancel(db, order, reason):
    db.execute("UPDATE orders SET status='cancelled',reason=? WHERE id=?", (reason, order["id"]))
    db.execute("UPDATE nights SET state='released' WHERE order_id=? AND state='held'", (order["id"],))
    invalidate(db, order["id"], reason)


def insert_nights(db, order_id, room_id, nights):
    db.executemany(
        "INSERT INTO nights(order_id,room_id,day,price,state) VALUES(?,?,?,?,'held')",
        [(order_id, room_id, n["day"], n["price"]) for n in nights],
    )


def public_order(order, user):
    if user["role"] == "admin":
        return {key: value for key, value in order.items() if key not in ("contact", "phone")}
    return order


class Orders:
    def __init__(self, database, demo=False):
        self.db, self.demo = database, demo

    def list(self, user, status=""):
        if status and status not in STATES:
            raise Problem("input", "未知订单状态。")
        rule, args = scope(user)
        if status:
            rule += " AND o.status=?"
            args += (status,)
        with self.db.connect() as db:
            return [public_order(order, user) for order in records(
                db, ORDER_LIST + " WHERE " + rule + " ORDER BY o.id DESC", args,
            )]

    def detail(self, user, order_id):
        with self.db.connect() as db:
            order = get_order(db, user, order_id)
            order["nights"] = records(
                db, "SELECT * FROM nights WHERE order_id=? ORDER BY day", (order_id,),
            )
            order["stays"] = records(db, """
                SELECT s.*, a.name AS staff FROM stays s JOIN accounts a ON a.id=s.staff_id
                WHERE order_id=? ORDER BY occurred
                """, (order_id,))
            order["amendments"] = records(db, """
                SELECT * FROM amendments WHERE order_id=? ORDER BY id DESC
                """, (order_id,))
            for change in order["amendments"]:
                change["plan"] = json.loads(change["plan"])
                if user["role"] == "admin":
                    for name in ("contact", "phone"):
                        change["plan"].pop(name, None)
            return public_order(order, user)

    def submit(self, user, key, room_id, arrival, departure, guests, contact, phone, prices):
        require(user, "guest")
        key = clean(key, "请求编号", 100)
        with self.db.connect(write=True) as db:
            existing = db.execute("SELECT result FROM requests WHERE guest_id=? AND key=?",
                                  (user["id"], key)).fetchone()
            if existing:
                return json.loads(existing["result"])
            hotel_id = None
            db.execute("SAVEPOINT booking")
            try:
                room = room_data(db, room_id)
                hotel_id = room["hotel_id"]
                guests = number(guests, "人数", maximum=20)
                contact, phone = clean(contact, "联系人", 60), clean(phone, "联系电话", 30, False)
                days(arrival, departure)
                ensure_no_overlap(db, user["id"], room_id, arrival, departure)
                offer = quote(db, room_id, arrival, departure, guests)
                latest = [row["price"] for row in offer["nights"]]
                if prices != latest:
                    result = {"kind": "requote", "quote": offer, "message": "房价已更新，请核对最新报价。"}
                    audit = "requote"
                else:
                    order_id = db.execute(
                        """INSERT INTO orders(guest_id,hotel_id,room_id,arrival,departure,guests,contact,
                           phone,status,total,policy,created) VALUES(?,?,?,?,?,?,?,?,'pending',?,?,?)""",
                        (user["id"], hotel_id, room_id, arrival, departure, guests, contact, phone,
                         offer["total"], POLICY, self.db.timestamp()),
                    ).lastrowid
                    insert_nights(db, order_id, room_id, offer["nights"])
                    result = {"kind": "booked", "id": order_id, "key": key}
                    audit = "ok"
            except Problem as exc:
                db.execute("ROLLBACK TO booking")
                result = {"kind": "denied", **exc.payload(), "key": key}
                audit = exc.code
            db.execute("RELEASE booking")
            db.execute("INSERT INTO requests VALUES(?,?,?)", (user["id"], key, json.dumps(result)))
            self.db.log(db, user, hotel_id, "order.submit", result.get("id", key), audit,
                        result.get("message", "已生成订单并占用全部房晚"))
        return result

    def request_result(self, user, key):
        require(user, "guest")
        with self.db.connect() as db:
            row = one(db, "SELECT result FROM requests WHERE guest_id=? AND key=?",
                      (user["id"], clean(key, "请求编号", 100)), "本人的请求记录")
            return json.loads(row["result"])

    def staff_action(self, user, order_id, action, reason=""):
        transitions = {
            "confirm": ("pending", "confirmed"), "refuse": ("pending", "cancelled"),
            "check_in": ("confirmed", "in_house"), "check_out": ("in_house", "completed"),
        }
        if action not in transitions:
            raise Problem("input", "未知订单操作。")
        with self.db.write(user, "order." + action, order_id, user["hotel_id"]) as (db, audit):
            require(user, "staff")
            order = get_order(db, user, order_id)
            own(user, order["hotel_id"])
            expected, target = transitions[action]
            if order["status"] != expected:
                raise Problem("state", "订单状态已变化，请刷新后重新操作。", 409)
            if action == "refuse":
                reason = clean(reason, "拒绝原因", 400)
                cancel(db, order, reason)
                audit["detail"] = reason
                return
            if action in ("check_in", "check_out"):
                field = "arrival" if action == "check_in" else "departure"
                if order[field] != self.db.today().isoformat():
                    raise Problem("stay_day", "仅可在计划入住日或退房日办理对应的正常业务。", 409)
                db.execute("INSERT INTO stays VALUES(?,?,?,?)",
                           (order_id, action, user["id"], self.db.timestamp()))
                if action == "check_in":
                    invalidate(db, order_id, "已办理入住")
                else:
                    db.execute("UPDATE nights SET state='consumed' WHERE order_id=? AND state='held'",
                               (order_id,))
            db.execute("UPDATE orders SET status=? WHERE id=?", (target, order_id))
            audit["detail"] = f"{expected} → {target}"

    def change_options(self, user, order_id):
        require(user, "guest")
        with self.db.connect() as db:
            order = get_order(db, user, order_id)
            return records(db, """SELECT id,name,capacity FROM rooms
                WHERE hotel_id=? AND (active=1 OR id=?) ORDER BY id""",
                (order["hotel_id"], order["room_id"]))

    def amended_quote(self, db, order, room_id, arrival, departure, guests):
        if order["status"] not in OPEN:
            raise Problem("state", "当前订单状态不可办理退改。", 409)
        room = room_data(db, room_id)
        if room["hotel_id"] != order["hotel_id"]:
            raise Problem("hotel", "换酒店需要重新预订。")
        guests = number(guests, "人数", maximum=20)
        retained = {}
        if room_id == order["room_id"]:
            retained = {n["day"]: n["price"] for n in records(
                db, "SELECT day,price FROM nights WHERE order_id=? AND state='held'", (order["id"],),
            )}
        result = quote(db, room_id, arrival, departure, guests, order["id"], retained)
        ensure_no_overlap(db, order["guest_id"], room_id, arrival, departure, order["id"])
        result["difference"] = result["total"] - order["total"]
        return result

    def change_quote(self, user, order_id, room_id, arrival, departure, guests):
        require(user, "guest")
        with self.db.connect() as db:
            return self.amended_quote(db, get_order(db, user, order_id),
                                      room_id, arrival, departure, guests)

    def apply(self, user, order_id, kind, reason, **values):
        if kind not in ("change", "cancel"):
            raise Problem("input", "未知申请类型。")
        with self.db.write(user, "order.apply_" + kind, order_id) as (db, audit):
            require(user, "guest")
            order = get_order(db, user, order_id)
            audit["hotel"] = order["hotel_id"]
            if order["status"] not in OPEN:
                raise Problem("state", "当前订单状态不可办理退改。", 409)
            if db.execute("SELECT 1 FROM amendments WHERE order_id=? AND kind=? AND status='pending'",
                          (order_id, kind)).fetchone():
                raise Problem("duplicate", "已有一项同类申请待处理。", 409)
            reason, plan = clean(reason, "申请原因", 400), {}
            if kind == "change":
                fields = {key: values[key] for key in ("room_id", "arrival", "departure", "guests")}
                result = self.amended_quote(db, order, **fields)
                prices = [n["price"] for n in result["nights"]]
                if values["prices"] != prices:
                    raise Problem("price", "新方案价格已变动，请重新查看报价。", 409)
                plan = {
                    **fields, "guests": result["guests"], "room": result["room"]["name"],
                    "contact": clean(values["contact"], "联系人", 60),
                    "phone": clean(values["phone"], "联系电话", 30, False),
                    "prices": prices, "total": result["total"], "difference": result["difference"],
                }
            aid = db.execute(
                "INSERT INTO amendments(order_id,kind,plan,reason,created) VALUES(?,?,?,?,?)",
                (order_id, kind, json.dumps(plan), reason, self.db.timestamp()),
            ).lastrowid
            audit["detail"] = reason
        return {"id": aid}

    def review(self, user, amendment_id, approve, note):
        if not isinstance(approve, bool):
            raise Problem("input", "请选择批准或拒绝。")
        with self.db.write(user, "order.review", amendment_id, user["hotel_id"]) as (db, audit):
            require(user, "staff")
            entry = one(db, "SELECT * FROM amendments WHERE id=?", (amendment_id,), "申请")
            order = get_order(db, user, entry["order_id"])
            if order["status"] not in OPEN or entry["status"] != "pending":
                raise Problem("state", "申请已处理或已失效。", 409)
            note = clean(note, "处理原因", 400)
            if entry["kind"] == "cancel" and not self.demo:
                raise Problem("policy", "正式取消处理规则待确认。", 409)
            state = "approved" if approve else "rejected"
            db.execute("UPDATE amendments SET status=?,resolution=? WHERE id=?", (state, note, amendment_id))
            if approve and entry["kind"] == "cancel":
                cancel(db, order, note)
            elif approve:
                plan = json.loads(entry["plan"])
                result = self.amended_quote(db, order, **{
                    key: plan[key] for key in ("room_id", "arrival", "departure", "guests")
                })
                if [n["price"] for n in result["nights"]] != plan["prices"]:
                    raise Problem("price", "报价已变动，原订单继续有效，请拒绝旧方案后请顾客重新申请。", 409)
                db.execute("DELETE FROM nights WHERE order_id=? AND state='held'", (order["id"],))
                insert_nights(db, order["id"], plan["room_id"], result["nights"])
                db.execute(
                    """UPDATE orders SET room_id=?,arrival=?,departure=?,guests=?,contact=?,phone=?,total=?
                       WHERE id=?""",
                    (*(plan[key] for key in ("room_id", "arrival", "departure", "guests",
                                              "contact", "phone", "total")), order["id"]),
                )
            audit["detail"] = f"{state}，订单 {order['id']}：{note}"

    def expire(self):
        if not self.demo:
            return 0
        cutoff = (self.db.now() - timedelta(minutes=30)).isoformat(timespec="seconds")
        with self.db.connect(write=True) as db:
            due = records(db, "SELECT * FROM orders WHERE status='pending' AND created <= ?", (cutoff,))
            for order in due:
                reason = "演示规则：待确认超过 30 分钟"
                cancel(db, order, reason)
                db.execute("INSERT INTO notices(order_id,message,created) VALUES(?,?,?)",
                           (order["id"], "待确认订单已超时取消，房量已释放。", self.db.timestamp()))
                self.db.log(db, None, order["hotel_id"], "order.expire", order["id"], "ok", reason)
            return len(due)
