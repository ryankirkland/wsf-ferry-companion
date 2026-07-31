"""Minimal Athena runner: submit, poll, page results into typed dicts.

The workgroup enforces the result location and the 2 GB scan cutoff, so
callers pass only SQL. Failure is loud: a stats run on a partially
executed query would publish silently wrong numbers.
"""

import time

import boto3

TERMINAL = {"SUCCEEDED", "FAILED", "CANCELLED"}
POLL_S = 1.0


class AthenaError(RuntimeError):
    pass


def _cast(value: str | None, athena_type: str):
    if value is None:
        return None
    if athena_type in ("bigint", "integer", "smallint", "tinyint"):
        return int(value)
    if athena_type in ("double", "real", "float", "decimal"):
        return float(value)
    if athena_type == "boolean":
        return value == "true"
    return value


class Athena:
    def __init__(self, database: str, workgroup: str, client=None, poll_s: float = POLL_S):
        self.database = database
        self.workgroup = workgroup
        self.client = client or boto3.client("athena")
        self.poll_s = poll_s
        self.bytes_scanned = 0

    def query(self, sql: str) -> list[dict]:
        qid = self.client.start_query_execution(
            QueryString=sql,
            QueryExecutionContext={"Database": self.database},
            WorkGroup=self.workgroup,
        )["QueryExecutionId"]

        while True:
            execution = self.client.get_query_execution(QueryExecutionId=qid)["QueryExecution"]
            state = execution["Status"]["State"]
            if state in TERMINAL:
                break
            time.sleep(self.poll_s)

        if state != "SUCCEEDED":
            reason = execution["Status"].get("StateChangeReason", state)
            raise AthenaError(f"{state}: {reason}")
        self.bytes_scanned += execution.get("Statistics", {}).get("DataScannedInBytes", 0)

        rows: list[dict] = []
        columns: list[tuple[str, str]] = []
        paginator = self.client.get_paginator("get_query_results")
        for page_index, page in enumerate(paginator.paginate(QueryExecutionId=qid)):
            if not columns:
                columns = [
                    (c["Name"], c["Type"])
                    for c in page["ResultSet"]["ResultSetMetadata"]["ColumnInfo"]
                ]
            # Athena repeats the header as the first row of the first page.
            page_rows = (
                page["ResultSet"]["Rows"][1:] if page_index == 0 else page["ResultSet"]["Rows"]
            )
            for row in page_rows:
                data = row["Data"]
                rows.append(
                    {
                        name: _cast(cell.get("VarCharValue"), athena_type)
                        for (name, athena_type), cell in zip(columns, data, strict=False)
                    }
                )
        return rows
