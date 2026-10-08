#!/usr/bin/env python3
"""Optional host-side backups. Odak itself stays offline and is never restarted.

The source is opened read-only. SQLite's online backup includes uncheckpointed
WAL pages without copying a potentially inconsistent live database file.
"""
import argparse
import contextlib
import fcntl
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import time
from datetime import datetime, timedelta
import uuid
import zipfile

DEFAULT_PROFILE = Path.home() / "Library/Application Support/Odak Backup"
SCOPES = ["https://www.googleapis.com/auth/drive.file"]


def read_json(path, default=None):
    if not path.exists() and default is not None:
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_private_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix=".odak-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def scheduled_date(now):
    """A run missed during sleep is caught up at the next hourly check/login."""
    if (now.hour, now.minute) < (23, 55):
        now -= timedelta(days=1)
    return now.date().isoformat()


def create_snapshot(source, destination):
    if not source.is_file():
        raise RuntimeError("Odak veritabanı bulunamadı; hiçbir dosya oluşturulmadı.")
    started = time.monotonic()

    def progress(status, remaining, total):
        if time.monotonic() - started > 60:
            raise RuntimeError("Yedekleme zaman aşımına uğradı; kaynak veriler değişmedi.")

    with contextlib.closing(sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True, timeout=5)) as origin:
        origin.execute("PRAGMA query_only=ON")
        with contextlib.closing(sqlite3.connect(destination)) as target:
            origin.backup(target, pages=256, progress=progress, sleep=0.01)
            # Only the backup is converted to a single-file journal format.
            target.execute("PRAGMA journal_mode=DELETE")
            if target.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise RuntimeError("Yedek bütünlük kontrolünden geçmedi.")
    os.chmod(destination, 0o600)


def data_from_snapshot(path):
    with contextlib.closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)) as connection:
        meta = {key: json.loads(payload) for key, payload in connection.execute("SELECT key,payload FROM meta")}
        return {
            "tasks": [json.loads(row[0]) for row in connection.execute("SELECT payload FROM tasks ORDER BY rowid")],
            "sessions": [json.loads(row[0]) for row in connection.execute("SELECT payload FROM sessions ORDER BY rowid")],
            "timer": meta["timer"],
            "settings": meta["settings"],
            "notified": meta.get("notified", []),
        }


def create_archive(source, destination, now):
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.TemporaryDirectory(prefix="odak-snapshot-") as temporary:
        snapshot = Path(temporary) / "odak.sqlite3"
        create_snapshot(source, snapshot)
        data = data_from_snapshot(snapshot)
        envelope = {"format": "odak-backup", "version": 1, "exportedAt": int(now.timestamp() * 1000), "data": data}
        part = destination.with_suffix(".zip.part")
        try:
            with zipfile.ZipFile(part, "w", zipfile.ZIP_DEFLATED) as archive:
                archive.write(snapshot, "odak.sqlite3")
                archive.writestr("odak-yedek.json", json.dumps(envelope, ensure_ascii=False, indent=2))
                for name in ("labels.json", "priorities.json"):
                    preference = source.with_name(name)
                    if preference.is_file():
                        archive.writestr(name, preference.read_bytes())
                archive.writestr("GERI-YUKLEME.txt", "ZIP'i açın. Odak'ta Ayarlar > JSON içe aktar ile odak-yedek.json dosyasını seçin.\nSayaç çalışırken geri yükleme yapılamaz. Mevcut veriler önce kurtarma kopyasına alınır.\nSQLite alternatifidir; canlı veritabanının üzerine kopyalamayın.\nEtiket seçim listesi labels.json, yıldız öncelikleri priorities.json dosyasında ayrı tutulur.\n")
            os.chmod(part, 0o600)
            os.replace(part, destination)
        finally:
            if part.exists():
                part.unlink()
        return {"tasks": len(data["tasks"]), "sessions": len(data["sessions"]), "phase": data["timer"]["phase"]}


def drive_service(profile, token_source):
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build
    from google_auth_httplib2 import AuthorizedHttp
    import httplib2
    cached = profile / "token.json"
    credentials = Credentials.from_authorized_user_file(str(cached if cached.exists() else token_source), SCOPES)
    if not credentials.valid:
        if credentials.refresh_token:
            credentials.refresh(Request())
        else:
            raise RuntimeError("Mevcut Drive izni yenilenemiyor. Yeniden giriş gerekli.")
    # The Obsidian token is read once; its file is never overwritten.
    write_private_json(cached, json.loads(credentials.to_json()))
    return build("drive", "v3", http=AuthorizedHttp(credentials, http=httplib2.Http(timeout=30)), cache_discovery=False)


def backup_folder(service, state):
    if state.get("folder_id"):
        return state["folder_id"]
    folders = service.files().list(q="trashed=false and mimeType='application/vnd.google-apps.folder' and name='Odak' and appProperties has { key='odakBackup' and value='v1' }", fields="files(id)", pageSize=100).execute().get("files", [])
    if folders:
        return folders[0]["id"]
    return service.files().create(body={"name": "Odak", "mimeType": "application/vnd.google-apps.folder", "appProperties": {"odakBackup": "v1"}}, fields="id").execute()["id"]


def perform(profile, local_only=False, manual=False):
    profile.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (profile / "backup.lock").open("a") as lock:
        os.chmod(profile / "backup.lock", 0o600)
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("Başka bir Odak yedeği çalışıyor; atlandı.")
            return
        config = read_json(profile / "config.json")
        state = read_json(profile / "state.json", {})
        now = datetime.now().astimezone()
        due = scheduled_date(now)
        if not manual and state.get("last_scheduled_date", "") >= due:
            print("Günlük Odak yedeği zaten alındı.")
            return
        source = Path(config["database_path"]).expanduser()
        archive = profile / "backups" / f"Odak_{now.strftime('%Y-%m-%d_%H-%M-%S')}_{uuid.uuid4().hex[:8]}.zip"
        summary = create_archive(source, archive, now)
        if local_only:
            print(json.dumps({"archive": str(archive), **summary}, ensure_ascii=False))
            return
        service = drive_service(profile, Path(config["token_source"]).expanduser())
        folder_id = backup_folder(service, state)
        from googleapiclient.http import MediaFileUpload
        uploaded = service.files().create(body={"name": archive.name, "parents": [folder_id], "appProperties": {"odakBackup": "v1"}}, media_body=MediaFileUpload(str(archive), mimetype="application/zip", resumable=True), fields="id,name,size").execute()
        # Verify remote metadata before marking a run successful. Never delete backups.
        if int(uploaded.get("size", 0)) != archive.stat().st_size:
            raise RuntimeError("Drive yedek boyutu doğrulanamadı; yerel yedek korundu.")
        state.update(folder_id=folder_id, last_uploaded_at=now.isoformat(), last_filename=archive.name, last_drive_id=uploaded["id"], **summary)
        if not manual:
            state["last_scheduled_date"] = due
        write_private_json(profile / "state.json", state)
        print(json.dumps({"uploaded": archive.name, "folder": "Odak", **summary}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description="Odak verilerini sayacı durdurmadan yedekle.")
    parser.add_argument("--profile", type=Path, default=DEFAULT_PROFILE)
    parser.add_argument("--local-only", action="store_true")
    parser.add_argument("--manual", action="store_true")
    args = parser.parse_args()
    try:
        perform(args.profile, args.local_only, args.manual)
    except Exception as error:
        # Credential/server exceptions can include URLs or secrets. Print only type.
        message = str(error) if isinstance(error, (RuntimeError, FileNotFoundError)) else type(error).__name__
        print(f"Odak yedekleme başarısız: {message}. Kaynak veriler değiştirilmedi.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
