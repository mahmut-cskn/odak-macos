#!/usr/bin/env python3
"""Mirror the live Odak SQLite database to the private Aiven MySQL database.

The password is read from macOS Keychain and is never printed or written to disk.
The source SQLite database is opened read-only in a consistent transaction. Remote
replacement happens in one transaction and every uploaded state is retained in
odak_backup_snapshots.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import time
import uuid


HOST = "odak-mysql-odak.c.aivencloud.com"
PORT = "14664"
DATABASE = "odak"
USER = "odak_app"
KEYCHAIN_SERVICE = "com.mahmutcskn.odak.mysql"
APP_DATA = Path.home() / "Library/Application Support/com.mahmutcskn.odak"
DEFAULT_DATABASE = APP_DATA / "odak.sqlite3"
DEFAULT_CA = Path(__file__).with_name("aiven-ca.pem")


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def text_sql(value: str) -> str:
    if not value:
        return "CAST('' AS CHAR CHARACTER SET utf8mb4)"
    return f"CONVERT(0x{value.encode('utf-8').hex()} USING utf8mb4)"


def optional_text_sql(value: object) -> str:
    return "NULL" if value is None else text_sql(str(value))


def json_sql(value: object) -> str:
    return text_sql(canonical(value))


def optional_json_sql(value: object) -> str:
    return "NULL" if value is None else json_sql(value)


def optional_number_sql(value: object) -> str:
    return "NULL" if value is None else str(value)


def sha(value: object) -> str:
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def latest_backup(project: Path) -> Path:
    backups = sorted((project / ".recovery").glob("*/odak.sqlite3"))
    if not backups:
        raise SystemExit("Kurtarma SQLite kopyası bulunamadı.")
    return backups[-1]


def default_database(project: Path) -> Path:
    """Prefer the live database; keep the recovery snapshot as an offline fallback."""
    if DEFAULT_DATABASE.is_file():
        return DEFAULT_DATABASE
    return latest_backup(project)


def load_source(database_path: Path) -> dict[str, object]:
    if not database_path.is_file():
        raise SystemExit(f"SQLite veritabanı bulunamadı: {database_path}")
    connection = sqlite3.connect(f"file:{database_path}?mode=ro", uri=True)
    try:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise SystemExit(f"SQLite bütünlük kontrolü başarısız: {integrity}")
        connection.execute("BEGIN")
        tasks = [json.loads(row[0]) for row in connection.execute(
            "SELECT payload FROM tasks ORDER BY rowid"
        )]
        sessions = [json.loads(row[0]) for row in connection.execute(
            "SELECT payload FROM sessions ORDER BY rowid"
        )]
        meta = {
            key: json.loads(payload)
            for key, payload in connection.execute("SELECT key, payload FROM meta")
        }
    finally:
        connection.close()

    root = database_path.parent

    def read_json(name: str, fallback: object) -> object:
        path = root / name
        return json.loads(path.read_text()) if path.exists() else fallback

    labels = read_json("labels.json", {"labels": [], "hidden": []})
    legacy_priorities = read_json("priorities.json", {})
    durations = read_json("task-durations.json", {})
    priorities = meta.get("priorities", legacy_priorities)
    return {
        "tasks": tasks,
        "sessions": sessions,
        "meta": meta,
        "labels": labels,
        "priorities": priorities,
        "taskDurations": durations,
    }


def keychain_password() -> str:
    return subprocess.check_output(
        [
            "/usr/bin/security",
            "find-generic-password",
            "-a",
            USER,
            "-s",
            KEYCHAIN_SERVICE,
            "-w",
        ],
        text=True,
    ).strip()


def mysql_binary() -> str:
    configured = os.environ.get("ODAK_MYSQL_CLIENT")
    candidates = [
        configured,
        shutil.which("mysql"),
        "/opt/homebrew/bin/mysql",
        "/usr/local/bin/mysql",
        "/usr/local/opt/mysql-client/bin/mysql",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    raise SystemExit(
        "MySQL istemcisi bulunamadı. Homebrew ile `brew install mysql-client` çalıştırın."
    )


def mysql_command(ca_path: Path) -> list[str]:
    if not ca_path.is_file():
        raise SystemExit(f"Aiven CA sertifikası bulunamadı: {ca_path}")
    return [
        mysql_binary(),
        "--batch",
        "--skip-column-names",
        "--raw",
        "--default-character-set=utf8mb4",
        "--ssl",
        f"--ssl-ca={ca_path}",
        "--ssl-verify-server-cert",
        f"--host={HOST}",
        f"--port={PORT}",
        f"--user={USER}",
        DATABASE,
    ]


def run_mysql(sql: str, ca_path: Path, password: str | None = None) -> str:
    active_password = password if password is not None else keychain_password()
    try:
        environment = dict(os.environ, MYSQL_PWD=active_password)
        result = subprocess.run(
            mysql_command(ca_path),
            input=sql,
            text=True,
            capture_output=True,
            env=environment,
            check=False,
        )
    finally:
        active_password = ""
    if result.returncode:
        errors = [
            line.strip()
            for line in result.stderr.splitlines()
            if line.strip().startswith("ERROR ")
        ]
        raise SystemExit(errors[-1] if errors else "MySQL işlemi başarısız.")
    return result.stdout.strip()


def task_duration(task: dict[str, object], durations: dict[str, int]) -> int | None:
    direct = durations.get(str(task["id"]))
    if direct is not None:
        return direct
    series_id = task.get("seriesId")
    return durations.get(str(series_id)) if series_id is not None else None


def build_sql(source: dict[str, object], revision: int, device_id: str) -> str:
    tasks = source["tasks"]
    sessions = source["sessions"]
    meta = dict(source["meta"])
    labels_catalog = source["labels"]
    priorities = source["priorities"]
    durations = source["taskDurations"]
    assert isinstance(tasks, list)
    assert isinstance(sessions, list)
    assert isinstance(meta, dict)
    assert isinstance(labels_catalog, dict)
    assert isinstance(priorities, dict)
    assert isinstance(durations, dict)

    exported_at = int(time.time() * 1000)
    snapshot = {
        "format": "odak-cloud-snapshot",
        "version": 1,
        "exportedAt": exported_at,
        "sourceDevice": device_id,
        "tasks": tasks,
        "sessions": sessions,
        "meta": meta,
        "labels": labels_catalog,
        "priorities": priorities,
        "taskDurations": durations,
    }
    snapshot_hash = sha(snapshot)
    statements = [
        "SET NAMES utf8mb4",
        "SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE",
        "START TRANSACTION",
        (
            "INSERT INTO odak_backup_snapshots "
            "(revision, exported_at, source_device, snapshot_hash, payload) VALUES "
            f"({revision},{exported_at},{text_sql(device_id)},{text_sql(snapshot_hash)},"
            f"{json_sql(snapshot)})"
        ),
        "DELETE FROM odak_tasks",
        "DELETE FROM odak_sessions",
        "DELETE FROM odak_meta",
        "DELETE FROM odak_labels",
    ]

    for raw_task in tasks:
        task = dict(raw_task)
        task_hash = sha(task)
        priority = priorities.get(str(task["id"]))
        duration = task_duration(task, durations)
        statements.append(
            "INSERT INTO odak_tasks "
            "(id,kind,title,label,color,notes,status,completed_at,estimate_min,"
            "scheduled_date,start_at,end_at,due_at,recurrence_rule,series_id,subtasks,"
            "created_at,priority,pomodoro_min,payload,row_hash) VALUES ("
            f"{text_sql(str(task['id']))},{optional_text_sql(task.get('kind'))},"
            f"{text_sql(str(task.get('title', '')))},{text_sql(str(task.get('label', '')))},"
            f"{text_sql(str(task.get('color', '')))},{text_sql(str(task.get('notes', '')))},"
            f"{text_sql(str(task.get('status', 'active')))},"
            f"{optional_number_sql(task.get('completedAt'))},"
            f"{optional_number_sql(task.get('estimateMin'))},"
            f"{optional_text_sql(task.get('scheduledDate'))},"
            f"{optional_number_sql(task.get('startAt'))},"
            f"{optional_number_sql(task.get('endAt'))},"
            f"{optional_number_sql(task.get('dueAt'))},"
            f"{optional_json_sql(task.get('recurrenceRule'))},"
            f"{optional_text_sql(task.get('seriesId'))},"
            f"{json_sql(task.get('subtasks', []))},"
            f"{int(task.get('createdAt', 0))},{optional_number_sql(priority)},"
            f"{optional_number_sql(duration)},{json_sql(task)},{text_sql(task_hash)})"
        )

    for raw_session in sessions:
        session = dict(raw_session)
        session_hash = sha(session)
        statements.append(
            "INSERT INTO odak_sessions "
            "(id,task_id,session_type,started_at,ended_at,planned_min,actual_min,label,"
            "outcome,payload,row_hash) VALUES ("
            f"{text_sql(str(session['id']))},{optional_text_sql(session.get('taskId'))},"
            f"{text_sql(str(session.get('type', 'work')))},{int(session['startedAt'])},"
            f"{int(session['endedAt'])},{int(session['plannedMin'])},"
            f"{float(session['actualMin'])},{text_sql(str(session.get('label', '')))},"
            f"{optional_text_sql(session.get('outcome'))},{json_sql(session)},"
            f"{text_sql(session_hash)})"
        )

    meta["labelsCatalog"] = labels_catalog
    meta["taskDurations"] = durations
    for key, value in sorted(meta.items()):
        statements.append(
            "INSERT INTO odak_meta (meta_key,payload,row_hash) VALUES ("
            f"{text_sql(str(key))},{json_sql(value)},{text_sql(sha(value))})"
        )

    hidden = set(labels_catalog.get("hidden", []))
    labels: dict[str, str] = {
        str(task.get("label", "")): str(task.get("color", "#438470"))
        for task in tasks
        if task.get("label") and task.get("label") not in hidden
    }
    for label in labels_catalog.get("labels", []):
        if label.get("name") not in hidden:
            labels[str(label["name"])] = str(label["color"])
    for name, color in sorted(labels.items()):
        statements.append(
            "INSERT INTO odak_labels (name,color) VALUES ("
            f"{text_sql(name)},{text_sql(color)})"
        )

    statements.extend(
        [
            (
                "INSERT INTO odak_sync_state "
                "(singleton_id,schema_version,revision,source_device,source_updated_at,"
                "snapshot_hash,task_count,session_count) VALUES "
                f"(1,1,{revision},{text_sql(device_id)},{exported_at},"
                f"{text_sql(snapshot_hash)},{len(tasks)},{len(sessions)}) "
                "ON DUPLICATE KEY UPDATE schema_version=VALUES(schema_version),"
                "revision=VALUES(revision),source_device=VALUES(source_device),"
                "source_updated_at=VALUES(source_updated_at),"
                "snapshot_hash=VALUES(snapshot_hash),task_count=VALUES(task_count),"
                "session_count=VALUES(session_count)"
            ),
            "COMMIT",
        ]
    )
    return ";\n".join(statements) + ";\n"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Odak'ın canlı SQLite verisini Aiven MySQL'e güvenli biçimde yansıt."
    )
    parser.add_argument("--database", type=Path)
    parser.add_argument("--ca", type=Path, default=DEFAULT_CA)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    project = Path(__file__).resolve().parents[1]
    database_path = args.database or default_database(project)
    source = load_source(database_path)
    revision = int(time.time() * 1000)
    device_id = f"bootstrap-{uuid.uuid4()}"
    sql = build_sql(source, revision, device_id)
    print(
        canonical(
            {
                "source": str(database_path),
                "tasks": len(source["tasks"]),
                "sessions": len(source["sessions"]),
                "meta": len(source["meta"]),
                "sqlBytes": len(sql.encode("utf-8")),
                "apply": args.apply,
            }
        )
    )
    if not args.apply:
        return
    run_mysql(sql, args.ca)
    verification = run_mysql(
        "SELECT task_count,session_count,revision FROM odak_sync_state WHERE singleton_id=1;"
        "SELECT COUNT(*) FROM odak_tasks;SELECT COUNT(*) FROM odak_sessions;",
        args.ca,
    )
    print(verification)


if __name__ == "__main__":
    main()
