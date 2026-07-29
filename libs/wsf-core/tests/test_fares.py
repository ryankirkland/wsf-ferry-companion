from decimal import Decimal

import pytest
from wsf_core.fares import BASIC_FARE_IDS, resolve_fares_verbose


def _pair(resolved, dep, arr):
    return next(p for p in resolved if p.dep_terminal_id == dep and p.arr_terminal_id == arr)


def test_all_38_combos_resolve_without_error(fares_verbose):
    resolved = resolve_fares_verbose(fares_verbose)
    assert len(resolved) == 38
    assert all(p.one_way and p.round_trip for p in resolved)


def test_mukilteo_clinton_prices_correctly(fares_verbose):
    """THE regression: Mukilteo(14)->Clinton(5) adult is $7.10 via
    LineItemLookup. A positional zip reads a different fare table and shows
    $11.35-class prices - silently wrong for a PRD-named commuter run."""
    resolved = resolve_fares_verbose(fares_verbose)
    muk_cl = _pair(resolved, 14, 5)
    adult = next(i for i in muk_cl.one_way if i.id == 1)
    assert adult.amount == Decimal("7.10")

    # Prove the trap is real: positional indexing yields a DIFFERENT price.
    position = next(
        i
        for i, c in enumerate(fares_verbose["TerminalComboVerbose"])
        if c["DepartingTerminalID"] == 14 and c["ArrivingTerminalID"] == 5
    )
    lookup_index = fares_verbose["LineItemLookup"][position]["LineItemIndex"]
    assert lookup_index != position, "trap vanished - re-verify exploration claim"
    positional_adult = next(
        i for i in fares_verbose["LineItems"][position] if i["FareLineItemID"] == 1
    )
    assert Decimal(str(positional_adult["Amount"])) != Decimal("7.10")


def test_round_trip_resolved_independently_and_not_doubled(fares_verbose):
    resolved = resolve_fares_verbose(fares_verbose)
    sea_bi = _pair(resolved, 7, 3)
    ow = {i.id: i.amount for i in sea_bi.one_way}
    rt = {i.id: i.amount for i in sea_bi.round_trip}
    # Passenger adult: collected one end only -> RT == one-way, never 2x.
    assert ow[1] == rt[1]
    # Direction-dependent vehicle item doubles (168: 21.30 -> 42.60).
    assert rt[168] == ow[168] * 2


def test_labels_html_stripped_and_basic_flags(fares_verbose):
    resolved = resolve_fares_verbose(fares_verbose)
    sea_bi = _pair(resolved, 7, 3)
    senior = next(i for i in sea_bi.one_way if i.id == 2)
    assert "<" not in senior.label and "href" not in senior.label
    basic_ids = {i.id for i in sea_bi.one_way if i.basic}
    assert basic_ids <= BASIC_FARE_IDS
    assert 1 in basic_ids


def test_length_mismatch_raises():
    with pytest.raises(ValueError, match="mismatch"):
        resolve_fares_verbose(
            {
                "TerminalComboVerbose": [{}],
                "LineItemLookup": [],
                "LineItems": [],
                "RoundTripLineItems": [],
            }
        )
