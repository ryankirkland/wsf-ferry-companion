import boto3
import pytest
from moto import mock_aws

BUCKET = "wsf-test-data"


@pytest.fixture
def aws(monkeypatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-west-2")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")
    monkeypatch.setenv("DATA_BUCKET", BUCKET)
    monkeypatch.setenv("AIRNOW_KEY_PARAM", "/wsf/test/airnow-api-key")
    with mock_aws():
        boto3.client("s3").create_bucket(
            Bucket=BUCKET,
            CreateBucketConfiguration={"LocationConstraint": "us-west-2"},
        )
        boto3.client("ssm").put_parameter(
            Name="/wsf/test/airnow-api-key", Type="SecureString", Value="test-key"
        )
        yield
