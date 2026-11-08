"""Requirement-oriented regression cases against an isolated SQLite database."""

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from stay.catalog import Catalog
from stay.operations import Operations
from stay.orders import Orders
from stay.storage import Database, Problem


class BookingTests(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.clock = datetime(2026, 11, 24, 12, tzinfo=timezone.utc)
        self.db = Database(Path(directory.name) / "test.sqlite3",
                           now=lambda: self.clock, today=lambda: self.clock.date())
        self.db.initialize()
        self.catalog = Catalog(self.db)
        self.orders = Orders(self.db, demo=True)
        self.ops = Operations(self.db, demo=True)
        self.guest, self.other, self.staff, self.rival, self.admin = (
            self.db.account(uid) for uid in range(1, 6)
        )
        self.start, self.second, self.end, self.third = (
            "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"
        )

    def stock(self, day, room=1):
        return self.catalog.inventory(self.staff, room, day)[0]

    def offer(self, guest=None, room=1, start=None, end=None):
        return self.catalog.offer(guest or self.guest, room, start or self.start, end or self.end, 2)

    def book(self, key="first", guest=None, room=1, start=None, end=None, prices=None):
        guest, start, end = guest or self.guest, start or self.start, end or self.end
        if prices is None:
            prices = [row["price"] for row in self.offer(guest, room, start, end)["nights"]]
        return self.orders.submit(guest, key, room, start, end, 2, "示例顾客", "", prices)

    def propose(self, oid, room=1, end=None):
        end = end or self.third
        quote = self.orders.change_quote(self.guest, oid, room, self.start, end, 2)
        change = self.orders.apply(self.guest, oid, "change", "调整入住安排",
                                   room_id=room, arrival=self.start, departure=end, guests=2,
                                   contact="示例顾客", phone="", prices=[n["price"] for n in quote["nights"]])
        return change["id"]

    def test_search_is_read_only_and_has_exact_nightly_rows(self):
        hotels = self.catalog.search(self.guest, self.start, self.end, "2", city="南京", maximum="428")
        first = hotels[0]["rooms"][0]
        self.assertEqual([n["day"] for n in first["nights"]], [self.start, self.second])
        self.assertEqual([n["price"] for n in first["nights"]], [36800, 42800])
        self.assertEqual([n["remaining"] for n in first["nights"]], [5, 4])
        self.assertEqual(self.stock(self.start)["occupied"], 0)
        self.assertNotIn(3, [hotel["id"] for hotel in hotels])
        with self.assertRaisesRegex(Problem, "晚于"):
            self.offer(end=self.start)
        with self.assertRaisesRegex(Problem, "最多"):
            self.catalog.offer(self.guest, 1, self.start, self.end, 3)

    def test_cross_night_denial_and_request_replay(self):
        self.catalog.set_inventory(self.staff, 1, self.second, 0, "428", False)
        result = self.book(prices=[36800, 42800])
        self.assertEqual(result["kind"], "denied")
        self.assertIn(self.second, result["message"])
        self.assertFalse(self.orders.list(self.guest))
        self.assertEqual(self.stock(self.start)["occupied"], 0)
        self.catalog.set_inventory(self.staff, 1, self.second, 3, "428", False)
        self.assertEqual(self.book(), result)
        self.assertEqual(self.orders.request_result(self.guest, "first"), result)
        self.assertEqual(self.book("new")["kind"], "booked")

    def test_price_refresh_then_snapshot_survives_update_and_disable(self):
        prices = [n["price"] for n in self.offer()["nights"]]
        self.catalog.set_inventory(self.staff, 1, self.start, 5, "399.25", False)
        result = self.book(prices=prices)
        self.assertEqual(result["kind"], "requote")
        self.assertEqual(result["quote"]["total"], 82725)
        self.assertEqual(self.stock(self.start)["occupied"], 0)
        order = self.book("accepted")
        self.assertEqual(self.book("accepted"), order)
        self.catalog.edit_room(self.staff, 1, "雅致大床房", "大床", 2, "介绍", False)
        detail = self.orders.detail(self.guest, order["id"])
        self.assertEqual(detail["total"], 82725)
        self.assertEqual(detail["nights"][0]["price"], 39925)

    def test_concurrent_last_room(self):
        self.catalog.set_inventory(self.staff, 1, self.start, 1, "368", False)
        def submit(value):
            guest, key = value
            return self.book(key, guest, end=self.second, prices=[36800])
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(submit, [(self.guest, "a"), (self.other, "b")]))
        self.assertEqual(sorted(item["kind"] for item in results), ["booked", "denied"])
        self.assertEqual(self.stock(self.start)["remaining"], 0)

    def test_lifecycle_and_scope(self):
        oid = self.book()["id"]
        for user in (self.other, self.rival):
            with self.assertRaises(Problem) as caught:
                self.orders.detail(user, oid)
            self.assertEqual(caught.exception.status, 403)
        self.assertNotIn("contact", self.orders.detail(self.admin, oid))
        with self.assertRaises(Problem):
            self.orders.staff_action(self.staff, oid, "check_out")
        self.orders.staff_action(self.staff, oid, "confirm")
        self.assertEqual(self.stock(self.start)["occupied"], 1)
        self.orders.staff_action(self.staff, oid, "check_in")
        self.clock += timedelta(days=2)
        self.orders.staff_action(self.staff, oid, "check_out")
        detail = self.orders.detail(self.guest, oid)
        self.assertEqual(detail["status"], "completed")
        self.assertEqual({n["state"] for n in detail["nights"]}, {"consumed"})
        self.assertEqual(len(detail["stays"]), 2)
        self.assertEqual(self.stock(self.start)["occupied"], 1)

    def test_overlap_boundary_cancel_and_no_double_release(self):
        oid = self.book()["id"]
        self.assertEqual(self.book("overlap")["error"], "overlap")
        self.assertEqual(self.book("adjacent", start=self.end, end=self.third)["kind"], "booked")
        request = self.orders.apply(self.guest, oid, "cancel", "行程取消")
        self.assertEqual(self.orders.detail(self.guest, oid)["status"], "pending")
        self.orders.review(self.staff, request["id"], True, "演示批准")
        with self.assertRaises(Problem):
            self.orders.review(self.staff, request["id"], True, "重复执行")
        self.assertEqual(self.stock(self.start)["occupied"], 0)
        self.assertEqual(self.book("rebook")["kind"], "booked")

    def test_change_failure_keeps_original_and_releases_nothing(self):
        oid = self.book()["id"]
        aid = self.propose(oid, room=2)
        with self.assertRaisesRegex(Problem, "已有"):
            self.propose(oid)
        self.catalog.set_inventory(self.staff, 2, self.end, 0, "398", False)
        with self.assertRaises(Problem):
            self.orders.review(self.staff, aid, True, "演示批准")
        detail = self.orders.detail(self.guest, oid)
        self.assertEqual((detail["room_id"], detail["departure"]), (1, self.end))
        self.assertEqual(self.stock(self.start)["occupied"], 1)
        self.assertEqual(self.stock(self.start, 2)["occupied"], 0)
        self.assertEqual(detail["amendments"][0]["status"], "pending")

    def test_change_retains_overlap_price_and_invalidates_on_arrival(self):
        oid = self.book()["id"]
        self.catalog.set_inventory(self.staff, 1, self.start, 5, "999", False)
        aid = self.propose(oid)
        self.orders.review(self.staff, aid, True, "同意延长")
        detail = self.orders.detail(self.guest, oid)
        self.assertEqual(detail["nights"][0]["price"], 36800)
        self.assertEqual(self.stock(self.start)["occupied"], 1)
        aid = self.propose(oid, end=self.end)
        self.orders.staff_action(self.staff, oid, "confirm")
        self.orders.staff_action(self.staff, oid, "check_in")
        with self.assertRaises(Problem):
            self.orders.review(self.staff, aid, True, "过时的审批")
        self.assertEqual(self.orders.detail(self.guest, oid)["amendments"][0]["status"], "invalid")

    def test_approved_closure_only_blocks_new_bookings(self):
        oid = self.book()["id"]
        cid = self.ops.request(self.staff, self.second, self.second, "消防检修")["id"]
        self.ops.review(self.admin, cid, True, "通过")
        self.assertEqual(self.ops.closure(self.admin, cid)["orders"][0]["id"], oid)
        self.ops.add_note(self.staff, cid, oid, "联系顾客，保留原订单")
        self.assertEqual(len(self.ops.closure(self.admin, cid)["notes"]), 1)
        self.assertEqual(self.orders.detail(self.guest, oid)["status"], "pending")
        self.assertEqual(self.book("blocked", self.other, prices=[36800, 42800])["error"], "unavailable")
        self.assertEqual(self.book("outside", self.other, end=self.second)["kind"], "booked")

    def test_expiry_notifications_and_audit(self):
        oid = self.book()["id"]
        self.clock += timedelta(minutes=29)
        self.assertEqual(self.orders.expire(), 0)
        self.clock += timedelta(minutes=1)
        self.assertEqual(self.orders.expire(), 1)
        self.assertEqual(self.orders.expire(), 0)
        notice = self.ops.notices(self.admin)[0]
        self.ops.deliver(self.admin, notice["id"], True)
        self.assertFalse(self.ops.notices(self.guest))
        self.assertEqual(self.orders.detail(self.guest, oid)["status"], "cancelled")
        self.ops.deliver(self.admin, notice["id"], False)
        self.assertEqual(self.ops.notices(self.guest)[0]["attempts"], 2)
        self.assertEqual([row["result"] for row in self.ops.logs(self.admin, "notice.deliver")],
                         ["ok", "delivery_failed"])

    def test_confirm_and_expiry_race(self):
        oid = self.book()["id"]
        self.clock += timedelta(minutes=31)
        def confirm():
            try:
                self.orders.staff_action(self.staff, oid, "confirm")
                return True
            except Problem as problem:
                self.assertEqual(problem.code, "state")
                return False
        with ThreadPoolExecutor(max_workers=2) as pool:
            first, second = pool.submit(confirm), pool.submit(self.orders.expire)
            confirmed, expired = first.result(), second.result()
        self.assertEqual(int(confirmed) + expired, 1)
        self.assertEqual(self.stock(self.start)["occupied"], int(confirmed))

    def test_inventory_floor_and_approval(self):
        self.book()
        with self.assertRaisesRegex(Problem, "不得低于"):
            self.catalog.set_inventory(self.staff, 1, self.start, 0, "368", False)
        with self.assertRaises(Problem):
            self.catalog.inventory(self.rival, 1, self.start)
        with self.assertRaises(Problem):
            self.catalog.offer(self.guest, 5, self.start, self.second, 2)
        self.catalog.approve(self.admin, 3, "资料正确")
        self.assertEqual(self.catalog.offer(self.guest, 5, self.start, self.second, 2)["total"], 26800)
        self.assertEqual(self.ops.logs(self.admin, "inventory.edit")[0]["result"], "inventory_floor")

    def test_storage_rollback_on_second_night_write_failure(self):
        import sqlite3
        with self.db.connect(write=True) as db:
            db.execute("""CREATE TRIGGER fail_second BEFORE INSERT ON nights
                       WHEN NEW.day='2026-11-25' BEGIN SELECT RAISE(ABORT, 'test failure'); END""")
        with self.assertRaises(sqlite3.IntegrityError):
            self.book()
        self.assertEqual(self.stock(self.start)["occupied"], 0)
        self.assertFalse(self.orders.list(self.guest))
        with self.db.connect(write=True) as db:
            db.execute("DROP TRIGGER fail_second")
        self.assertEqual(self.book()["kind"], "booked")


if __name__ == "__main__":
    unittest.main()
