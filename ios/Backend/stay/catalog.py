"""Hotel discovery, date-specific room availability and staff inventory."""

from datetime import timedelta
import sqlite3

from .storage import (
    POLICY, Problem, cents, clean, day, days, flag, number, one, own, records, require,
)


ROOM = """
SELECT r.*, h.name AS hotel, h.city, h.address, h.phone, h.approved
FROM rooms r JOIN hotels h ON h.id = r.hotel_id
"""

ROOM_NIGHTS = """
SELECT i.*, (SELECT COUNT(*) FROM nights n WHERE n.room_id = i.room_id
    AND n.day = i.day AND n.state IN ('held', 'consumed') AND n.order_id <> ?) AS occupied
FROM inventory i WHERE i.room_id = ? AND i.day BETWEEN ? AND ? ORDER BY i.day
"""


def room_data(db, room_id):
    return one(db, ROOM + " WHERE r.id = ?", (room_id,), "房型")


def calendar_rows(db, room, dates, except_order=0):
    known = {row["day"]: row for row in records(
        db, ROOM_NIGHTS, (except_order, room["id"], dates[0], dates[-1]),
    )}
    closures = records(
        db,
        """SELECT start,end FROM closures
           WHERE hotel_id = ? AND status = 'approved' AND start <= ? AND end >= ?""",
        (room["hotel_id"], dates[-1], dates[0]),
    )
    result = []
    for value in dates:
        row = known.get(value)
        closed = any(item["start"] <= value <= item["end"] for item in closures)
        if row is None:
            row = {"day": value, "total": None, "price": None, "occupied": 0, "stopped": 0}
            status = "closed" if closed else "unconfigured"
            remaining = 0
        else:
            remaining = row["total"] - row["occupied"]
            status = ("closed" if closed else "stopped" if row["stopped"] else
                      "available" if remaining > 0 else "sold_out")
        result.append({**row, "remaining": remaining, "status": status})
    return result


def describe(db, room, dates, guests, except_order=0):
    rows = calendar_rows(db, room, dates, except_order)
    prices = [row["price"] for row in rows]
    allowed = bool(room["approved"] and room["active"] and guests <= room["capacity"])
    return {
        **room,
        "nights": rows,
        "total": sum(prices) if all(value is not None for value in prices) else None,
        "from_price": min((value for value in prices if value is not None), default=None),
        "remaining": min((row["remaining"] if row["status"] == "available" else 0
                          for row in rows), default=0),
        "bookable": allowed and all(row["status"] == "available" for row in rows),
    }


def quote(db, room_id, arrival, departure, guests, except_order=0, old_prices=None):
    dates = days(arrival, departure)
    room = room_data(db, room_id)
    old_prices = old_prices or {}
    if (not room["approved"] or not room["active"]) and any(value not in old_prices for value in dates):
        raise Problem("unavailable", "该酒店或房型当前不可接受新预订。", 409)
    if guests > room["capacity"]:
        raise Problem("capacity", f"该房型最多入住 {room['capacity']} 人。")
    rows = calendar_rows(db, room, dates, except_order)
    for row in rows:
        value = row["day"]
        if value in old_prices:
            row["price"] = old_prices[value]
        elif row["status"] != "available":
            reasons = {"closed": "酒店临时停业", "stopped": "房型停售",
                       "unconfigured": "酒店尚未发布房态", "sold_out": "房间已售罄"}
            raise Problem("unavailable", f"{value} {reasons[row['status']]}。", 409)
    return {
        "room": room, "nights": rows, "arrival": arrival, "departure": departure,
        "guests": guests, "total": sum(row["price"] for row in rows), "policy": POLICY,
    }


class Catalog:
    def __init__(self, database):
        self.db = database

    def search(self, user, arrival, departure, guests, city="", name="", room="", maximum=""):
        require(user, "guest")
        dates = days(arrival, departure)
        guests = number(guests, "入住人数", maximum=20)
        filters = tuple(clean(value, "搜索词", 70, False) for value in (city, name, room))
        ceiling = cents(maximum) if maximum else None
        with self.db.connect() as db:
            results = records(
                db,
                ROOM + """
                WHERE h.approved = 1 AND r.active = 1 AND r.capacity >= ?
                  AND instr(h.city, ?) > 0 AND instr(h.name, ?) > 0 AND instr(r.name, ?) > 0
                ORDER BY h.id, r.id
                """,
                (guests, *filters),
            )
            hotels = {}
            for raw in results:
                item = describe(db, raw, dates, guests)
                if ceiling is not None and any(
                    n["price"] is None or n["price"] > ceiling for n in item["nights"]
                ):
                    continue
                hotel = hotels.setdefault(item["hotel_id"], {
                    "id": item["hotel_id"], "name": item["hotel"], "city": item["city"],
                    "address": item["address"], "rooms": [],
                })
                hotel["rooms"].append(item)
        return list(hotels.values())

    def hotel(self, user, hotel_id, arrival, departure, guests):
        require(user, "guest")
        dates = days(arrival, departure)
        guests = number(guests, "入住人数", maximum=20)
        with self.db.connect() as db:
            hotel = one(db, """
                SELECT id,name,city,address,phone FROM hotels WHERE id = ? AND approved = 1
                """, (hotel_id,), "可预订酒店")
            hotel["rooms"] = [describe(db, room, dates, guests) for room in records(
                db, ROOM + " WHERE r.hotel_id = ? AND r.active = 1 ORDER BY r.id", (hotel_id,),
            )]
        return hotel

    def offer(self, user, room_id, arrival, departure, guests):
        require(user, "guest")
        with self.db.connect() as db:
            return quote(db, room_id, arrival, departure, number(guests, "人数", maximum=20))

    def hotels(self, user):
        require(user, "staff", "admin")
        with self.db.connect() as db:
            if user["role"] == "staff":
                return records(db, "SELECT * FROM hotels WHERE id = ?", (user["hotel_id"],))
            return records(db, "SELECT * FROM hotels ORDER BY approved, id")

    def manage(self, user):
        require(user, "staff")
        with self.db.connect() as db:
            hotel = one(db, "SELECT * FROM hotels WHERE id = ?", (user["hotel_id"],), "本店")
            hotel["rooms"] = records(db, "SELECT * FROM rooms WHERE hotel_id = ? ORDER BY id",
                                     (hotel["id"],))
        return hotel

    def edit_hotel(self, user, hotel_id, name, city, address, phone):
        with self.db.write(user, "hotel.edit", hotel_id, user["hotel_id"]) as (db, audit):
            own(user, hotel_id)
            values = [clean(value, title) for title, value in (
                ("酒店名称", name), ("城市", city), ("地址", address), ("联系方式", phone),
            )]
            db.execute("UPDATE hotels SET name=?,city=?,address=?,phone=? WHERE id=?",
                       (*values, hotel_id))
            audit["detail"] = "维护酒店基本资料"

    def approve(self, user, hotel_id, note):
        with self.db.write(user, "hotel.approve", hotel_id) as (db, audit):
            require(user, "admin")
            hotel = one(db, "SELECT approved FROM hotels WHERE id=?", (hotel_id,), "酒店")
            if hotel["approved"]:
                raise Problem("state", "酒店已经通过审核。", 409)
            note = clean(note, "审核意见", 400)
            db.execute("UPDATE hotels SET approved=1,review_note=? WHERE id=?", (note, hotel_id))
            audit.update(hotel=hotel_id, detail=note)

    def edit_room(self, user, room_id, name, bed, capacity, description, active):
        with self.db.write(user, "room.edit", room_id or "new", user["hotel_id"]) as (db, audit):
            require(user, "staff")
            values = (clean(name, "房型名称"), clean(bed, "床型"), number(capacity, "人数上限", maximum=20),
                      clean(description, "房型介绍", 400, False), flag(active))
            if room_id:
                own(user, room_data(db, room_id)["hotel_id"])
            try:
                if room_id:
                    db.execute("UPDATE rooms SET name=?,bed=?,capacity=?,description=?,active=? WHERE id=?",
                               (*values, room_id))
                else:
                    room_id = db.execute(
                        "INSERT INTO rooms(hotel_id,name,bed,capacity,description,active) VALUES(?,?,?,?,?,?)",
                        (user["hotel_id"], *values),
                    ).lastrowid
            except sqlite3.IntegrityError as exc:
                raise Problem("duplicate", "本店已存在同名房型。", 409) from exc
            audit.update(target=room_id, detail="更新房型资料，" + ("启用" if active else "停用"))
        return {"id": room_id}

    def inventory(self, user, room_id, start):
        with self.db.connect() as db:
            room = room_data(db, room_id)
            own(user, room["hotel_id"])
            first = day(start)
            if first.toordinal() > day("9999-12-25").toordinal():
                raise Problem("date", "周起始日期超出可查看范围。")
            dates = [(first + timedelta(days=i)).isoformat() for i in range(7)]
            return calendar_rows(db, room, dates)

    def set_inventory(self, user, room_id, value, total, price, stopped):
        with self.db.write(user, "inventory.edit", f"{room_id}/{value}", user["hotel_id"]) as (db, audit):
            room = room_data(db, room_id)
            own(user, room["hotel_id"])
            date_key = day(value).isoformat()
            total, price, stopped = number(total, "可售总量", 0, 10000), cents(price), flag(stopped)
            row = calendar_rows(db, room, [date_key])[0]
            if total < row["occupied"]:
                raise Problem("inventory_floor", f"可售总量不得低于已占用和已消费的 {row['occupied']} 间。", 409)
            db.execute(
                """INSERT INTO inventory VALUES(?,?,?,?,?) ON CONFLICT(room_id,day)
                   DO UPDATE SET total=excluded.total,price=excluded.price,stopped=excluded.stopped""",
                (room_id, date_key, total, price, stopped),
            )
            audit["detail"] = f"总量 {total} 间，售价 {price / 100:.2f} 元，停售 {'是' if stopped else '否'}"
