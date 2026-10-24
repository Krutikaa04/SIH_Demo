
from concurrent.futures import ThreadPoolExecutor
import sqlite3

from app import db, services



def test_next_counter_is_unique_across_connections(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    import sqlite3

    database = tmp_path / "counter_test.db"

    with sqlite3.connect(database) as conn:
        conn.execute(
            "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)"
        )

    def increment(key_and_index):
        key, _ = key_and_index
        conn = sqlite3.connect(database, timeout=30)
        conn.row_factory = sqlite3.Row
        try:
            value = db.next_counter(conn, key)
            conn.commit()
            return value
        finally:
            conn.close()

    for key in ("pair_seq", "cluster_seq", "room_seq", "sim_counter"):
        with ThreadPoolExecutor(max_workers=8) as pool:
            values = list(pool.map(increment, [(key, i) for i in range(100)]))

        assert len(values) == 100, key
        assert len(set(values)) == 100, key
        assert sorted(values) == list(range(1, 101)), key



def test_next_counter_continues_existing_value(tmp_path):
    database = tmp_path / "existing_counter.db"

    with sqlite3.connect(database) as conn:
        conn.execute("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)")
        conn.execute(
            "INSERT INTO settings(key, value) VALUES (?, ?)",
            ("room_seq", "41"),
        )

    conn = sqlite3.connect(database, timeout=30)
    conn.row_factory = sqlite3.Row
    try:
        assert db.next_counter(conn, "room_seq") == 42
        conn.commit()
    finally:
        conn.close()


def test_case_number_counter_is_unique_across_connections(tmp_path):
    database = tmp_path / "case_numbers.db"

    with sqlite3.connect(database) as conn:
        conn.execute("CREATE TABLE cases (case_id TEXT PRIMARY KEY)")
        conn.execute(
            """
            CREATE TABLE case_number_counters (
                bureau TEXT NOT NULL,
                year INTEGER NOT NULL,
                value INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (bureau, year)
            )
            """
        )

    def allocate(_):
        conn = sqlite3.connect(database, timeout=30)
        conn.row_factory = sqlite3.Row
        try:
            case_id = services.next_case_number(conn, "PGRC", 2026)
            conn.commit()
            return case_id
        finally:
            conn.close()

    with ThreadPoolExecutor(max_workers=4) as pool:
        values = list(pool.map(allocate, range(40)))

    assert len(values) == 40
    assert len(set(values)) == 40
    assert sorted(values) == [
        f"PGRC/2026/{n:05d}" for n in range(1, 41)
    ]
