import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest


SCRIPTS = Path(__file__).parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS))

sync_spec = importlib.util.spec_from_file_location("mysql_sync", SCRIPTS / "mysql_sync.py")
sync = importlib.util.module_from_spec(sync_spec)
sync_spec.loader.exec_module(sync)

restore_spec = importlib.util.spec_from_file_location(
    "mysql_restore", SCRIPTS / "mysql_restore.py"
)
restore = importlib.util.module_from_spec(restore_spec)
restore_spec.loader.exec_module(restore)


class MySqlCloudTests(unittest.TestCase):
    def test_live_sqlite_is_loaded_read_only_with_sidecars(self):
        with tempfile.TemporaryDirectory() as root_name:
            root = Path(root_name)
            database = root / "odak.sqlite3"
            connection = sqlite3.connect(database)
            connection.executescript(
                "CREATE TABLE tasks(id TEXT PRIMARY KEY,payload TEXT NOT NULL);"
                "CREATE TABLE sessions(id TEXT PRIMARY KEY,payload TEXT NOT NULL);"
                "CREATE TABLE meta(key TEXT PRIMARY KEY,payload TEXT NOT NULL);"
            )
            task = {
                "id": "task-1",
                "title": "Deneme",
                "label": "Yazılım",
                "color": "#438470",
                "notes": "",
                "status": "active",
                "completedAt": None,
                "estimateMin": None,
                "scheduledDate": "2026-10-12",
                "startAt": None,
                "endAt": None,
                "dueAt": None,
                "recurrenceRule": None,
                "seriesId": None,
                "subtasks": [],
                "createdAt": 1,
            }
            connection.execute("INSERT INTO tasks VALUES (?,?)", (task["id"], json.dumps(task)))
            meta = {
                "timer": {"phase": "idle"},
                "settings": {"defaultWorkMin": 45},
                "notified": [],
                "suspendedWork": {},
                "priorities": {"task-1": 5},
            }
            for key, value in meta.items():
                connection.execute("INSERT INTO meta VALUES (?,?)", (key, json.dumps(value)))
            connection.commit()
            before = database.read_bytes()
            (root / "labels.json").write_text(
                json.dumps({"labels": [{"name": "Yazılım", "color": "#438470"}], "hidden": []})
            )
            (root / "task-durations.json").write_text(json.dumps({"task-1": 30}))

            source = sync.load_source(database)
            self.assertEqual(source["tasks"], [task])
            self.assertEqual(source["priorities"], {"task-1": 5})
            self.assertEqual(source["taskDurations"], {"task-1": 30})
            self.assertEqual(database.read_bytes(), before)
            connection.close()

    def test_cloud_snapshot_becomes_importable_backup(self):
        snapshot = {
            "format": "odak-cloud-snapshot",
            "version": 1,
            "exportedAt": 10,
            "sourceDevice": "test",
            "tasks": [{"id": "task-1"}],
            "sessions": [{"id": "session-1"}],
            "meta": {
                "timer": {"phase": "idle"},
                "settings": {"defaultWorkMin": 45},
                "notified": ["notice"],
                "suspendedWork": {},
            },
            "labels": {"labels": [], "hidden": []},
            "priorities": {"task-1": 4},
            "taskDurations": {"task-1": 30},
        }
        backup = restore.importable_backup(snapshot)
        self.assertEqual(backup["format"], "odak-backup")
        self.assertEqual(backup["data"]["tasks"], snapshot["tasks"])
        self.assertEqual(backup["priorities"], {"task-1": 4})
        self.assertEqual(backup["taskDurations"], {"task-1": 30})
        self.assertEqual(len(sync.sha(snapshot)), 64)

    def test_restore_refuses_overwrite_and_uses_private_permissions(self):
        with tempfile.TemporaryDirectory() as root_name:
            output = Path(root_name) / "backup.json"
            restore.write_private_json(output, {"ok": True}, overwrite=False)
            self.assertEqual(json.loads(output.read_text()), {"ok": True})
            self.assertEqual(os.stat(output).st_mode & 0o777, 0o600)
            with self.assertRaises(SystemExit):
                restore.write_private_json(output, {"ok": False}, overwrite=False)


if __name__ == "__main__":
    unittest.main()
