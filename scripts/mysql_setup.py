#!/usr/bin/env python3
"""Verify the private Aiven account and store its password in macOS Keychain."""

from __future__ import annotations

import argparse
import getpass
import os
from pathlib import Path
import shutil
import subprocess
import sys

from mysql_sync import (
    APP_DATA,
    DATABASE,
    DEFAULT_CA,
    HOST,
    KEYCHAIN_SERVICE,
    PORT,
    USER,
    run_mysql,
)


def save_password(password: str) -> None:
    if sys.platform != "darwin":
        raise SystemExit("Anahtar Zinciri kurulumu yalnızca macOS üzerinde desteklenir.")
    result = subprocess.run(
        [
            "/usr/bin/security",
            "add-generic-password",
            "-U",
            "-a",
            USER,
            "-s",
            KEYCHAIN_SERVICE,
            "-l",
            "Odak Aiven MySQL",
            "-w",
            password,
        ],
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        raise SystemExit("Parola macOS Anahtar Zinciri'ne kaydedilemedi.")


def install_ca(source: Path) -> Path:
    if not source.is_file() or "BEGIN CERTIFICATE" not in source.read_text():
        raise SystemExit(f"Geçerli Aiven CA sertifikası bulunamadı: {source}")
    APP_DATA.mkdir(parents=True, exist_ok=True)
    destination = APP_DATA / "aiven-ca.pem"
    shutil.copyfile(source, destination)
    os.chmod(destination, 0o600)
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Odak Aiven MySQL bağlantısını bu Mac'te güvenli biçimde hazırla."
    )
    parser.add_argument("--ca", type=Path, default=DEFAULT_CA)
    parser.add_argument(
        "--password-stdin",
        action="store_true",
        help="Parolayı etkileşimsiz olarak standart girdiden oku.",
    )
    args = parser.parse_args()

    password = (
        sys.stdin.readline().rstrip("\r\n")
        if args.password_stdin
        else getpass.getpass("Aiven odak_app parolası: ")
    )
    if not password:
        raise SystemExit("Parola boş olamaz.")
    try:
        identity = run_mysql("SELECT CURRENT_USER(), DATABASE();", args.ca, password)
        expected = f"{USER}@%\t{DATABASE}"
        if identity != expected:
            raise SystemExit("Beklenmeyen MySQL hesabı veya veritabanı döndü.")
        save_password(password)
        installed_ca = install_ca(args.ca)
    finally:
        password = ""

    print("Aiven bağlantısı doğrulandı; parola macOS Anahtar Zinciri'nde saklandı.")
    print(f"Sunucu: {HOST}:{PORT}")
    print(f"Veritabanı / kullanıcı: {DATABASE} / {USER}")
    print(f"TLS CA: {installed_ca}")


if __name__ == "__main__":
    main()
