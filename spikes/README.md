# Phase C Spike Kit - architecture bake-off measurements

Throwaway benchmark scripts that produce the measured numbers for
[ADR-0001](../docs/adr/0001-architecture-cost-bakeoff.md). Nothing here is
production infrastructure; everything created in AWS is named `wsf-spike*`,
tagged `project=wsf-spike`, and destroyed by `99_teardown.py` the same day.

**Budget: $5 hard cap** (pre-approved). `_config.py` tracks estimated spend in
`.spend.json` and aborts past the cap. Region: `us-west-2` always.

## Prerequisites

- `aws login` (or otherwise configured credentials) on this machine - one time.
  Note: `aws login` creates a named profile (ours: `ryan`), not a default one,
  and its credential provider needs `botocore[crt]` - hence the env var and
  extra dep in every command below.
- `uv` (runs everything with ephemeral deps; nothing to install).

## Run order

| # | Script | Touches AWS | Time | Est. cost |
|---|---|---|---|---|
| 1 | `01_gen_history.py` | no | ~2 min | $0 |
| 2 | `02_athena_bench.py` | S3, Glue, Athena | ~10 min | < $0.05 |
| 3 | `03_dynamo_bench.py` | DynamoDB | ~5 min | < $0.02 |
| 4 | `04_rds_bench.py` | RDS, EC2 SG | ~40 min (creation wait) | < $0.50 |
| 5 | `05_dsql_probe.py` | Aurora DSQL | timeboxed 45 min | free tier expected |
| 6 | `99_teardown.py` | all of the above | ~15 min (RDS wait) | $0 |

```bash
cd spikes
export AWS_PROFILE=ryan
uv run --with pyarrow python 01_gen_history.py
uv run --with boto3 --with "botocore[crt]" python 02_athena_bench.py
uv run --with boto3 --with "botocore[crt]" python 03_dynamo_bench.py
uv run --with boto3 --with "botocore[crt]" --with "psycopg[binary]" --with pyarrow --with requests python 04_rds_bench.py
uv run --with boto3 --with "botocore[crt]" --with "psycopg[binary]" --with pyarrow python 05_dsql_probe.py
uv run --with boto3 --with "botocore[crt]" python 99_teardown.py
```

Measurements land in `results/*.json` (gitignored); the ADR gets the numbers
plus each script name and run timestamp. The teardown's final "VERIFY EMPTY"
block gets pasted into the ADR appendix as destruction proof.

## Notes

- `03` measures from this laptop: WAN latency dominates and the results say so;
  the in-region p95 gate is confirmed from a Lambda during M0 if it's close.
- `04` opens port 5432 to this machine's current IP only, and deletes the
  instance at the end even on partial failure (teardown double-checks).
- `05` exists to embrace-or-dismiss the DSQL wildcard; any friction is itself
  a finding. Do not fight it past the timebox.
