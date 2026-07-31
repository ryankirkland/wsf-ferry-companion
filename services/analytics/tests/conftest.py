import json

import boto3
import pytest
from moto import mock_aws

TABLE = "wsf-test-hot"
RAW = "wsf-test-raw"
DATA = "wsf-test-data"

VESSELS = {
    "vessels": [
        {"id": 1, "name": "Tacoma"},
        {"id": 2, "name": "Walla Walla"},
        {"id": 3, "name": "Salish"},
    ]
}


@pytest.fixture
def aws(monkeypatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-west-2")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("TABLE_NAME", TABLE)
    monkeypatch.setenv("RAW_BUCKET", RAW)
    monkeypatch.setenv("DATA_BUCKET", DATA)

    with mock_aws():
        ddb = boto3.resource("dynamodb", region_name="us-west-2")
        table = ddb.create_table(
            TableName=TABLE,
            BillingMode="PAY_PER_REQUEST",
            KeySchema=[
                {"AttributeName": "PK", "KeyType": "HASH"},
                {"AttributeName": "SK", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": "PK", "AttributeType": "S"},
                {"AttributeName": "SK", "AttributeType": "S"},
            ],
        )
        s3 = boto3.client("s3", region_name="us-west-2")
        for b in (RAW, DATA):
            s3.create_bucket(
                Bucket=b, CreateBucketConfiguration={"LocationConstraint": "us-west-2"}
            )
        s3.put_object(Bucket=DATA, Key="data/vessels.json", Body=json.dumps(VESSELS).encode())
        yield {"table": table, "s3": s3}
