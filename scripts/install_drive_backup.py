#!/usr/bin/env python3
"""Install the independent host backup using an existing Obsidian Drive login."""
import argparse
import json
from pathlib import Path
import plistlib
import shutil
import subprocess
import os
from drive_backup import DEFAULT_PROFILE, write_private_json

parser = argparse.ArgumentParser()
parser.add_argument("--obsidian-project", type=Path, default=Path.home() / "Projects/obsidian-backup")
parser.add_argument("--database", type=Path, default=Path.home() / "Library/Application Support/com.mahmutcskn.odak/odak.sqlite3")
args = parser.parse_args()
python = args.obsidian_project / "venv/bin/python"
token = args.obsidian_project / "token.json"
if not python.is_file() or not token.is_file() or not args.database.is_file():
    raise SystemExit("Mevcut Obsidian Python ortamı, Drive izni veya Odak veritabanı bulunamadı.")
profile = DEFAULT_PROFILE
profile.mkdir(parents=True, exist_ok=True, mode=0o700)
shutil.copy2(Path(__file__).with_name("drive_backup.py"), profile / "drive_backup.py")
write_private_json(profile / "config.json", {"database_path": str(args.database.resolve()), "token_source": str(token.resolve())})
launch_agent = Path.home() / "Library/LaunchAgents/com.mahmutcskn.odak-backup.plist"
launch_agent.parent.mkdir(parents=True, exist_ok=True)
agent = {"Label": "com.mahmutcskn.odak-backup", "ProgramArguments": [str(python), str(profile / "drive_backup.py"), "--profile", str(profile)], "RunAtLoad": True, "StartCalendarInterval": {"Hour": 23, "Minute": 55}, "StartInterval": 3600, "ThrottleInterval": 60, "StandardOutPath": str(profile / "backup.log"), "StandardErrorPath": str(profile / "backup-error.log")}
launch_agent.write_bytes(plistlib.dumps(agent))
os.chmod(launch_agent, 0o600)
# Only this dedicated agent is touched, never Odak or Obsidian launch agents.
subprocess.run(["launchctl", "bootout", f"gui/{os.getuid()}/com.mahmutcskn.odak-backup"], capture_output=True)
subprocess.run(["launchctl", "bootstrap", f"gui/{os.getuid()}", str(launch_agent)], check=True)
subprocess.run(["launchctl", "enable", f"gui/{os.getuid()}/com.mahmutcskn.odak-backup"], check=True)
print(json.dumps({"installed": str(launch_agent), "schedule": "23:55; uyku/çevrimdışı durumunda saatlik tekrar", "profile": str(profile)}, ensure_ascii=False))
