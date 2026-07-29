"""Access-code lookup: WSF_ACCESS_CODE env var overrides SSM.

The env override keeps local dev and tests entirely off AWS; Lambda gets the
code from the SecureString parameter, cached for the container lifetime.
boto3 is imported lazily so wsf-core itself carries no AWS dependency (the
Lambda runtime always provides boto3).
"""

import os

_DEFAULT_PARAM = "/wsf/prod/wsf-access-code"
_cache: dict[str, str] = {}


def get_access_code() -> str:
    env = os.environ.get("WSF_ACCESS_CODE")
    if env:
        return env
    param = os.environ.get("WSF_ACCESS_CODE_PARAM", _DEFAULT_PARAM)
    if param not in _cache:
        import boto3

        resp = boto3.client("ssm").get_parameter(Name=param, WithDecryption=True)
        _cache[param] = resp["Parameter"]["Value"]
    return _cache[param]
