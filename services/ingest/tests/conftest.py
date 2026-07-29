import json
from pathlib import Path

import boto3
import pytest
from moto import mock_aws

SAMPLES = Path(__file__).resolve().parents[3] / "api-exploration-wsdot-ferries" / "samples"


def _load(name: str):
    return json.loads((SAMPLES / name).read_text())


TABLE = "wsf-test-hot"
DATA_BUCKET = "wsf-test-data"
RAW_BUCKET = "wsf-test-raw"


@pytest.fixture(scope="session")
def vessellocations_rows():
    return json.loads((SAMPLES / "vessels_vessellocations.json").read_text())


@pytest.fixture(scope="session")
def vesselverbose_rows():
    return json.loads((SAMPLES / "vessels_vesselverbose.json").read_text())


@pytest.fixture(scope="session")
def terminallocations_rows():
    return json.loads((SAMPLES / "terminals_terminallocations.json").read_text())


@pytest.fixture
def aws(monkeypatch):
    """Moto-backed table + buckets + the env the handlers read."""
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-west-2")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("TABLE_NAME", TABLE)
    monkeypatch.setenv("DATA_BUCKET", DATA_BUCKET)
    monkeypatch.setenv("RAW_BUCKET", RAW_BUCKET)
    monkeypatch.setenv("WSF_ACCESS_CODE", "test-code")
    monkeypatch.delenv("DISTRIBUTION_ID", raising=False)
    with mock_aws():
        ddb = boto3.resource("dynamodb")
        ddb.create_table(
            TableName=TABLE,
            KeySchema=[
                {"AttributeName": "PK", "KeyType": "HASH"},
                {"AttributeName": "SK", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": "PK", "AttributeType": "S"},
                {"AttributeName": "SK", "AttributeType": "S"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        s3 = boto3.client("s3")
        for bucket in (DATA_BUCKET, RAW_BUCKET):
            s3.create_bucket(
                Bucket=bucket,
                CreateBucketConfiguration={"LocationConstraint": "us-west-2"},
            )
        yield {"table": ddb.Table(TABLE), "s3": s3}


@pytest.fixture(scope="session")
def schedule_route_envelope():
    """Both directions of sea-bi in one envelope (schedule/{date}/{routeid})."""
    return _load("schedule_schedule_route.json")


@pytest.fixture(scope="session")
def timeadj_rows_ingest():
    return _load("schedule_timeadj.json")


@pytest.fixture(scope="session")
def fares_verbose_ingest():
    return _load("fares_farelineitemsverbose.json")


@pytest.fixture(scope="session")
def alerts_rows_ingest():
    return _load("schedule_alerts.json")
