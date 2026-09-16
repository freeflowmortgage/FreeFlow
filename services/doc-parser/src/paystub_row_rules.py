"""Vendor-agnostic paystub row-kind and frequency rules.

Loaded from paystub_row_rules.json. That catalog is for any payroll/paystub
layout (ADP, Paychex, Workday, Kronos, UKG, in-house). It is not a Banner
Health stub template; Banner exists only as tests/fixtures/banner_health_paystub.json.
"""

from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path
from typing import Any

_RAW: dict[str, Any] = json.loads(Path(__file__).with_name("paystub_row_rules.json").read_text())

EXCLUDE_ROW = re.compile(_RAW["excludeRow"], re.I)
BASE_ROW = re.compile(_RAW["baseRow"], re.I)
PRIMARY_RATE_ROW = re.compile(_RAW["primaryRateRow"], re.I)
BONUS_ROW = re.compile(_RAW["bonusRow"], re.I)
OT_ROW = re.compile(_RAW["otRow"], re.I)
TIPS_ROW = re.compile(_RAW["tipsRow"], re.I)
COMMISSION_ROW = re.compile(_RAW["commissionRow"], re.I)
RSU_ROW = re.compile(_RAW["rsuRow"], re.I)
NON_WORKED = re.compile(_RAW["nonWorked"], re.I)
HOURS_BEFORE_RATE = re.compile(_RAW["hoursBeforeRate"], re.I)
FREQ_SEMI_MONTHLY = re.compile(_RAW["frequency"]["semiMonthly"], re.I)
FREQ_BIWEEKLY = re.compile(_RAW["frequency"]["biweekly"], re.I)
FREQ_WEEKLY = re.compile(_RAW["frequency"]["weekly"], re.I)
FREQ_MONTHLY = re.compile(_RAW["frequency"]["monthly"], re.I)
WEEKLY_SPAN = tuple(_RAW["frequency"]["weeklySpan"])
BIWEEKLY_SPAN = tuple(_RAW["frequency"]["biweeklySpan"])
MONTHLY_SPAN = tuple(_RAW["frequency"]["monthlySpan"])
YTD_FIELD_BY_KIND: dict[str, str] = dict(_RAW["ytdFieldByKind"])
PAYS_PER_YEAR = {"Weekly": 52, "Biweekly": 26, "SemiMonthly": 24, "Monthly": 12}


def frequency_from_dates(blob: str) -> str | None:
    parsed: list[tuple[int, int, int]] = []
    seen: set[tuple[int, int, int]] = set()
    for month, day, year in re.findall(r"\b(\d{1,2})/(\d{1,2})/(\d{2,4})\b", blob):
        y = int(year)
        if y < 100:
            y += 2000
        key = (y, int(month), int(day))
        if key in seen:
            continue
        seen.add(key)
        parsed.append(key)
    if len(parsed) < 2:
        return None
    parsed.sort()
    start = parsed[0]
    end = parsed[1]
    try:
        span = (date(*end) - date(*start)).days
    except ValueError:
        return None
    if WEEKLY_SPAN[0] <= span <= WEEKLY_SPAN[1]:
        return "Weekly"
    if BIWEEKLY_SPAN[0] <= span <= BIWEEKLY_SPAN[1]:
        return "Biweekly"
    if MONTHLY_SPAN[0] <= span <= MONTHLY_SPAN[1]:
        return "Monthly"
    return None


def frequency_type(blob: str) -> str | None:
    if FREQ_SEMI_MONTHLY.search(blob):
        return "SemiMonthly"
    if FREQ_BIWEEKLY.search(blob):
        return "Biweekly"
    if FREQ_WEEKLY.search(blob):
        return "Weekly"
    if FREQ_MONTHLY.search(blob):
        return "Monthly"
    return frequency_from_dates(blob)


def pays_per_year(blob: str) -> int | None:
    return PAYS_PER_YEAR.get(frequency_type(blob) or "", None)


def hours_before_rate(blob: str) -> bool:
    return bool(HOURS_BEFORE_RATE.search(blob))


def is_primary_rate_row(line: str) -> bool:
    return bool(PRIMARY_RATE_ROW.search(line) and not NON_WORKED.search(line))


def row_kind(label: str) -> str | None:
    stripped = re.sub(r"[\$0-9,.\-—/]+", " ", label)
    stripped = re.sub(r"\s+", " ", stripped).strip()
    if not stripped or EXCLUDE_ROW.search(stripped):
        return None
    if OT_ROW.search(label) or OT_ROW.search(stripped):
        return "ot"
    if RSU_ROW.search(stripped):
        return "rsu"
    if TIPS_ROW.search(stripped):
        return "tips"
    if COMMISSION_ROW.search(stripped):
        return "commission"
    if BONUS_ROW.search(stripped):
        return "bonus"
    if BASE_ROW.search(stripped):
        return "regular"
    return None


def weekly_from_period_hours(period_hours: float, pays: int | None) -> float | None:
    if 20 <= period_hours <= 50:
        return period_hours
    if pays:
        return round((period_hours * pays) / 52.0, 2)
    return None
