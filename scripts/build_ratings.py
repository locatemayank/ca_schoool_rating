#!/usr/bin/env python3
"""
build_ratings.py — REAL school ratings + score breakdown + decade history from
California's statewide tests (CAASPP Smarter Balanced).

For each school and year it computes, from real data:
  - ELA  % Met/Exceeded         (all grades, all students)
  - Math % Met/Exceeded         (all grades, all students)
  - Combined proficiency %      (enrollment/tested-weighted across ELA+Math)
  - Statewide percentile (0-100) of that combined proficiency vs ALL CA schools
  - Rating (1-10 decile)        = ceil(percentile/10)
  - Enrollment (CAASPP reported)

Output : ../data/ratings.js  ->  window.SCHOOL_RATINGS = {
  "<CDS>": {
     "r":   {year: rating1_10},
     "p":   {year: combinedProf%},
     "ela": {year: elaProf%},
     "math":{year: mathProf%},
     "pct": {year: statePercentile0_100},
     "enr": latestEnrollment
  }, ...
}

Input files (download from https://caaspp-elpac.ets.org/caaspp/researchfiles):
  2022-2024 : sb_ca{YEAR}_all_csv_v1.txt      (caret ^ delimited)
  2015-2019 : sb_ca{YEAR}_all_csv_v{2..4}.txt (comma delimited, quoted)
Both layouts are auto-detected.
"""

import csv, glob, json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data", "ratings.js")
SRC_GLOB = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sb_ca*_all_csv_*.txt"

# 0-based column indices for the two layouts.
LAYOUTS = {
    "new": dict(delim="^", county=0, district=1, school=3, group=10,
                grade=11, testid=9, tested=14, pct=20, enr=12, minlen=21),
    "old": dict(delim=",", county=0, district=1, school=2, group=5,
                grade=9, testid=10, tested=8, pct=16, enr=11, minlen=17),
}


def year_from_name(path):
    for tok in os.path.basename(path).split("_"):
        if tok.startswith("ca") and tok[2:].isdigit():
            return int(tok[2:])
    return None


def detect_layout(path):
    with open(path, encoding="latin-1") as f:
        return "new" if "^" in f.readline() else "old"


def parse_year(path):
    """Return {cds: dict(ela, math, prof, enr)} for one year (either layout)."""
    L = LAYOUTS[detect_layout(path)]
    # cds -> [ela_w, ela_t, math_w, math_t, enr]
    agg = {}
    with open(path, encoding="latin-1", newline="") as f:
        r = csv.reader(f, delimiter=L["delim"])
        next(r, None)  # header
        for row in r:
            if len(row) < L["minlen"]:
                continue
            if row[L["group"]] != "1" or row[L["grade"]] != "13":
                continue
            tid = row[L["testid"]]
            if tid not in ("1", "2"):
                continue
            pct = row[L["pct"]].strip()
            tested = row[L["tested"]].strip()
            if pct in ("", "*", "N/A", "NA") or tested in ("", "*", "N/A", "NA"):
                continue
            try:
                pct = float(pct); tested = float(tested)
            except ValueError:
                continue
            if tested <= 0:
                continue
            cds = (row[L["county"]].zfill(2) + row[L["district"]].zfill(5) +
                   row[L["school"]].zfill(7))
            a = agg.get(cds)
            if a is None:
                a = [0.0, 0.0, 0.0, 0.0, 0]; agg[cds] = a
            if tid == "1":
                a[0] += pct * tested; a[1] += tested
            else:
                a[2] += pct * tested; a[3] += tested
            try:
                enr = int(float(row[L["enr"]]))
                if enr > a[4]:
                    a[4] = enr
            except (ValueError, IndexError):
                pass
    out = {}
    for cds, (ew, et, mw, mt, enr) in agg.items():
        tot = et + mt
        if tot <= 0:
            continue
        ela = (ew / et) if et > 0 else None
        math_ = (mw / mt) if mt > 0 else None
        prof = (ew + mw) / tot     # combined, tested-weighted
        out[cds] = {"ela": ela, "math": math_, "prof": prof, "enr": enr}
    return out


def decile_and_percentile(prof_by_cds):
    """Map combined proficiency -> (rating 1-10, percentile 0-100) statewide."""
    items = sorted(prof_by_cds.items(), key=lambda kv: kv[1])
    n = len(items)
    res = {}
    for i, (cds, _prof) in enumerate(items):
        pr = (i + 0.5) / n                       # 0..1
        rating = max(1, min(10, int(math.ceil(pr * 10))))
        res[cds] = (rating, round(pr * 100, 1))
    return res


def main():
    files = sorted(glob.glob(SRC_GLOB))
    if not files:
        sys.exit(f"No CAASPP files matched {SRC_GLOB}")

    per_year = {}   # year -> {cds: {ela,math,prof,enr}}
    for path in files:
        y = year_from_name(path)
        if not y:
            continue
        print(f"parsing {y}: {os.path.basename(path)}")
        per_year[y] = parse_year(path)

    out = {}
    years = sorted(per_year.keys())
    for y in years:
        d = per_year[y]
        rp = decile_and_percentile({c: v["prof"] for c, v in d.items()})
        for cds, v in d.items():
            rec = out.get(cds)
            if rec is None:
                rec = {"r": {}, "p": {}, "ela": {}, "math": {}, "pct": {}, "enr": 0}
                out[cds] = rec
            rating, pctile = rp[cds]
            sy = str(y)
            rec["r"][sy] = rating
            rec["p"][sy] = round(v["prof"], 1)
            if v["ela"] is not None:
                rec["ela"][sy] = round(v["ela"], 1)
            if v["math"] is not None:
                rec["math"][sy] = round(v["math"], 1)
            rec["pct"][sy] = pctile
            if v["enr"] > rec["enr"]:
                rec["enr"] = v["enr"]

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write("/* AUTO-GENERATED by scripts/build_ratings.py — REAL CAASPP.\n")
        f.write("   r=1-10 statewide decile of combined ELA+Math %MetAbove;\n")
        f.write("   p=combined prof%, ela/math=per-subject %, pct=state percentile;\n")
        f.write(f"   years: {years} (2020-21 no statewide testing). */\n")
        f.write("window.SCHOOL_RATINGS = ")
        json.dump(out, f, separators=(",", ":"))
        f.write(";\n")

    print(f"Wrote {len(out)} schools -> {OUT}")
    print("Years:", years)


if __name__ == "__main__":
    main()
