from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from form_signatures import PAYSTUB_TITLE  # noqa: E402
from ocr_match import fold_alternatives, pattern_matches  # noqa: E402


def test_a_grouped_alternation_is_not_a_title_of_its_own() -> None:
    folded = fold_alternatives(r"Earnings Statement|Year[- ]to[- ]Date\s+(?:Gross|Earnings)")
    assert folded == [["earningsstatement"], ["yeartodate"]]


def test_the_word_earnings_alone_is_not_a_pay_stub() -> None:
    blob = "Tax on the corporation's share of undistributed earnings of a qualified electing fund"
    assert not pattern_matches(PAYSTUB_TITLE, blob)


def test_ocr_that_drops_spaces_still_matches_a_pay_stub_title() -> None:
    assert pattern_matches(PAYSTUB_TITLE, "ACME CORP EARNINGSSTATEMENT period ending")
    assert pattern_matches(PAYSTUB_TITLE, "YEARTODATE GROSS 51,200.00")


def test_pipes_inside_a_character_class_do_not_split() -> None:
    assert fold_alternatives(r"Form[|]1065 Return|Schedule K-1") == [["form1065return"], ["schedulek1"]]
