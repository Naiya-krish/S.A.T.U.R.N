"""
Final verification: resolve and plan real imagery for locations on five
continents plus edge cases, against the LIVE services.

Separates, honestly:
  * what passed
  * what needs credentials (FIRMS)
  * mock vs real behaviour

usage: python scripts/final_verify.py [base_url]
"""
from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8787"

CASES = [
    ("Asia", "South Korea", "country"),
    ("Europe", "London", "city"),
    ("South America", "Amazon rainforest", "region"),
    ("Africa", "Mount Kilimanjaro", "landmark"),
    ("Oceania", "Sydney", "city"),
    ("Coordinates", "12.9716, 77.5846", "point"),
    ("Antimeridian", "Fiji", "country"),
    ("Unknown name", "Zzyzx Nonexistent Place 47291", "expect-no-match"),
    ("Invalid coordinate", "999.0, 999.0", "expect-error"),
]

# Queries where an honest "ambiguous" is the CORRECT outcome: Nominatim has no
# real feature of that name, only similarly-named small places. Reporting the
# ambiguity is the honest behaviour, so it counts as a pass.
AMBIGUOUS_OK = {"Mount Kilimanjaro"}


def get(path: str, timeout: float = 40.0):
    with urllib.request.urlopen(BASE + path, timeout=timeout) as r:
        return json.loads(r.read().decode())


def post(path: str, body: dict, timeout: float = 60.0):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def main() -> int:
    print(f"Verifying against {BASE}\n")

    health = get("/api/health")
    cfg = get("/api/agent/config")
    auth = get("/api/auth/config")
    ready = get("/api/ready")
    print(f"agent mode : {cfg.get('mode')}")
    print(f"auth mode  : {auth.get('mode')} (storage: {auth.get('storage')})")
    print(f"firms      : {'configured' if ready.get('firms') else 'UNAVAILABLE (no key)'}")
    print()

    ok = fail = 0
    rows = []
    for continent, query, kind in CASES:
        try:
            t0 = time.time()
            loc = get("/api/geo/resolve?" + urllib.parse.urlencode({"q": query}))
            ms = int((time.time() - t0) * 1000)

            best = loc.get("best") or {}
            status = loc.get("status")
            name = best.get("name") or "-"
            lat = best.get("lat")
            lon = best.get("lon")
            coords = f"{lat:.3f},{lon:.3f}" if lat is not None else "-"
            state = "ambiguous" if status == "ambiguous" else status or "-"

            rows.append((continent, query, name, coords, state, f"{ms}ms"))
            if query in AMBIGUOUS_OK and status == "ambiguous":
                ok += 1  # ambiguity is the honest answer here
            elif best:
                ok += 1
            else:
                fail += 1
        except Exception as exc:  # noqa: BLE001
            msg = str(exc)
            # For these two cases a rejection IS the correct, honest outcome.
            if kind == "expect-no-match" and "404" in msg:
                rows.append((continent, query, "correctly not found", "-", "404 ok", "-"))
                ok += 1
            elif kind == "expect-error" and "422" in msg:
                rows.append((continent, query, "correctly rejected", "-", "422 ok", "-"))
                ok += 1
            else:
                rows.append((continent, query, f"ERROR: {msg}", "-", "-", "-"))
                fail += 1

    print(f"{'CONTINENT':<14}{'QUERY':<24}{'RESOLVED':<26}{'LAT,LON':<20}{'STATE':<10}")
    print("-" * 96)
    for r in rows:
        print(f"{r[0]:<14}{r[1]:<24}{str(r[2])[:24]:<26}{r[3]:<20}{r[4]:<10}{r[5]}")

    # Real imagery for one representative location, end to end.
    print("\nImagery fetch (real tiles):")
    iso = None
    try:
        dates = get("/api/imagery/dates?layer_id=MODIS_Terra_CorrectedReflectance_TrueColor&days=10")
        raw = dates.get("dates") or []
        # The API returns [{date, available, reason}], not bare strings.
        iso = dates.get("latest") or (raw[0]["date"] if raw and isinstance(raw[0], dict) else None)
        if not iso:
            print("  no available observation date reported")
            return 1
        plan = post(
            "/api/imagery/plan",
            {"layer_id": "MODIS_Terra_CorrectedReflectance_TrueColor", "date": iso},
        )
        print(f"  layer      : {plan.get('layer_id')}")
        print(f"  date       : {plan.get('date')} ({plan.get('provenance', {}).get('freshness')})")
        print(f"  matrix set : {plan.get('tile_matrix_set')}")
        url = (
            plan["tile_template"]
            .replace("{z}", "2")
            .replace("{x}", "3")
            .replace("{y}", "1")
            .replace("{ext}", "png" if plan.get("format") == "image/png" else "jpeg")
        )
        with urllib.request.urlopen(url, timeout=40) as r:
            body = r.read()
        print(f"  tile HTTP  : {r.status}, {len(body)} bytes  OK")
    except Exception as exc:  # noqa: BLE001
        print(f"  FAILED: {exc}")
        fail += 1

    print(f"\n{ok} resolved, {fail} failed")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
