"""Private local spool; the SaaS queue lives in PostgreSQL, not this SQLite file."""
import hashlib
import json
import sqlite3
import time
import uuid
from dataclasses import asdict, dataclass
from .protocol import Batch


class LeaseLost(Exception):
    pass


@dataclass(frozen=True)
class Lease:
    workspace: str
    video: str
    token: str
    checkpoint: str | None


class Store:
    def __init__(self, path):
        self.db = sqlite3.connect(path, timeout=10)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS jobs (
          workspace TEXT, video TEXT, status TEXT NOT NULL DEFAULT 'queued', attempt INTEGER DEFAULT 0,
          token TEXT, expires REAL, checkpoint TEXT, error_code TEXT, not_before REAL DEFAULT 0,
          PRIMARY KEY(workspace,video));
        CREATE TABLE IF NOT EXISTS comments (
          workspace TEXT, video TEXT, id TEXT, content_hash TEXT, raw TEXT,
          PRIMARY KEY(workspace,video,id));
        CREATE TABLE IF NOT EXISTS versions (
          workspace TEXT, video TEXT, id TEXT, content_hash TEXT, raw TEXT,
          PRIMARY KEY(workspace,video,id,content_hash));
        """)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.db.close()

    def enqueue(self, workspace, video):
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO jobs(workspace,video) VALUES (?,?)", (workspace, video))

    def claim(self, workspace, now=None, ttl=60):
        now = time.time() if now is None else now
        if not 0 < ttl <= 300:
            raise ValueError("invalid_lease_duration")
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            self.db.execute("""UPDATE jobs SET status='failed', error_code='retry_exhausted'
                WHERE workspace=? AND status IN ('queued','running') AND attempt>=3
                AND (expires IS NULL OR expires<=?)""", (workspace, now))
            r = self.db.execute("""SELECT * FROM jobs WHERE workspace=? AND attempt<3 AND not_before<=?
                AND (status='queued' OR (status='running' AND expires<=?)) ORDER BY video LIMIT 1""",
                                (workspace, now, now)).fetchone()
            if not r:
                return None
            token = str(uuid.uuid4())
            self.db.execute("""UPDATE jobs SET status='running', attempt=attempt+1, token=?, expires=?
                WHERE workspace=? AND video=?""", (token, now + ttl, workspace, r["video"]))
            return Lease(workspace, r["video"], token, r["checkpoint"])

    def _verify(self, lease, now):
        r = self.db.execute("""SELECT * FROM jobs WHERE workspace=? AND video=? AND token=?
            AND status='running' AND expires>?""", (lease.workspace, lease.video, lease.token, now)).fetchone()
        if not r:
            raise LeaseLost("lease_lost")
        return r

    def heartbeat(self, lease, now=None, ttl=60):
        now = time.time() if now is None else now
        if not 0 < ttl <= 300:
            raise ValueError("invalid_lease_duration")
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            self._verify(lease, now)
            self.db.execute("UPDATE jobs SET expires=? WHERE workspace=? AND video=?",
                            (now + ttl, lease.workspace, lease.video))

    def commit(self, lease, batch: Batch, now=None):
        now = time.time() if now is None else now
        if len(batch.comments) > 500:
            raise ValueError("batch_too_large")
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            self._verify(lease, now)
            for c in batch.comments:
                if c.video_id != lease.video or not c.id:
                    raise ValueError("invalid_comment_scope")
                raw = json.dumps(asdict(c), ensure_ascii=False)
                digest = hashlib.sha256(c.text.encode()).hexdigest()
                args = (lease.workspace, lease.video, c.id, digest, raw)
                self.db.execute("INSERT OR IGNORE INTO versions VALUES (?,?,?,?,?)", args)
                self.db.execute("""INSERT INTO comments VALUES (?,?,?,?,?) ON CONFLICT(workspace,video,id)
                    DO UPDATE SET content_hash=excluded.content_hash,raw=excluded.raw""", args)
            status = "succeeded" if batch.outcome == "exhausted" else (
                "running" if batch.outcome == "partial" else batch.outcome)
            if status in ("explicitly_disabled", "unavailable"):
                status = "blocked"
            self.db.execute("""UPDATE jobs SET checkpoint=?,status=?,error_code=? WHERE workspace=? AND video=?""",
                            (batch.checkpoint, status, None if status in ("running", "succeeded") else batch.outcome,
                             lease.workspace, lease.video))

    def fail(self, lease, code, status="failed", retryable=False, now=None):
        now = time.time() if now is None else now
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            r = self._verify(lease, now)
            status = "queued" if retryable and r["attempt"] < 3 else status
            self.db.execute("""UPDATE jobs SET status=?,error_code=?,not_before=?,token=NULL,expires=NULL
                WHERE workspace=? AND video=?""",
                            (status, code, now + 2 ** r["attempt"], lease.workspace, lease.video))

    def count(self, workspace):
        return self.db.execute("SELECT count(*) FROM comments WHERE workspace=?", (workspace,)).fetchone()[0]

    def version_count(self):
        return self.db.execute("SELECT count(*) FROM versions").fetchone()[0]

    def status(self, workspace, video):
        return self.db.execute("SELECT status FROM jobs WHERE workspace=? AND video=?",
                               (workspace, video)).fetchone()[0]
