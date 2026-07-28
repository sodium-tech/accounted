"""Small authenticated HTTP boundary around Arelle's command-line validator.

Accounted posts exact iXBRL bytes as base64. The service writes them only to a
request-scoped temporary directory, executes a pinned Arelle release, parses
its XML log, and returns normalized issues. It never stores report contents.
"""

from __future__ import annotations

import base64
import binascii
import hmac
import importlib.metadata
import json
import os
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse

MAX_JSON_BYTES = int(os.environ.get("MAX_JSON_BYTES", str(8 * 1024 * 1024)))
MAX_IXBRL_BYTES = int(os.environ.get("MAX_IXBRL_BYTES", str(5 * 1024 * 1024)))
VALIDATION_TIMEOUT_SECONDS = int(os.environ.get("VALIDATION_TIMEOUT_SECONDS", "180"))
ARELLE_CACHE_DIR = Path(os.environ.get("ARELLE_CACHE_DIR", "/tmp/arelle-cache"))
VALIDATOR_TOKEN = os.environ.get("VALIDATOR_TOKEN", "")
ALLOWED_TAXONOMY_HOSTS = frozenset(
    host.strip().lower()
    for host in os.environ.get(
        "ALLOWED_TAXONOMY_HOSTS",
        "xbrl.taxonomier.se,www.taxonomier.se,taxonomier.se,www.xbrl.org,xbrl.org,www.w3.org,w3.org",
    ).split(",")
    if host.strip()
)
ARELLE_VERSION = importlib.metadata.version("arelle-release")


class RequestError(Exception):
    def __init__(self, status: HTTPStatus, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def decode_request(body: bytes) -> tuple[str, bytes]:
    try:
        payload = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RequestError(HTTPStatus.BAD_REQUEST, "INVALID-JSON", "Request body must be valid JSON.") from error

    if not isinstance(payload, dict):
        raise RequestError(HTTPStatus.BAD_REQUEST, "INVALID-REQUEST", "Request body must be a JSON object.")

    filename = payload.get("filename")
    encoded = payload.get("content_base64")
    if not isinstance(filename, str) or Path(filename).name != filename or not filename.lower().endswith(".xhtml"):
        raise RequestError(HTTPStatus.BAD_REQUEST, "INVALID-FILENAME", "filename must be a plain .xhtml name.")
    if not isinstance(encoded, str):
        raise RequestError(HTTPStatus.BAD_REQUEST, "INVALID-CONTENT", "content_base64 must be a string.")

    try:
        content = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as error:
        raise RequestError(HTTPStatus.BAD_REQUEST, "INVALID-BASE64", "content_base64 is not valid base64.") from error
    if not content or len(content) > MAX_IXBRL_BYTES:
        raise RequestError(
            HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
            "INVALID-SIZE",
            f"Decoded iXBRL must contain 1-{MAX_IXBRL_BYTES} bytes.",
        )
    return filename, content


def validate_entrypoint(content: bytes) -> None:
    """Reject plain XHTML and non-approved top-level taxonomy entry points."""
    text = content.decode("utf-8", errors="replace")
    if "http://www.xbrl.org/2013/inlineXBRL" not in text:
        raise RequestError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "NOT-INLINE-XBRL",
            "Document does not declare the Inline XBRL 1.1 namespace.",
        )

    try:
        root = ET.fromstring(content)
    except ET.ParseError as error:
        raise RequestError(HTTPStatus.UNPROCESSABLE_ENTITY, "INVALID-XHTML", str(error)) from error

    schema_ref_tag = "{http://www.xbrl.org/2003/linkbase}schemaRef"
    href_key = "{http://www.w3.org/1999/xlink}href"
    refs = [element.attrib.get(href_key, "") for element in root.iter(schema_ref_tag)]
    if not refs:
        raise RequestError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "MISSING-SCHEMAREF",
            "Inline XBRL document contains no taxonomy schemaRef.",
        )
    for href in refs:
        parsed = urlparse(href)
        if parsed.scheme not in {"http", "https"} or (parsed.hostname or "").lower() not in ALLOWED_TAXONOMY_HOSTS:
            raise RequestError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "TAXONOMY-NOT-ALLOWED",
                "Document references a taxonomy host that is not approved.",
            )


def normalize_level(level: str) -> str:
    lowered = level.lower()
    if "error" in lowered or "inconsistency" in lowered or "not-satisfied" in lowered:
        return "error"
    if "warning" in lowered:
        return "warning"
    return "info"


def parse_log(log_path: Path) -> list[dict[str, str]]:
    root = ET.parse(log_path).getroot()
    issues: list[dict[str, str]] = []
    for entry in root.findall("entry"):
        level = entry.attrib.get("level", "info")
        severity = normalize_level(level)
        if severity == "info":
            continue
        message_element = entry.find("message")
        message = "" if message_element is None else "".join(message_element.itertext()).strip()
        issues.append(
            {
                "code": entry.attrib.get("code", "ARELLE").strip() or "ARELLE",
                "severity": severity,
                "message": message or "Arelle reported a validation issue.",
            }
        )
    return issues


def run_arelle(filename: str, content: bytes) -> dict[str, object]:
    validate_entrypoint(content)
    with tempfile.TemporaryDirectory(prefix="arelle-") as directory:
        working = Path(directory)
        input_path = working / filename
        log_path = working / "validation.xml"
        input_path.write_bytes(content)
        # This directory contains only downloaded public taxonomy resources.
        # It intentionally outlives a request so an unreliable/slow STOLAB
        # connection does not redownload the entire Swedish taxonomy graph.
        # The company report remains in `working` and is always deleted.
        ARELLE_CACHE_DIR.mkdir(parents=True, exist_ok=True)

        command = [
            sys.executable,
            "-m",
            "arelle.CntlrCmdLine",
            "--file",
            str(input_path),
            "--validate",
            "--logFile",
            str(log_path),
            "--logFileMode",
            "w",
            "--cacheDirectory",
            str(ARELLE_CACHE_DIR),
        ]
        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=VALIDATION_TIMEOUT_SECONDS,
                check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise RequestError(HTTPStatus.GATEWAY_TIMEOUT, "ARELLE-TIMEOUT", "Arelle validation timed out.") from error

        if not log_path.exists():
            detail = (completed.stderr or completed.stdout or "Arelle produced no validation log.").strip()
            raise RequestError(HTTPStatus.BAD_GATEWAY, "ARELLE-NO-LOG", detail[:500])

        issues = parse_log(log_path)
        if completed.returncode != 0 and not any(issue["severity"] == "error" for issue in issues):
            issues.append(
                {
                    "code": "ARELLE-EXIT",
                    "severity": "error",
                    "message": f"Arelle exited with status {completed.returncode}.",
                }
            )
        return {
            "ok": not any(issue["severity"] == "error" for issue in issues),
            "validator_version": ARELLE_VERSION,
            "issues": issues,
        }


class Handler(BaseHTTPRequestHandler):
    server_version = "AccountedArelle/1"

    def log_message(self, message_format: str, *args: object) -> None:
        print(f"arelle-validator: {message_format % args}", flush=True)

    def send_json(self, status: HTTPStatus, payload: dict[str, object]) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:
        if self.path != "/health":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        self.send_json(HTTPStatus.OK, {"ok": True, "validator_version": ARELLE_VERSION})

    def do_POST(self) -> None:
        if self.path != "/validate":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        expected = f"Bearer {VALIDATOR_TOKEN}"
        if not VALIDATOR_TOKEN or not hmac.compare_digest(self.headers.get("Authorization", ""), expected):
            self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_JSON_BYTES:
            self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "request too large"})
            return

        try:
            filename, content = decode_request(self.rfile.read(length))
            self.send_json(HTTPStatus.OK, run_arelle(filename, content))
        except RequestError as error:
            self.send_json(
                error.status,
                {
                    "ok": False,
                    "validator_version": ARELLE_VERSION,
                    "issues": [{"code": error.code, "severity": "error", "message": error.message}],
                },
            )
        except Exception as error:  # fail closed without exposing a traceback or document bytes
            print(f"arelle-validator: unexpected error: {type(error).__name__}: {error}", flush=True)
            self.send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {
                    "ok": False,
                    "validator_version": ARELLE_VERSION,
                    "issues": [{"code": "VALIDATOR-ERROR", "severity": "error", "message": "Validation failed."}],
                },
            )


def main() -> None:
    if not VALIDATOR_TOKEN:
        raise SystemExit("VALIDATOR_TOKEN must be configured")
    port = int(os.environ.get("PORT", "8080"))
    server = HTTPServer(("0.0.0.0", port), Handler)
    print(f"arelle-validator: listening on {port}, Arelle {ARELLE_VERSION}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
