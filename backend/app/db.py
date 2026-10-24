
"""SQLite access, schema, settings, demo clock and the hash-chained action history."""

import hashlib
import json
import os
import sqlite3
import threading
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB_PATH = None
GENESIS = "0" * 64

# Readers wait while a demo reset rebuilds the tables, so a reset
# never produces transient errors.
READY = threading.Event()
READY.set()


SCHEMA = """
CREATE TABLE institutions (
  aicte_id TEXT PRIMARY KEY,
  name TEXT,
  city TEXT,
  state TEXT,
  region TEXT,
  address TEXT,
  type TEXT,
  programmes TEXT,
  est_year INTEGER,
  head_name TEXT,
  phone TEXT,
  email TEXT
);

CREATE TABLE officers (
  id TEXT PRIMARY KEY,
  name TEXT,
  bureau_code TEXT,
  designation TEXT,
  level INTEGER
);

CREATE TABLE cases (
  case_id TEXT PRIMARY KEY,
  reference_no TEXT,
  institution_id TEXT,
  submitted_institution_name TEXT,
  submitted_aicte_id TEXT,
  resolution_method TEXT,
  resolution_conf REAL,
  source TEXT,
  received_on TEXT,
  category TEXT,
  category_group TEXT,
  severity INTEGER,
  description TEXT,
  status TEXT,
  origin_bureau TEXT,
  bureau_code TEXT,
  assigned_officer_id TEXT,
  last_action TEXT,
  last_action_at TEXT,
  next_action TEXT,

  sla_days INTEGER,
  due_date TEXT,
  sla_use_working_days INTEGER NOT NULL DEFAULT 0,
  sla_warn_pct INTEGER NOT NULL DEFAULT 75,

  escalation_level INTEGER DEFAULT 0,
  transfer_count INTEGER DEFAULT 0,
  disposed_on TEXT,
  outcome TEXT,
  room_id TEXT,
  cluster_id TEXT,
  warned_at TEXT,
  breached_at TEXT,
  severe_at TEXT,
  pingpong_at TEXT
);

CREATE INDEX ix_cases_inst
ON cases(institution_id, status);

CREATE INDEX ix_cases_bureau
ON cases(bureau_code, status);

CREATE INDEX ix_cases_recv
ON cases(received_on);


CREATE TABLE action_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT,
  seq INTEGER,
  ts TEXT,
  actor_id TEXT,
  actor_name TEXT,
  actor_bureau TEXT,
  action_type TEXT,
  from_bureau TEXT,
  to_bureau TEXT,
  remarks TEXT,
  prev_hash TEXT,
  hash TEXT,
  UNIQUE(case_id, seq)
);


CREATE TABLE overlap_pairs (
  id TEXT PRIMARY KEY,
  case_a TEXT,
  case_b TEXT,
  institution_id TEXT,
  type TEXT,
  score REAL,
  band TEXT,
  breakdown TEXT,
  explanation TEXT,
  headline TEXT,
  cluster_id TEXT,
  status TEXT DEFAULT 'OPEN',
  detected_at TEXT,
  review_rationale TEXT,
  review_by TEXT,
  review_at TEXT,
  UNIQUE(case_a, case_b)
);


CREATE TABLE coordination_rooms (
  id TEXT PRIMARY KEY,
  cluster_id TEXT,
  institution_id TEXT,
  lead_bureau TEXT,
  status TEXT DEFAULT 'OPEN',
  decision TEXT,
  created_by TEXT,
  created_at TEXT,
  resolved_at TEXT
);


CREATE TABLE room_cases (
  room_id TEXT,
  case_id TEXT,
  PRIMARY KEY(room_id, case_id)
);


CREATE TABLE room_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT,
  author TEXT,
  role TEXT,
  body TEXT,
  ts TEXT
);


CREATE TABLE alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT,
  severity TEXT,
  case_id TEXT,
  institution_id TEXT,
  pair_id TEXT,
  cluster_id TEXT,
  message TEXT,
  created_at TEXT,
  is_read INTEGER DEFAULT 0,
  link TEXT
);


-- Configurable SLA rules.
-- Category '*' is the Bureau-wide default.
-- Exact category rules take priority over wildcard rules.

CREATE TABLE sla_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bureau TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '*',

  days INTEGER NOT NULL
    CHECK(days BETWEEN 1 AND 365),

  warn_pct INTEGER NOT NULL DEFAULT 75
    CHECK(warn_pct BETWEEN 1 AND 99),

  use_working_days INTEGER NOT NULL DEFAULT 0
    CHECK(use_working_days IN (0, 1)),

  UNIQUE(bureau, category)
);

CREATE INDEX ix_sla_rules_lookup
ON sla_rules(bureau, category);


-- Optional holiday calendar for working-day SLAs.
-- Empty by default.

CREATE TABLE holidays (
  date TEXT PRIMARY KEY,
  name TEXT NOT NULL
);


CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);


CREATE TABLE case_number_counters (
  bureau TEXT NOT NULL,
  year INTEGER NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bureau, year)
);


CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT,
  seq INTEGER,
  filename TEXT,
  path TEXT,
  sha256 TEXT,
  size INTEGER,
  uploaded_by TEXT,
  uploaded_at TEXT
);

CREATE INDEX ix_docs_case
ON documents(case_id);
"""


TABLES = [
    "institutions",
    "officers",
    "cases",
    "action_history",
    "overlap_pairs",
    "coordination_rooms",
    "room_cases",
    "room_comments",
    "alerts",
    "sla_rules",
    "holidays",
    "settings",
    "case_number_counters",
    "documents",
]


def configure(path=None):
    """Override the database path, or restore environment-based configuration."""
    global DB_PATH
    DB_PATH = str(path) if path is not None else None


def database_path():
    return Path(
        DB_PATH or os.environ.get(
            "AICTE_DB",
            ROOT / "data" / "demo.db"
        )
    )


def ensure_sla_schema(conn):
    """
    Add configurable SLA support to an existing database.

    Existing cases retain their original sla_days and due_date.
    New snapshot columns default to calendar days and 75% warnings.

    This is an additive compatibility migration until the project
    adopts a versioned migration runner.
    """

    conn.execute("""
        CREATE TABLE IF NOT EXISTS sla_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          bureau TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT '*',
          days INTEGER NOT NULL
            CHECK(days BETWEEN 1 AND 365),
          warn_pct INTEGER NOT NULL DEFAULT 75
            CHECK(warn_pct BETWEEN 1 AND 99),
          use_working_days INTEGER NOT NULL DEFAULT 0
            CHECK(use_working_days IN (0, 1)),
          UNIQUE(bureau, category)
        )
    """)

    conn.execute("""
        CREATE INDEX IF NOT EXISTS ix_sla_rules_lookup
        ON sla_rules(bureau, category)
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS holidays (
          date TEXT PRIMARY KEY,
          name TEXT NOT NULL
        )
    """)

    columns = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(cases)")
    }

    if columns:

        if "sla_use_working_days" not in columns:
            conn.execute("""
                ALTER TABLE cases
                ADD COLUMN sla_use_working_days
                INTEGER NOT NULL DEFAULT 0
            """)

        if "sla_warn_pct" not in columns:
            conn.execute("""
                ALTER TABLE cases
                ADD COLUMN sla_warn_pct
                INTEGER NOT NULL DEFAULT 75
            """)

    # Existing demo databases may already contain cases.
    # Seed rules without resetting or modifying those cases.
    if columns:
        from .sla_rules import seed_defaults
        seed_defaults(conn)

    conn.commit()


def connect():
    """
    Open a SQLite connection and ensure additive schema compatibility.

    Existing database contents are preserved.
    """
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(
        path,
        timeout=30,
        check_same_thread=False
    )
    conn.row_factory = sqlite3.Row

    # Preserve compatibility for databases created before
    # overlap review fields were introduced.
    overlap_columns = {
        row["name"]
        for row in conn.execute(
            "PRAGMA table_info(overlap_pairs)"
        )
    }

    if overlap_columns:

        if "review_rationale" not in overlap_columns:
            conn.execute(
                "ALTER TABLE overlap_pairs "
                "ADD COLUMN review_rationale TEXT"
            )

        if "review_by" not in overlap_columns:
            conn.execute(
                "ALTER TABLE overlap_pairs "
                "ADD COLUMN review_by TEXT"
            )

        if "review_at" not in overlap_columns:
            conn.execute(
                "ALTER TABLE overlap_pairs "
                "ADD COLUMN review_at TEXT"
            )

    # Issue #19: upgrade existing databases without re-seeding cases.
    ensure_sla_schema(conn)

    return conn


def get_conn():
    """FastAPI dependency: one connection per request."""
    READY.wait(30)

    conn = connect()

    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def reset_schema(conn):
    """
    Recreate the demo schema from scratch.

    This is used by the existing demo reset workflow.
    It is intentionally destructive; normal connections do not reset data.
    """

    for table in TABLES:
        conn.execute(f"DROP TABLE IF EXISTS {table}")

    conn.executescript(SCHEMA)

    set_setting(conn, "clock_offset_days", "0")

    # Populate default Bureau and example category SLA rules.
    from .sla_rules import seed_defaults
    seed_defaults(conn)


def is_seeded():
    if not database_path().exists():
        return False

    try:
        conn = connect()
        n = conn.execute(
            "SELECT COUNT(*) FROM cases"
        ).fetchone()[0]
        conn.close()
        return n > 0

    except sqlite3.Error:
        return False


def rows(conn, sql, params=()):
    return [
        dict(row)
        for row in conn.execute(sql, params).fetchall()
    ]


def one(conn, sql, params=()):
    row = conn.execute(sql, params).fetchone()
    return dict(row) if row else None


def get_setting(conn, key, default=None):
    row = conn.execute(
        "SELECT value FROM settings WHERE key=?",
        (key,)
    ).fetchone()

    return row["value"] if row else default


def set_setting(conn, key, value):
    conn.execute(
        """
        INSERT INTO settings(key, value)
        VALUES (?, ?)
        ON CONFLICT(key)
        DO UPDATE SET value=excluded.value
        """,
        (key, str(value))
    )


def next_counter(conn, key):
    """
    Atomically increment a settings-based counter.

    Preserves the existing counter implementation.
    """

    row = conn.execute(
        """
        INSERT INTO settings(key, value)
        VALUES (?, '1')
        ON CONFLICT(key) DO UPDATE
        SET value = CAST(settings.value AS INTEGER) + 1
        RETURNING value
        """,
        (key,),
    ).fetchone()

    return int(row["value"])


def now(conn):
    """Demo clock: real time plus the time-machine offset."""

    off = int(
        get_setting(conn, "clock_offset_days", "0") or 0
    )

    return (
        datetime.now().replace(microsecond=0)
        + timedelta(days=off)
    )


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


# ---- hash-chained action history ------------------------------------


def _hash(
    prev,
    case_id,
    seq,
    ts,
    actor_id,
    actor_bureau,
    action_type,
    from_b,
    to_b,
    remarks
):
    payload = json.dumps(
        [
            case_id,
            seq,
            ts,
            actor_id,
            actor_bureau,
            action_type,
            from_b,
            to_b,
            remarks
        ],
        ensure_ascii=False,
        separators=(",", ":")
    )

    return hashlib.sha256(
        (prev + payload).encode("utf-8")
    ).hexdigest()


def append_action(
    conn,
    case_id,
    ts,
    actor_id,
    actor_name,
    actor_bureau,
    action_type,
    from_b=None,
    to_b=None,
    remarks=""
):
    """
    The ONLY writer of action_history.

    Every row links to the previous row's hash.
    """

    last = conn.execute(
        """
        SELECT seq, hash
        FROM action_history
        WHERE case_id=?
        ORDER BY seq DESC
        LIMIT 1
        """,
        (case_id,)
    ).fetchone()

    seq = (last["seq"] if last else 0) + 1
    prev = last["hash"] if last else GENESIS

    h = _hash(
        prev,
        case_id,
        seq,
        ts,
        actor_id,
        actor_bureau,
        action_type,
        from_b,
        to_b,
        remarks
    )

    conn.execute(
        """
        INSERT INTO action_history(
            case_id,
            seq,
            ts,
            actor_id,
            actor_name,
            actor_bureau,
            action_type,
            from_bureau,
            to_bureau,
            remarks,
            prev_hash,
            hash
        )
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            case_id,
            seq,
            ts,
            actor_id,
            actor_name,
            actor_bureau,
            action_type,
            from_b,
            to_b,
            remarks,
            prev,
            h
        )
    )

    return seq, h


def verify_chain(conn, case_id=None):
    """
    Verify the hash-chained action history.

    Supports verification of one case or the complete ledger.
    """

    if case_id:
        where = "WHERE case_id=?"
        params = (case_id,)
    else:
        where = ""
        params = ()

    ids = [
        row[0]
        for row in conn.execute(
            f"SELECT DISTINCT case_id FROM action_history {where}",
            params
        )
    ]

    checked = 0

    for cid in ids:
        prev = GENESIS
        expect = 1

        for row in conn.execute(
            """
            SELECT *
            FROM action_history
            WHERE case_id=?
            ORDER BY seq
            """,
            (cid,)
        ):
            checked += 1

            h = _hash(
                prev,
                row["case_id"],
                row["seq"],
                row["ts"],
                row["actor_id"],
                row["actor_bureau"],
                row["action_type"],
                row["from_bureau"],
                row["to_bureau"],
                row["remarks"]
            )

            if (
                row["seq"] != expect
                or row["prev_hash"] != prev
                or row["hash"] != h
            ):

                if row["seq"] != expect:
                    reason = "sequence gap"

                elif row["prev_hash"] != prev:
                    reason = "chain link broken"

                else:
                    reason = "hash mismatch (record altered)"

                return {
                    "ok": False,
                    "checked": checked,
                    "first_break": {
                        "case_id": cid,
                        "seq": row["seq"],
                        "reason": reason
                    }
                }

            prev = row["hash"]
            expect += 1

    return {
        "ok": True,
        "checked": checked,
        "first_break": None
    }
