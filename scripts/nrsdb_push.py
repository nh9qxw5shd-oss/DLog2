#!/usr/bin/env python3
"""
nrsdb_push.py — pull the route's imposed ESRs from NRSDB and push them to
DLog2's ingest endpoint, from a machine that nrsdb.uk allows.

Why this exists: nrsdb.uk sits behind host bot-protection (StackProtect)
that answers HTTP 403 to logins from datacentre IP ranges, which includes
the Vercel / Netlify functions DLog2 runs on. So the deployed app cannot pull
for itself. Run this from your own PC (or any Network Rail host that can
reach nrsdb.uk in a browser) on a schedule, and the log build will use the
stored snapshot automatically.

Setup:
    pip install requests
    set the env vars below (or put them in a .env next to this file)

    NRSDB_EMAIL       = you@networkrail.co.uk
    NRSDB_PASSWORD    = ...
    NRSDB_ROUTECODE   = EM                 (optional)
    DLOG2_URL         = https://<your-dlog2-host>
    ESR_INGEST_TOKEN  = <same value as the ESR_INGEST_TOKEN env var on the host>

Run:
    python nrsdb_push.py            # pull + push
    python nrsdb_push.py --dry-run  # pull + diff on the server, store nothing
    python nrsdb_push.py --save raw.json   # also keep the raw payload locally

Schedule it once a day ahead of the morning log build (e.g. 05:15), and as
often as you like beyond that — the server keeps one snapshot per London
calendar date and overwrites it with the latest push.

Exit codes: 0 ok · 1 config · 2 NRSDB login/fetch · 3 ingest rejected
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

try:
    import requests
except ImportError:  # pragma: no cover
    print("pip install requests", file=sys.stderr)
    sys.exit(1)

BASE_URL = "https://nrsdb.uk"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0")


def load_dotenv(path: Path) -> None:
    """Tiny .env loader (KEY=VALUE lines, # comments) so python-dotenv isn't required."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.strip(), v.strip().strip('"').strip("'")
        os.environ.setdefault(k, v)


def die(msg: str, code: int) -> None:
    print(msg, file=sys.stderr)
    sys.exit(code)


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip().strip('"').strip("'")


def nrsdb_login(session: requests.Session, email: str, password: str) -> None:
    resp = session.post(
        f"{BASE_URL}/login.php",
        data={"email": email, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded",
                 "Origin": BASE_URL, "Referer": f"{BASE_URL}/login.php"},
        allow_redirects=True, timeout=20,
    )
    if resp.status_code == 403:
        die(f"[nrsdb] HTTP 403 — NRSDB's bot protection refused this machine. Run from a PC that can open nrsdb.uk in a browser.", 2)
    if not resp.ok or "login.php" in resp.url:
        die(f"[nrsdb] login failed (HTTP {resp.status_code}, landed on {resp.url}) — check NRSDB_EMAIL / NRSDB_PASSWORD.", 2)


def nrsdb_get_esrs(session: requests.Session, routecode: str, filter_: str, email: str, password: str):
    params = {"r": "getEsrsByRouteCode", "routecode": routecode, "filter": filter_, "_": str(int(time.time() * 1000))}
    headers = {"Accept": "application/json, text/javascript, */*; q=0.01",
               "X-Requested-With": "XMLHttpRequest",
               "Referer": f"{BASE_URL}/listEsr.php?view=route&route={routecode}&filter={filter_}"}
    resp = session.get(f"{BASE_URL}/ajax/get.php", params=params, headers=headers, timeout=20)
    if "login" in resp.url or not resp.headers.get("Content-Type", "").startswith("application/json"):
        nrsdb_login(session, email, password)
        resp = session.get(f"{BASE_URL}/ajax/get.php", params=params, headers=headers, timeout=20)
    if not resp.ok:
        die(f"[nrsdb] getEsrsByRouteCode returned HTTP {resp.status_code}.", 2)
    try:
        return resp.json()
    except ValueError:
        die(f"[nrsdb] response was not JSON: {resp.text[:120]!r}", 2)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="server diffs but stores nothing")
    ap.add_argument("--save", metavar="FILE", help="also write the raw NRSDB payload to FILE")
    ap.add_argument("--report-date", metavar="YYYY-MM-DD", help="log date to record on the run row")
    args = ap.parse_args()

    load_dotenv(Path(__file__).resolve().parent / ".env")
    email, password = env("NRSDB_EMAIL"), env("NRSDB_PASSWORD")
    routecode, filter_ = env("NRSDB_ROUTECODE", "EM").upper(), env("NRSDB_FILTER", "imposed")
    dlog2, token = env("DLOG2_URL").rstrip("/"), env("ESR_INGEST_TOKEN")
    missing = [n for n, v in [("NRSDB_EMAIL", email), ("NRSDB_PASSWORD", password), ("DLOG2_URL", dlog2), ("ESR_INGEST_TOKEN", token)] if not v]
    if missing:
        die(f"missing env vars: {', '.join(missing)}", 1)

    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Accept-Language": "en-GB,en;q=0.9,en-US;q=0.8"})
    nrsdb_login(s, email, password)
    payload = nrsdb_get_esrs(s, routecode, filter_, email, password)
    n = len(payload) if isinstance(payload, list) else "?"
    print(f"[nrsdb] pulled {n} ESR(s) for route {routecode} ({filter_})")

    if args.save:
        Path(args.save).write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(f"[nrsdb] raw payload saved to {args.save}")

    body = {"payload": payload, "routeCode": routecode, "dryRun": bool(args.dry_run)}
    if args.report_date:
        body["reportDate"] = args.report_date
    resp = requests.post(f"{dlog2}/api/esr/ingest", json=body,
                         headers={"Authorization": f"Bearer {token}"}, timeout=60)
    try:
        data = resp.json()
    except ValueError:
        die(f"[ingest] HTTP {resp.status_code}: {resp.text[:200]!r}", 3)
    if not resp.ok or not data.get("ok"):
        die(f"[ingest] rejected (HTTP {resp.status_code}): {data.get('message', data)}", 3)

    c = data["counts"]
    print(f"[ingest] {'DRY RUN — ' if args.dry_run else ''}snapshot {data['snapshotDate']}: "
          f"{c['active']} imposed · {c['new']} new · {c['amended']} amended · {c['removed']} removed"
          f"{' vs ' + data['baselineDate'] if data.get('baselineDate') else ' (first snapshot)'}"
          f"{'' if data.get('persisted') else ' · NOT STORED'}")


if __name__ == "__main__":
    main()
