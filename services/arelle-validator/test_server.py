import base64
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("VALIDATOR_TOKEN", "test-token")

import server


VALID_DOCUMENT = b'''<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"
 xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"
 xmlns:link="http://www.xbrl.org/2003/linkbase"
 xmlns:xlink="http://www.w3.org/1999/xlink">
 <head><link:schemaRef xlink:type="simple" xlink:href="http://xbrl.taxonomier.se/test.xsd"/></head>
 <body><ix:header/></body>
</html>'''


class ValidatorTests(unittest.TestCase):
    def test_decode_rejects_traversal_filename(self):
        body = ('{"filename":"../x.xhtml","content_base64":"' + base64.b64encode(VALID_DOCUMENT).decode() + '"}').encode()
        with self.assertRaisesRegex(server.RequestError, "plain .xhtml"):
            server.decode_request(body)

    def test_rejects_plain_xhtml(self):
        with self.assertRaisesRegex(server.RequestError, "Inline XBRL"):
            server.validate_entrypoint(b'<html xmlns="http://www.w3.org/1999/xhtml"/>')

    def test_rejects_unapproved_taxonomy_host(self):
        content = VALID_DOCUMENT.replace(b"xbrl.taxonomier.se", b"127.0.0.1")
        with self.assertRaisesRegex(server.RequestError, "not approved"):
            server.validate_entrypoint(content)

    def test_parses_warning_and_error_log(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "log.xml"
            path.write_text(
                '<log><entry code="WARN" level="warning"><message>Review</message></entry>'
                '<entry code="ERR" level="error"><message>Broken</message></entry>'
                '<entry code="info" level="info"><message>Loaded</message></entry></log>',
                encoding="utf-8",
            )
            self.assertEqual(
                server.parse_log(path),
                [
                    {"code": "WARN", "severity": "warning", "message": "Review"},
                    {"code": "ERR", "severity": "error", "message": "Broken"},
                ],
            )

    @patch("server.subprocess.run")
    def test_run_arelle_returns_fail_closed_normalized_response(self, run):
        def execute(command, **_kwargs):
            log_path = Path(command[command.index("--logFile") + 1])
            log_path.write_text(
                '<log><entry code="xbrl.5.1" level="error"><message>Invalid fact</message></entry></log>',
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": "", "stdout": ""})()

        run.side_effect = execute
        result = server.run_arelle("report.xhtml", VALID_DOCUMENT)
        self.assertFalse(result["ok"])
        self.assertEqual(result["validator_version"], server.ARELLE_VERSION)
        self.assertEqual(result["issues"][0]["code"], "xbrl.5.1")


if __name__ == "__main__":
    unittest.main()
