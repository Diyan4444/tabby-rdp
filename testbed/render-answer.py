#!/usr/bin/env python3
"""Render an unattended answer file; credentials arrive only on stdin, never in argv."""
import pathlib
import re
import sys
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape


def render(template, values):
    computer, administrator, password, server_args = values
    replacements = {
        "COMPUTER_NAME": computer,
        "ADMIN_USER": "tabbyadmin",
        "TEST_USER": "tabbyrdp",
        "ADMIN_PASSWORD": administrator,
        "SERVER_ARGS": server_args,
    }
    template = re.sub(r"@@([A-Z_]+)@@", lambda match: escape(replacements[match[1]], {'"': '&quot;', "'": '&apos;'}), template)
    ET.fromstring(template)
    return template, password


if __name__ == "__main__":
    values = sys.stdin.buffer.read().decode("utf-8").split("\0")
    if len(values) != 4:
        raise ValueError("expected four NUL-separated fields on stdin")
    answer, password = render(pathlib.Path(sys.argv[1]).read_text(), values)
    destination = pathlib.Path(sys.argv[2])
    (destination / "autounattend.xml").write_text(answer, encoding="utf-8")
    (destination / "test-password.txt").write_text(password, encoding="utf-8")
