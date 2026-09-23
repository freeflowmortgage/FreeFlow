"""Evidence that parsing leaves no copy of the document behind.

Patching ``open`` would prove nothing here: PDFium and ONNX Runtime are C
extensions that call ``openat`` directly and never pass through CPython's file
layer. So these tests observe the process from outside instead, first by
watching the filesystem for new files and then by reading the syscalls the
kernel actually saw.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import os
import re
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from paystub_fixtures import build_paystub_pdf, build_scanned_paystub_pdf
from paystub import ephemeral, parse_paystub, scrub
from paystub.memory import disable_core_dumps, lock_memory

SRC = str(ROOT / "src")
TESTS = str(Path(__file__).resolve().parent)


def snapshot(*roots: Path) -> set[Path]:
    return {path for root in roots for path in root.rglob("*") if path.is_file()}


@pytest.mark.parametrize("builder", [build_paystub_pdf, build_scanned_paystub_pdf])
def test_parsing_creates_no_files(builder, tmp_path: Path, monkeypatch) -> None:
    """Point every temp-file mechanism at an empty directory and watch it."""
    workspace = tmp_path / "work"
    temp = tmp_path / "temp"
    workspace.mkdir()
    temp.mkdir()

    for variable in ("TMPDIR", "TEMP", "TMP"):
        monkeypatch.setenv(variable, str(temp))
    monkeypatch.chdir(workspace)

    pdf = builder()
    before = snapshot(workspace, temp)
    result = parse_paystub(pdf)
    after = snapshot(workspace, temp)

    assert result.lines, "parse produced nothing, so the check would be vacuous"
    assert after == before, f"parser left files behind: {sorted(after - before)}"


@pytest.mark.skipif(shutil.which("strace") is None, reason="strace not installed")
def test_no_document_bytes_are_written_to_any_file() -> None:
    """Trace the real syscalls and assert nothing was opened for writing.

    Reads are expected and unavoidable: the interpreter loads shared objects
    and the OCR weights. What must not appear is any descriptor opened for
    writing, which is the only way a document byte could reach a disk.
    """
    program = textwrap.dedent(
        f"""
        import sys
        sys.path[:0] = [{SRC!r}, {TESTS!r}]
        from paystub_fixtures import build_scanned_paystub_pdf
        from paystub import parse_paystub
        result = parse_paystub(build_scanned_paystub_pdf())
        assert result.reconciliation.balanced
        print("PARSED", len(result.lines))
        """
    )

    completed = subprocess.run(
        [
            "strace", "-f", "-qq", "-y",
            "-e", "trace=openat,open,creat,rename,link,linkat,mkdir",
            # -B suppresses .pyc caching, which writes compiled code rather than
            # document data. The production image sets PYTHONDONTWRITEBYTECODE
            # for the same reason, so this matches how the service runs.
            sys.executable, "-B", "-c", program,
        ],
        capture_output=True,
        text=True,
        timeout=600,
    )
    assert "PARSED" in completed.stdout, completed.stderr[-4000:]

    # O_WRONLY/O_RDWR/O_CREAT on a path is the only route to a persisted byte.
    write_open = re.compile(r"\b(openat|open)\(.*?\"(?P<path>[^\"]+)\".*?(O_WRONLY|O_RDWR|O_CREAT)")
    offenders = set()
    for oline in completed.stderr.splitlines():
        if oline.strip().endswith("= -1 ENOENT (No such file or directory)"):
            continue  # a failed probe wrote nothing
        match = write_open.search(oline)
        if match:
            offenders.add(match.group("path"))
        elif re.match(r"\s*(creat|rename|link|linkat|mkdir)\(", oline):
            offenders.add(oline.strip())

    # Character devices and procfs are not storage; nothing persists through them.
    offenders = {
        path
        for path in offenders
        if not path.startswith(("/dev/null", "/dev/tty", "/dev/pts", "/dev/urandom", "/proc/"))
    }
    assert not offenders, f"parsing opened something writable: {sorted(offenders)}"


@pytest.mark.skipif(shutil.which("strace") is None, reason="strace not installed")
def test_the_whole_doc_parser_pipeline_writes_nothing() -> None:
    """Cover the service path, not just the pay stub module.

    ONNX Runtime writes a persistent device identifier and a telemetry
    database unless told not to, and that import happens in
    ``ai_pdf_converter``, far from the pay stub code. This fails if that guard
    is ever removed.
    """
    program = textwrap.dedent(
        f"""
        import sys
        sys.path[:0] = [{SRC!r}, {TESTS!r}]
        from ai_pdf_converter import AIPDFConverter
        from irs_form_extract import extract_irs_form_fields
        from paystub_fixtures import build_scanned_paystub_pdf
        from pdf_splitter import pre_split_tax_returns, select_ocr_page_indices

        pdf = build_scanned_paystub_pdf()
        converter = AIPDFConverter()
        inspected = converter.inspect_pages(pdf)
        preview = converter.inspect_as_convert_result(inspected)
        pages = select_ocr_page_indices(inspected, pre_split_tax_returns(preview))
        converted = converter.convert_to_ai_ready(pdf, ocr_page_indices=pages)
        split = pre_split_tax_returns(converted)
        fields = extract_irs_form_fields(
            pdf, ocr_pages=converted.pages, page_indices=split.target_pages
        )
        print("PARSED", len(fields))
        """
    )

    completed = subprocess.run(
        [
            "strace", "-f", "-qq", "-y",
            "-e", "trace=openat,open,creat,rename,link,linkat,mkdir",
            sys.executable, "-B", "-c", program,
        ],
        capture_output=True,
        text=True,
        timeout=900,
    )
    assert "PARSED" in completed.stdout, completed.stderr[-4000:]

    write_open = re.compile(r"\b(openat|open)\(.*?\"(?P<path>[^\"]+)\".*?(O_WRONLY|O_RDWR|O_CREAT)")
    offenders = set()
    for line in completed.stderr.splitlines():
        if line.strip().endswith("= -1 ENOENT (No such file or directory)"):
            continue
        match = write_open.search(line)
        if match:
            offenders.add(match.group("path"))
        elif re.match(r"\s*(creat|rename|link|linkat|mkdir)\(", line):
            offenders.add(line.strip())

    offenders = {
        path
        for path in offenders
        if not path.startswith(("/dev/null", "/dev/tty", "/dev/pts", "/dev/urandom", "/proc/"))
    }
    assert not offenders, f"the parse pipeline opened something writable: {sorted(offenders)}"


def test_scrub_wipes_a_mutable_buffer() -> None:
    buffer = bytearray(build_paystub_pdf()[:512])
    assert any(buffer)
    scrub(buffer)
    assert not any(buffer)


def test_ephemeral_wipes_even_when_the_body_raises() -> None:
    leaked: list[bytearray] = []
    with pytest.raises(RuntimeError):
        with ephemeral(b"%PDF-1.4 sensitive") as buffer:
            leaked.append(buffer)
            raise RuntimeError("boom")
    assert not any(leaked[0])


def test_scrub_ignores_immutable_input() -> None:
    """Immutable bytes cannot be wiped; scrub must not pretend otherwise."""
    scrub(b"immutable", None, "text")


def test_memory_controls_report_rather_than_raise() -> None:
    """A missing capability degrades the guarantee; it must not kill the parse."""
    locked, detail = lock_memory()
    assert isinstance(locked, bool)
    assert detail
    if not locked:
        assert "IPC_LOCK" in detail or "Linux-only" in detail or "libc" in detail
    assert isinstance(disable_core_dumps(), bool)


def test_parse_accepts_a_bytearray_the_caller_can_wipe() -> None:
    with ephemeral(build_paystub_pdf()) as buffer:
        result = parse_paystub(buffer)
        assert result.reconciliation.balanced
    assert not any(buffer)


def test_no_temp_directory_is_configured_by_import() -> None:
    """Importing must not create a scratch directory as a side effect."""
    before = os.environ.get("TMPDIR")
    import importlib

    import paystub

    importlib.reload(paystub)
    assert os.environ.get("TMPDIR") == before
