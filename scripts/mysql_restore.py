#!/usr/bin/env python3
"""Download and verify the newest Odak cloud snapshot as an importable JSON file."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import time

from mysql_sync import DEFAULT_CA, canonical, run_mysql, sha


def fetch_latest(ca_path: Path) -> tuple[dict[str, object], str]:
    output = run_mysql(
        "SELECT snapshot_hash,payload FROM odak_backup_snapshots "
        "ORDER BY revision DESC LIMIT 1;",
        ca_path,
    )
    if not output or "\t" not in output:
        raise SystemExit("Aiven'da geri yüklenebilir Odak anlık görüntüsü bulunamadı.")
    expected_hash, payload = output.split("\t", 1)
    snapshot = json.loads(payload)
    if snapshot.get("format") != "odak-cloud-snapshot" or snapshot.get("version") != 1:
        raise SystemExit("Bulut anlık görüntüsü desteklenmeyen biçimde.")
    if sha(snapshot) != expected_hash:
        raise SystemExit("Bulut anlık görüntüsünün bütünlük doğrulaması başarısız.")
    return snapshot, expected_hash


def importable_backup(snapshot: dict[str, object]) -> dict[str, object]:
    meta = snapshot.get("meta")
    if not isinstance(meta, dict) or "timer" not in meta or "settings" not in meta:
        raise SystemExit("Bulut anlık görüntüsünde zorunlu uygulama durumu eksik.")
    return {
        "format": "odak-backup",
        "version": 1,
        "exportedAt": int(time.time() * 1000),
        "data": {
            "tasks": snapshot.get("tasks", []),
            "sessions": snapshot.get("sessions", []),
            "timer": meta["timer"],
            "settings": meta["settings"],
            "notified": meta.get("notified", []),
            "suspendedWork": meta.get("suspendedWork", {}),
        },
        "priorities": snapshot.get("priorities", meta.get("priorities", {})),
        "taskDurations": snapshot.get("taskDurations", {}),
    }


def write_private_json(path: Path, value: object, overwrite: bool) -> None:
    if path.exists() and not overwrite:
        raise SystemExit(f"Dosya zaten var: {path} (değiştirmek için --force kullanın)")
    path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    descriptor = os.open(path, flags, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="En yeni Aiven anlık görüntüsünü Odak'a aktarılabilir JSON olarak indir."
    )
    parser.add_argument("--ca", type=Path, default=DEFAULT_CA)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path.home() / "Downloads/odak-bulut-yedek.json",
    )
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    snapshot, snapshot_hash = fetch_latest(args.ca)
    backup = importable_backup(snapshot)
    write_private_json(args.output, backup, args.force)
    print(
        canonical(
            {
                "output": str(args.output),
                "tasks": len(backup["data"]["tasks"]),
                "sessions": len(backup["data"]["sessions"]),
                "snapshotHash": snapshot_hash,
            }
        )
    )


if __name__ == "__main__":
    main()
