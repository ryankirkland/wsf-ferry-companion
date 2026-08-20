# Incident: WSDOT data outage, 2026-08-19 21:36 PT - 2026-08-20 09:08 PT

Eleven and a half hours of every WSDOT poller failing, initially
misdiagnosed as a cloud-IP block. Kept as a runbook because the
misdiagnosis pattern is the reusable lesson.

## Timeline (PT)

- **Aug 19 ~21:00** - WSDOT begins posted website maintenance.
- **21:36:49** - last successful poll (`fleet.json` freezes there).
  Error mode: `RemoteDisconnected` / TCP resets before HTTP - their
  servers mid-maintenance.
- **Aug 19-20** - investigation from the reset-era evidence concludes
  "cloud-range filtering": Lambda resets, residential 200s, key valid
  (AuthFailure=0). Outage banner on the site (data-clock honest);
  outreach email drafted and sent to WSDOT on that theory.
- **Aug 20 ~08:40** - FerryFriend observed working (owner) prompts a
  full endpoint matrix; all sub-APIs serve residential fine.
- **~08:50** - CloudWatch shows the STEADY-STATE error is not resets:
  `SSL: CERTIFICATE_VERIFY_FAILED - unable to get local issuer
  certificate`. `openssl s_client` confirms www.wsdot.wa.gov now sends
  a chain of ONE certificate: a new EV leaf, no intermediate.
- **Root cause**: the maintenance deployed a TLS config that omits the
  `DigiCert EV RSA CA G2` intermediate. Browsers/iOS repair broken
  chains via AIA chasing and macOS keeps an intermediate cache, so
  consumer clients (and macOS curl, and even macOS python) shrug it
  off. Strict clients that trust roots only - our Lambdas - correctly
  refuse. "Residential works, cloud doesn't" was a CLIENT-BEHAVIOR
  split, not a network one. Nobody was blocked.
- **Fix**: `wsf_core.client._tls_context()` - default trust plus the
  official intermediate (fetched from the leaf's own AIA URL), full
  verification intact. Reproduced fail->pass locally before shipping:
  certifi-only context fails with the exact Lambda error; adding the
  intermediate returns 200.
- **09:08:54 (16:08:54Z)** - recovery: first fresh `fleet.json` on the
  first poll after the apply; capacity and alerts followed within the
  next minute (21 vessels, 15 underway, 7 bulletins). Missed
  vesselhistory rows backfill via the nightly sync's 7-day lookback;
  the capacity-snapshot gap is permanent and carries the stats
  pipeline's labeled-gap treatment.

## Lessons

1. **Read the certificate chain before inferring IP filtering.** A
   "works from home, fails from cloud" split has at least two causes:
   network-range filtering AND TLS chain-building differences between
   client stacks. `openssl s_client` + a strict-trust Python probe from
   the SAME residential machine discriminates in one minute - the
   strict client failing from home kills the IP theory instantly.
2. **Evidence gathered mid-maintenance goes stale.** The TCP resets
   were real but transient (servers cycling); the durable failure mode
   only appeared after their maintenance settled. Re-run the probes
   before acting on a theory formed during the event.
3. **Every failure counter needs its reason in CloudWatch.** The
   vessels poller wrote `last_error` to DDB meta but never logged it -
   its log group showed bare PollFailure counts while siblings showed
   the exception. Diagnosis detoured through other log groups. (Fixed:
   `LastPollError` line per invoke.)

## Cleanup conditions

The supplement (`wsf_core/certs/digicert-ev-rsa-ca-g2.pem` and its
`_tls_context` load) is harmless but removable once
`openssl s_client -connect www.wsdot.wa.gov:443` shows a 2+ cert chain
again. The intermediate expires 2030-07-02; if WSDOT still hasn't fixed
their chain by then, the successor intermediate must be fetched from
the then-current leaf's AIA URL.
