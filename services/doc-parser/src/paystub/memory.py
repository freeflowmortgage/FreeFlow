"""Zero-retention helpers.

The parser never writes a document to disk. That is a property of the code
path (see :mod:`paystub.extract`), not something this module can enforce.
What this module adds is the two controls that code path cannot express by
itself: keeping decrypted pages out of swap, and wiping buffers once the
request is answered.

Honest limits, because a control that is oversold is worse than no control:

* CPython cannot wipe an immutable ``bytes`` object. Interning, slicing, and
  C-extension copies all produce unreachable duplicates. Pass a ``bytearray``
  into :func:`scrub` and the buffer you own is wiped; copies taken by a
  third-party library are not.
* :func:`lock_memory` needs ``RLIMIT_MEMLOCK`` headroom, which usually means
  ``IPC_LOCK`` on the container. It reports failure rather than raising so a
  deployment without the capability still runs; check the return value if you
  need the guarantee.
"""

from __future__ import annotations

import ctypes
import ctypes.util
import os
import resource
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

_MCL_CURRENT = 1
_MCL_FUTURE = 2


def _libc() -> ctypes.CDLL | None:
    name = ctypes.util.find_library("c")
    if name is None:
        return None
    try:
        return ctypes.CDLL(name, use_errno=True)
    except OSError:
        return None


def lock_memory() -> tuple[bool, str]:
    """Pin this process's pages in RAM so document bytes cannot reach swap.

    Returns ``(locked, detail)``. Never raises: a parser that refuses to start
    because it lacks a capability is a worse outcome than one that reports it.
    """
    if not hasattr(os, "uname") or os.uname().sysname != "Linux":
        return False, "mlockall is Linux-only"

    libc = _libc()
    if libc is None:
        return False, "libc not loadable"

    soft, _ = resource.getrlimit(resource.RLIMIT_MEMLOCK)
    if libc.mlockall(_MCL_CURRENT | _MCL_FUTURE) != 0:
        err = ctypes.get_errno()
        limit = "unlimited" if soft == resource.RLIM_INFINITY else f"{soft} bytes"
        return False, f"mlockall failed (errno {err}, RLIMIT_MEMLOCK {limit}); grant IPC_LOCK"
    return True, "process memory locked (MCL_CURRENT|MCL_FUTURE)"


def disable_core_dumps() -> bool:
    """Stop the kernel writing a core file that would contain document bytes."""
    try:
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    except (ValueError, OSError):
        return False
    return True


def scrub(*buffers: Any) -> None:
    """Best-effort overwrite of mutable buffers with zeros.

    Accepts ``bytearray``, ``memoryview``, and anything exposing a writable
    buffer such as a NumPy array. Silently skips immutable objects, which
    keeps teardown paths free of defensive try/except noise.
    """
    for buf in buffers:
        if buf is None:
            continue
        if isinstance(buf, bytearray):
            ctypes.memset((ctypes.c_char * len(buf)).from_buffer(buf), 0, len(buf))
            continue
        fill = getattr(buf, "fill", None)
        if callable(fill):
            fill(0)
            continue
        try:
            view = memoryview(buf)
        except TypeError:
            continue
        if not view.readonly:
            view.cast("B")[:] = b"\x00" * view.nbytes


@contextmanager
def ephemeral(data: bytes | bytearray) -> Iterator[bytearray]:
    """Yield a mutable copy of ``data`` and wipe it on exit, including on error."""
    buf = bytearray(data)
    try:
        yield buf
    finally:
        scrub(buf)
