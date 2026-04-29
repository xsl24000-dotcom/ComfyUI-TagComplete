from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager

from .paths import FREQUENCY_DB_PATH, ensure_directories


class FrequencyDb:
    def __init__(self, db_path=FREQUENCY_DB_PATH) -> None:
        ensure_directories()
        self.db_path = db_path
        self.lock = threading.Lock()
        self._init_db()

    @contextmanager
    def _connection(self):
        with self.lock:
            conn = sqlite3.connect(self.db_path)
            try:
                conn.row_factory = sqlite3.Row
                yield conn
                conn.commit()
            finally:
                conn.close()

    def _init_db(self) -> None:
        with self._connection() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS tag_frequency (
                    name TEXT NOT NULL,
                    type TEXT NOT NULL,
                    count_pos INTEGER NOT NULL DEFAULT 0,
                    count_neg INTEGER NOT NULL DEFAULT 0,
                    last_used TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (name, type)
                )
                """
            )

    def increase(self, name: str, tag_type: str, negative: bool = False, amount: int = 1) -> None:
        amount = max(int(amount or 1), 1)
        with self._connection() as conn:
            row = conn.execute(
                "SELECT count_pos, count_neg FROM tag_frequency WHERE name = ? AND type = ?",
                (name, tag_type),
            ).fetchone()
            count_pos = int(row["count_pos"]) if row else 0
            count_neg = int(row["count_neg"]) if row else 0
            if negative:
                count_neg += amount
            else:
                count_pos += amount
            conn.execute(
                """
                INSERT OR REPLACE INTO tag_frequency (name, type, count_pos, count_neg, last_used)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                (name, tag_type, count_pos, count_neg),
            )

    def reset(self, name: str, tag_type: str, reset_pos: bool = True, reset_neg: bool = True) -> None:
        with self._connection() as conn:
            row = conn.execute(
                "SELECT count_pos, count_neg FROM tag_frequency WHERE name = ? AND type = ?",
                (name, tag_type),
            ).fetchone()
            if row is None:
                return
            count_pos = 0 if reset_pos else int(row["count_pos"])
            count_neg = 0 if reset_neg else int(row["count_neg"])
            conn.execute(
                """
                INSERT OR REPLACE INTO tag_frequency (name, type, count_pos, count_neg, last_used)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                (name, tag_type, count_pos, count_neg),
            )

    def bulk_get(self, items: list[dict], negative: bool = False, max_age_days: int | None = None) -> dict[str, dict]:
        results: dict[str, dict] = {}
        if not items:
            return results

        column = "count_neg" if negative else "count_pos"
        with self._connection() as conn:
            for item in items:
                if max_age_days:
                    row = conn.execute(
                        f"""
                        SELECT {column} AS count, last_used
                        FROM tag_frequency
                        WHERE name = ? AND type = ?
                        AND last_used > datetime('now', '-' || ? || ' days')
                        """,
                        (item["name"], item["type"], int(max_age_days)),
                    ).fetchone()
                else:
                    row = conn.execute(
                        f"""
                        SELECT {column} AS count, last_used
                        FROM tag_frequency
                        WHERE name = ? AND type = ?
                        """,
                        (item["name"], item["type"]),
                    ).fetchone()
                key = f'{item["type"]}::{item["name"]}'
                results[key] = {
                    "name": item["name"],
                    "type": item["type"],
                    "count": int(row["count"]) if row else 0,
                    "last_used": row["last_used"] if row else None,
                }
        return results


FREQUENCY_DB = FrequencyDb()
