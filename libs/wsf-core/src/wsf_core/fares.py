"""Fares: the farelineitemsverbose resolver and typed line items.

THE trap this module exists to prevent (verified 2026-07-24, recounted
2026-07-29): farelineitemsverbose's four parallel arrays MUST be joined via
LineItemLookup - a positional zip silently misprices 13 of 38 combos
(Mukilteo-Clinton would show $11.35 instead of $7.10) and IndexErrors on 11
more. Amounts are 4-decimal floats on the wire - handled as Decimal, never
float math.
"""

from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from wsf_core.schedule import strip_html

# The curated farelineitemsbasic subset (verified proper subset) - the UI's
# default list; everything else sits behind "all fares".
BASIC_FARE_IDS = frozenset({1, 2, 3, 4, 13, 16, 37, 168, 170, 178, 180, 188, 189})


class FareLineItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore", frozen=True)

    id: int = Field(alias="FareLineItemID")
    label: str = Field(alias="FareLineItem")
    category: str = Field(alias="Category")
    direction_independent: bool = Field(alias="DirectionIndependent")
    amount: Decimal = Field(alias="Amount")

    @field_validator("label")
    @classmethod
    def _strip(cls, v: str) -> str:
        return strip_html(v)

    @field_validator("amount", mode="before")
    @classmethod
    def _decimal(cls, v: object) -> Decimal:
        # Through str() so float wire values (11.35) become exact decimals.
        return Decimal(str(v)).quantize(Decimal("0.01"))

    @property
    def basic(self) -> bool:
        return self.id in BASIC_FARE_IDS


class PairFares(BaseModel):
    model_config = ConfigDict(frozen=True)

    dep_terminal_id: int
    arr_terminal_id: int
    collection: str
    one_way: list[FareLineItem]
    round_trip: list[FareLineItem]


def resolve_fares_verbose(payload: dict) -> list[PairFares]:
    """Join the four parallel arrays via LineItemLookup - NEVER positionally.

    RoundTripLineItemIndex is resolved independently of LineItemIndex even
    though the two were equal in every observed row.
    """
    combos = payload["TerminalComboVerbose"]
    lookup = payload["LineItemLookup"]
    line_items = payload["LineItems"]
    round_trip_items = payload["RoundTripLineItems"]

    if len(combos) != len(lookup):
        raise ValueError(f"combo/lookup length mismatch: {len(combos)} vs {len(lookup)}")

    resolved = []
    for combo, entry in zip(combos, lookup, strict=True):
        one_way = line_items[entry["LineItemIndex"]]
        round_trip = round_trip_items[entry["RoundTripLineItemIndex"]]
        resolved.append(
            PairFares(
                dep_terminal_id=combo["DepartingTerminalID"],
                arr_terminal_id=combo["ArrivingTerminalID"],
                collection=strip_html(combo.get("CollectionDescription") or ""),
                one_way=[FareLineItem.model_validate(i) for i in one_way],
                round_trip=[FareLineItem.model_validate(i) for i in round_trip],
            )
        )
    return resolved
