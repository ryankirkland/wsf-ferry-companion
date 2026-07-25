"""Destroy everything the spikes created; end by proving each service is empty.

Safe to run repeatedly. Only touches resources named wsf-spike*.

Run: uv run --with boto3 python spikes/99_teardown.py
"""

from __future__ import annotations

from _config import PREFIX, account_id, bucket_name, session

ATHENA_DB = "wsf_spike"


def main():
    sess = session()
    acct = account_id(sess)
    bucket = bucket_name(acct)

    # S3
    s3 = sess.resource("s3")
    try:
        b = s3.Bucket(bucket)
        b.objects.all().delete()
        b.delete()
        print(f"deleted s3://{bucket}")
    except Exception as e:
        print(f"s3: {type(e).__name__} (likely already gone)")

    # Athena workgroup + Glue database
    try:
        sess.client("athena").delete_work_group(WorkGroup=PREFIX, RecursiveDeleteOption=True)
        print(f"deleted athena workgroup {PREFIX}")
    except Exception as e:
        print(f"athena: {type(e).__name__}")
    try:
        sess.client("glue").delete_database(Name=ATHENA_DB)
        print(f"deleted glue db {ATHENA_DB}")
    except Exception as e:
        print(f"glue: {type(e).__name__}")

    # DynamoDB
    try:
        sess.client("dynamodb").delete_table(TableName=f"{PREFIX}-hot")
        print(f"deleted dynamo table {PREFIX}-hot")
    except Exception as e:
        print(f"dynamo: {type(e).__name__}")

    # RDS + its security group
    rds = sess.client("rds")
    try:
        rds.delete_db_instance(DBInstanceIdentifier=f"{PREFIX}-pg", SkipFinalSnapshot=True)
        print(f"delete requested: rds {PREFIX}-pg")
    except Exception as e:
        print(f"rds: {type(e).__name__}")
    try:
        rds.get_waiter("db_instance_deleted").wait(DBInstanceIdentifier=f"{PREFIX}-pg",
                                                   WaiterConfig={"Delay": 20, "MaxAttempts": 45})
    except Exception:
        pass
    ec2 = sess.client("ec2")
    try:
        sgs = ec2.describe_security_groups(Filters=[{"Name": "group-name", "Values": [f"{PREFIX}-sg"]}])
        for sg in sgs["SecurityGroups"]:
            ec2.delete_security_group(GroupId=sg["GroupId"])
            print(f"deleted sg {sg['GroupId']}")
    except Exception as e:
        print(f"ec2 sg: {type(e).__name__}")

    # DSQL
    try:
        dsql = sess.client("dsql")
        for c in dsql.list_clusters().get("clusters", []):
            tags = dsql.list_tags_for_resource(resourceArn=c["arn"]).get("tags", {})
            if tags.get("project") == PREFIX:
                dsql.delete_cluster(identifier=c["identifier"])
                print(f"delete requested: dsql {c['identifier']}")
    except Exception as e:
        print(f"dsql: {type(e).__name__}")

    # ---- verify empty ----
    print("\n=== VERIFY EMPTY (paste into ADR appendix) ===")
    checks = {
        "s3 buckets wsf-spike*": [b["Name"] for b in sess.client("s3").list_buckets()["Buckets"]
                                  if b["Name"].startswith(PREFIX)],
        "dynamo tables": [t for t in sess.client("dynamodb").list_tables()["TableNames"]
                          if t.startswith(PREFIX)],
        "rds instances": [i["DBInstanceIdentifier"] for i in
                          sess.client("rds").describe_db_instances()["DBInstances"]
                          if i["DBInstanceIdentifier"].startswith(PREFIX)],
        "athena workgroups": [w["Name"] for w in
                              sess.client("athena").list_work_groups()["WorkGroups"]
                              if w["Name"].startswith(PREFIX)],
    }
    try:
        checks["dsql clusters (tagged)"] = [
            c["identifier"] for c in sess.client("dsql").list_clusters().get("clusters", [])
            if sess.client("dsql").list_tags_for_resource(resourceArn=c["arn"]).get("tags", {})
               .get("project") == PREFIX]
    except Exception:
        checks["dsql clusters (tagged)"] = "dsql api unavailable"
    clean = True
    for k, v in checks.items():
        status = "EMPTY" if not v else f"REMAINING: {v}"
        clean = clean and not v
        print(f"  {k}: {status}")
    print("TEARDOWN", "COMPLETE" if clean else "INCOMPLETE - rerun after deletions settle")


if __name__ == "__main__":
    main()
