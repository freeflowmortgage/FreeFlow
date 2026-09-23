"""In-memory pay stub parser.

    from paystub import parse_paystub

    result = parse_paystub(pdf_bytes)
    result.income.base_ytd
    result.reconciliation.balanced

The document never reaches the filesystem: no temporary files, no spooled
uploads, no cached rasters. See :mod:`paystub.memory` for the swap and
buffer-wiping controls that surround this code path.
"""

from .memory import disable_core_dumps, ephemeral, lock_memory, scrub
from .models import (
    EarningCategory,
    EarningLine,
    Identity,
    IncomeSummary,
    OverlayBox,
    PaystubResult,
    Reconciliation,
    Token,
    Totals,
)
from .overlay import income_fields
from .parser import parse_paystub
from .taxonomy import classify

__all__ = [
    "EarningCategory",
    "EarningLine",
    "Identity",
    "IncomeSummary",
    "OverlayBox",
    "PaystubResult",
    "Reconciliation",
    "Token",
    "Totals",
    "classify",
    "income_fields",
    "disable_core_dumps",
    "ephemeral",
    "lock_memory",
    "parse_paystub",
    "scrub",
]
