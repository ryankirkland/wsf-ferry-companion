import json
from pathlib import Path

import pytest

# The API exploration's checked-in payloads are the golden fixtures: real
# upstream responses captured 2026-07-24, quirks included.
SAMPLES = Path(__file__).resolve().parents[3] / "api-exploration-wsdot-ferries" / "samples"


def _load(name: str):
    return json.loads((SAMPLES / name).read_text())


@pytest.fixture(scope="session")
def vessellocations_rows():
    return _load("vessels_vessellocations.json")


@pytest.fixture(scope="session")
def vesselverbose_rows():
    return _load("vessels_vesselverbose.json")


@pytest.fixture(scope="session")
def terminallocations_rows():
    return _load("terminals_terminallocations.json")


@pytest.fixture(scope="session")
def schedule_pair_envelope():
    return _load("schedule_schedule_terminalcombo.json")


@pytest.fixture(scope="session")
def fares_verbose():
    return _load("fares_farelineitemsverbose.json")


@pytest.fixture(scope="session")
def timeadj_rows():
    return _load("schedule_timeadj.json")


@pytest.fixture(scope="session")
def alerts_rows():
    return _load("schedule_alerts.json")
