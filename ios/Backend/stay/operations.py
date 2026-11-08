"""Temporary closures, scoped reports and notification delivery."""

from .storage import Problem, clean, day, days, flag, one, own, records, require, scope


CLOSURES = "SELECT c.*,h.name AS hotel FROM closures c JOIN hotels h ON h.id=c.hotel_id"


class Operations:
    def __init__(self, database, demo=False):
        self.db, self.demo = database, demo

    def closure_list(self, user):
        require(user, "staff", "admin")
        rule = " WHERE c.hotel_id=?" if user["role"] == "staff" else ""
        args = (user["hotel_id"],) if rule else ()
        with self.db.connect() as db:
            return records(db, CLOSURES + rule + " ORDER BY c.id DESC", args)

    def get_closure(self, db, user, closure_id):
        require(user, "staff", "admin")
        row = one(db, CLOSURES + " WHERE c.id=?", (closure_id,), "停业申请")
        if user["role"] == "staff":
            own(user, row["hotel_id"])
        return row

    @staticmethod
    def impacted(db, entry):
        return records(db, """
            SELECT o.id,o.status,o.arrival,o.departure,r.name AS room,
                   group_concat(n.day, '、') AS affected
            FROM orders o JOIN nights n ON n.order_id=o.id JOIN rooms r ON r.id=o.room_id
            WHERE o.hotel_id=? AND o.status IN ('pending','confirmed','in_house')
              AND n.state='held' AND n.day BETWEEN ? AND ?
            GROUP BY o.id ORDER BY o.id
            """, (entry["hotel_id"], entry["start"], entry["end"]))

    def closure(self, user, closure_id):
        with self.db.connect() as db:
            entry = self.get_closure(db, user, closure_id)
            entry["orders"] = self.impacted(db, entry)
            entry["notes"] = records(db, """
                SELECT n.*,a.name AS staff FROM closure_notes n
                JOIN accounts a ON a.id=n.staff_id WHERE n.closure_id=? ORDER BY n.id DESC
                """, (closure_id,))
        return entry

    def request(self, user, start, end, reason):
        with self.db.write(user, "closure.request", "new", user["hotel_id"]) as (db, audit):
            require(user, "staff")
            if day(end) < day(start):
                raise Problem("date", "停业结束日期不能早于开始日期。")
            reason = clean(reason, "停业原因", 400)
            closure_id = db.execute(
                "INSERT INTO closures(hotel_id,start,end,reason,created) VALUES(?,?,?,?,?)",
                (user["hotel_id"], start, end, reason, self.db.timestamp()),
            ).lastrowid
            audit.update(target=closure_id, detail=reason)
        return {"id": closure_id}

    def review(self, user, closure_id, approve, note):
        with self.db.write(user, "closure.review", closure_id) as (db, audit):
            require(user, "admin")
            entry = self.get_closure(db, user, closure_id)
            audit["hotel"] = entry["hotel_id"]
            if entry["status"] != "pending":
                raise Problem("state", "该停业申请已经处理。", 409)
            state = "approved" if flag(approve) else "rejected"
            note = clean(note, "审核意见", 400)
            db.execute("UPDATE closures SET status=?,note=? WHERE id=?", (state, note, closure_id))
            audit["detail"] = f"{state}：{note}"

    def add_note(self, user, closure_id, order_id, note):
        with self.db.write(user, "closure.note", closure_id, user["hotel_id"]) as (db, audit):
            entry = self.get_closure(db, user, closure_id)
            audit["hotel"] = entry["hotel_id"]
            if not any(item["id"] == order_id for item in self.impacted(db, entry)):
                raise Problem("scope", "该订单不在当前受影响订单清单中。", 409)
            note = clean(note, "处置记录", 400)
            db.execute("""
                INSERT INTO closure_notes(closure_id,order_id,staff_id,note,created) VALUES(?,?,?,?,?)
                """, (closure_id, order_id, user["id"], note, self.db.timestamp()))
            audit["detail"] = f"订单 {order_id}：{note}"

    def logs(self, user, query=""):
        require(user, "staff", "admin")
        query = clean(query, "日志查询", 100, False)
        limit = " AND l.hotel_id=?" if user["role"] == "staff" else ""
        args = (user["hotel_id"],) if limit else ()
        with self.db.connect() as db:
            return records(db, """
                SELECT l.*, coalesce(a.name,'系统') AS actor FROM audit l
                LEFT JOIN accounts a ON a.id=l.account_id
                WHERE (instr(l.action,?)>0 OR instr(l.target,?)>0)
                """ + limit + " ORDER BY l.id DESC LIMIT 250", (query, query, *args))

    def notices(self, user):
        rule, args = scope(user)
        if user["role"] == "guest":
            rule += " AND n.status='sent'"
        with self.db.connect() as db:
            return records(db, """
                SELECT n.*, (SELECT count(*) FROM deliveries d WHERE d.notice_id=n.id) AS attempts,
                    (SELECT detail FROM deliveries d WHERE d.notice_id=n.id ORDER BY d.id DESC LIMIT 1) AS detail
                FROM notices n JOIN orders o ON o.id=n.order_id
                WHERE """ + rule + " ORDER BY n.id DESC", args)

    def deliver(self, user, notice_id, fail):
        with self.db.write(user, "notice.deliver", notice_id) as (db, audit):
            require(user, "admin")
            if not self.demo:
                raise Problem("policy", "真实通知渠道待确认。", 409)
            notice = one(db, """
                SELECT n.status,o.hotel_id FROM notices n JOIN orders o ON o.id=n.order_id WHERE n.id=?
                """, (notice_id,), "通知")
            audit["hotel"] = notice["hotel_id"]
            if notice["status"] == "sent":
                return {"status": "sent"}
            status = "failed" if flag(fail) else "sent"
            text = "模拟投递失败，可重试" if fail else "已发送到演示站内通知"
            db.execute("UPDATE notices SET status=? WHERE id=?", (status, notice_id))
            db.execute("INSERT INTO deliveries(notice_id,status,detail,created) VALUES(?,?,?,?)",
                       (notice_id, status, text, self.db.timestamp()))
            audit["detail"] = text
            if fail:
                audit["result"] = "delivery_failed"
        return {"status": status}

    def stats(self, user, start, end, hotel_id=0):
        require(user, "staff", "admin")
        days(start, end, 366)
        if user["role"] == "staff" and hotel_id and user["hotel_id"] != hotel_id:
            raise Problem("forbidden", "只能查询本店统计。", 403)
        if not self.demo:
            return {"demo": False, "counts": None, "amount": None, "occupancy": None}
        rule, args = scope(user)
        if hotel_id:
            rule += " AND o.hotel_id=?"
            args += (hotel_id,)
        with self.db.connect() as db:
            counts = records(db, """
                SELECT o.status,count(*) AS amount FROM orders o WHERE substr(o.created,1,10)>=?
                AND substr(o.created,1,10)<? AND """ + rule + " GROUP BY o.status",
                (start, end, *args))
            totals = one(db, """
                SELECT count(*) AS nights,coalesce(sum(n.price),0) AS amount
                FROM nights n JOIN orders o ON o.id=n.order_id
                WHERE n.state='consumed' AND n.day>=? AND n.day<? AND """ + rule,
                (start, end, *args), "统计结果")
        return {"demo": True, "counts": counts, **totals, "occupancy": None}
