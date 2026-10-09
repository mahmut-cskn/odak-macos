import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
import zipfile
from datetime import datetime

spec = importlib.util.spec_from_file_location("drive_backup", Path(__file__).parents[2] / "scripts/drive_backup.py")
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupTests(unittest.TestCase):
    def test_wal_snapshot_preserves_live_timer_and_all_payloads(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            source = root / "odak.sqlite3"
            writer = sqlite3.connect(source)
            writer.executescript("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE tasks(id TEXT PRIMARY KEY, payload TEXT); CREATE TABLE sessions(id TEXT PRIMARY KEY,payload TEXT); CREATE TABLE meta(key TEXT PRIMARY KEY,payload TEXT);")
            task = {"id": "existing", "title": "Do not change", "unknownFutureField": "preserve me"}
            timer = {"phase": "work", "startedAt": 12345678, "taskId": "existing", "pausedAccumulatedMs": 3900}
            writer.execute("INSERT INTO tasks VALUES (?,?)", ("existing", json.dumps(task)))
            for key, payload in {"timer": timer, "settings": {"quietMode": True}, "notified": ["sent"]}.items():
                writer.execute("INSERT INTO meta VALUES (?,?)", (key, json.dumps(payload)))
            writer.commit()
            before = list(writer.execute("SELECT * FROM tasks")), list(writer.execute("SELECT * FROM meta"))
            self.assertTrue(source.with_name(source.name + "-wal").exists())
            (root / "priorities.json").write_text('{"existing": 5}')
            (root / "task-durations.json").write_text('{"existing": 30, "removed": 15}')
            destination = root / "backup.zip"
            summary = backup.create_archive(source, destination, datetime.now().astimezone())
            self.assertEqual(summary, {"tasks": 1, "sessions": 0, "phase": "work"})
            self.assertEqual(before, (list(writer.execute("SELECT * FROM tasks")), list(writer.execute("SELECT * FROM meta"))))
            with zipfile.ZipFile(destination) as archive:
                self.assertEqual(json.loads(archive.read("priorities.json")), {"existing": 5})
                self.assertEqual(json.loads(archive.read("task-durations.json")), {"existing": 30, "removed": 15})
                envelope = json.loads(archive.read("odak-yedek.json"))
                self.assertEqual(envelope["taskDurations"], {"existing": 30})
                data = envelope["data"]
                self.assertEqual(data["timer"], timer)
                self.assertEqual(data["tasks"], [task])
                archive.extract("odak.sqlite3", root / "restored")
            restored = sqlite3.connect(root / "restored/odak.sqlite3")
            self.assertEqual(restored.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(restored.execute("SELECT count(*) FROM tasks").fetchone()[0], 1)
            restored.close()
            writer.execute("INSERT INTO sessions VALUES ('later', '{}')")
            writer.commit()
            writer.close()

    def test_missing_source_is_not_created(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / "missing.sqlite3"
            with self.assertRaises(RuntimeError):
                backup.create_snapshot(source, Path(root) / "backup.sqlite3")
            self.assertFalse(source.exists())

    def test_end_of_day_and_sleep_catchup(self):
        self.assertEqual(backup.scheduled_date(datetime(2026, 10, 8, 23, 54)), "2026-10-07")
        self.assertEqual(backup.scheduled_date(datetime(2026, 10, 8, 23, 55)), "2026-10-08")
        self.assertEqual(backup.scheduled_date(datetime(2026, 10, 9, 8, 0)), "2026-10-08")

    def test_local_only_does_not_mark_upload_as_success(self):
        with tempfile.TemporaryDirectory() as root:
            profile = Path(root)
            backup.write_private_json(profile / "config.json", {"database_path": str(profile / "missing.sqlite3")})
            with self.assertRaises(RuntimeError):
                backup.perform(profile, local_only=True)
            self.assertFalse((profile / "state.json").exists())


if __name__ == "__main__":
    unittest.main()
