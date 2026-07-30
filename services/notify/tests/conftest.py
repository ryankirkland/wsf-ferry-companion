import json

import boto3
import pytest
from moto import mock_aws

TABLE = "wsf-test-hot"
DATA_BUCKET = "wsf-test-data"
SECRETS_PARAM = "/wsf/test/alert-link-secrets"
LINK_SECRETS = {"k1": "test-secret"}

INDEX = {
    "v": 1,
    "pairs": [
        {
            "dep": 7,
            "arr": 3,
            "dep_name": "Seattle",
            "arr_name": "Bainbridge Island",
            "slug": "seattle-bainbridge-island",
            "route_id": 5,
        },
        {
            "dep": 3,
            "arr": 7,
            "dep_name": "Bainbridge Island",
            "arr_name": "Seattle",
            "slug": "bainbridge-island-seattle",
            "route_id": 5,
        },
        {
            "dep": 1,
            "arr": 10,
            "dep_name": "Anacortes",
            "arr_name": "Friday Harbor",
            "slug": "anacortes-friday-harbor",
            "route_id": None,
        },
    ],
}


@pytest.fixture
def aws(monkeypatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-west-2")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("TABLE_NAME", TABLE)
    monkeypatch.setenv("DATA_BUCKET", DATA_BUCKET)
    monkeypatch.setenv("LINK_SECRETS_PARAM", SECRETS_PARAM)
    monkeypatch.setenv("SITE_ORIGIN", "https://ferrysound.com")

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
        s3.create_bucket(
            Bucket=DATA_BUCKET,
            CreateBucketConfiguration={"LocationConstraint": "us-west-2"},
        )
        s3.put_object(
            Bucket=DATA_BUCKET, Key="data/pairs/index.json", Body=json.dumps(INDEX).encode()
        )
        ssm = boto3.client("ssm", region_name="us-west-2")
        ssm.put_parameter(Name=SECRETS_PARAM, Type="SecureString", Value=json.dumps(LINK_SECRETS))

        # Module-level caches must not leak across tests.
        from wsf_notify import api as api_mod

        api_mod._index_cache = None
        api_mod._secrets_cache = None

        yield {"table": table, "s3": s3}


def jwt_event(
    route_key: str, *, sub="user-1", email="Rider@Example.com", body=None, path=None, qs=None
):
    return {
        "routeKey": route_key,
        "body": json.dumps(body) if isinstance(body, dict) else body,
        "pathParameters": path or {},
        "queryStringParameters": qs or {},
        "requestContext": {"authorizer": {"jwt": {"claims": {"sub": sub, "email": email}}}},
    }
