CREATE TABLE IF NOT EXISTS hotels (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    city TEXT NOT NULL,
    address TEXT NOT NULL,
    phone TEXT NOT NULL,
    submitted TEXT NOT NULL,
    approved INTEGER NOT NULL DEFAULT 0 CHECK (approved IN (0, 1)),
    review_note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('guest', 'staff', 'admin')),
    hotel_id INTEGER REFERENCES hotels(id),
    CHECK ((role = 'staff') = (hotel_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY,
    hotel_id INTEGER NOT NULL REFERENCES hotels(id),
    name TEXT NOT NULL,
    bed TEXT NOT NULL,
    capacity INTEGER NOT NULL CHECK (capacity > 0),
    description TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    UNIQUE(hotel_id, name)
);
CREATE TABLE IF NOT EXISTS inventory (
    room_id INTEGER NOT NULL REFERENCES rooms(id),
    day TEXT NOT NULL,
    total INTEGER NOT NULL CHECK (total >= 0),
    price INTEGER NOT NULL CHECK (price >= 0),
    stopped INTEGER NOT NULL CHECK (stopped IN (0, 1)),
    PRIMARY KEY(room_id, day)
);
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY,
    guest_id INTEGER NOT NULL REFERENCES accounts(id),
    hotel_id INTEGER NOT NULL REFERENCES hotels(id),
    room_id INTEGER NOT NULL REFERENCES rooms(id),
    arrival TEXT NOT NULL,
    departure TEXT NOT NULL CHECK (departure > arrival),
    guests INTEGER NOT NULL CHECK (guests > 0),
    contact TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('pending','confirmed','in_house','completed','cancelled')),
    total INTEGER NOT NULL CHECK (total >= 0),
    policy TEXT NOT NULL,
    created TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS order_scope ON orders(guest_id, room_id, arrival, departure);
CREATE INDEX IF NOT EXISTS hotel_orders ON orders(hotel_id, status);
CREATE TABLE IF NOT EXISTS nights (
    order_id INTEGER NOT NULL REFERENCES orders(id),
    room_id INTEGER NOT NULL,
    day TEXT NOT NULL,
    price INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('held', 'released', 'consumed')),
    PRIMARY KEY(order_id, room_id, day),
    FOREIGN KEY(room_id, day) REFERENCES inventory(room_id, day)
);
CREATE INDEX IF NOT EXISTS night_usage ON nights(room_id, day, state);
CREATE TABLE IF NOT EXISTS requests (
    guest_id INTEGER NOT NULL REFERENCES accounts(id),
    key TEXT NOT NULL,
    result TEXT NOT NULL,
    PRIMARY KEY(guest_id, key)
);
CREATE TABLE IF NOT EXISTS amendments (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    kind TEXT NOT NULL CHECK (kind IN ('change', 'cancel')),
    plan TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','invalid')),
    resolution TEXT NOT NULL DEFAULT '',
    created TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS pending_amendment
    ON amendments(order_id, kind) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS stays (
    order_id INTEGER NOT NULL REFERENCES orders(id),
    kind TEXT NOT NULL CHECK (kind IN ('check_in', 'check_out')),
    staff_id INTEGER NOT NULL REFERENCES accounts(id),
    occurred TEXT NOT NULL,
    PRIMARY KEY(order_id, kind)
);
CREATE TABLE IF NOT EXISTS closures (
    id INTEGER PRIMARY KEY,
    hotel_id INTEGER NOT NULL REFERENCES hotels(id),
    start TEXT NOT NULL,
    end TEXT NOT NULL CHECK (end >= start),
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    note TEXT NOT NULL DEFAULT '',
    created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS closure_lookup ON closures(hotel_id, status, start, end);
CREATE TABLE IF NOT EXISTS closure_notes (
    id INTEGER PRIMARY KEY,
    closure_id INTEGER NOT NULL REFERENCES closures(id),
    order_id INTEGER NOT NULL REFERENCES orders(id),
    staff_id INTEGER NOT NULL REFERENCES accounts(id),
    note TEXT NOT NULL,
    created TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notices (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
    created TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS deliveries (
    id INTEGER PRIMARY KEY,
    notice_id INTEGER NOT NULL REFERENCES notices(id),
    status TEXT NOT NULL,
    detail TEXT NOT NULL,
    created TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY,
    account_id INTEGER REFERENCES accounts(id),
    hotel_id INTEGER REFERENCES hotels(id),
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    result TEXT NOT NULL,
    detail TEXT NOT NULL,
    created TEXT NOT NULL
);
