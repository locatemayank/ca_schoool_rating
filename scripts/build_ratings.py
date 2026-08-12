#!/usr/bin/env python3
"""
build_ratings.py — REAL school ratings + decade history from CA CAASPP.

Reads the CAASPP Smarter Balanced research files (caret-delimited) for each
available year and, for every school, computes the share of students who
"Met or Exceeded" the standard on ELA + Math (all grades, all students).
That proficiency % is then converted to a STATEWIDE 1-10 decile rating
(the same idea GreatSchools uses: rank a school against all CA schools),
so the number is comparable to public providers.

Input  : /tmp/sb_ca{YEAR}_all_csv_*.txt   (download via the CAASPP research
         files portal; see README). Caret (^) delimited.
Output : ../data/ratings.js  ->  window.SCHOOL_RATINGS = {
            "<CDS>": { "r": {year: rating1_10, ...},
                        "p": {year: proficiencyPct, ...},
                        "enr": latestEnrollment },
            ...
         }

CAASPP columns (1-based):
  1 County  2 District  4 School  10 TestID(1=ELA,2=Math)
  11 StudentGroupID(1=All)  12 Grade(13=All)  13 Enrolled
  15 TestedWithScores  21 Percentage Standard Met and Above
"""

import csv, glob, json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data", "ratings.js")
SRC_GLOB = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sb_ca*_all_csv_*.txt"


def year_from_name(path):
    b = os.path.basename(path)
    # sb_ca2024_all_csv_v1.txt
    for tok in b.split("_"):
        if tok.startswith("ca") and tok[2:].isdigit():
            return int(tok[2:])
    return None


# Two on-disk layouts exist. Column indices are 0-based.
#   NEW (2022+): caret-delimited
#     0 County 1 District 3 School 9 TestID 10 Group 11 Grade
#     12 Enrolled 14 TestedWithScores 20 %MetAndAbove
#   OLD (<=2019): comma-delimited, quoted, different order
#     0 County 1 District 2 School 5 Group 8 TestedWithScores 9 Grade
#     10 TestID 11 Enrolled 16 %MetAndAbove
LAYOUTS = {
    "new": dict(delim="^", county=0, district=1, school=3, group=10,
                grade=11, testid=9, tested=14, pct=16 + 4, enr=12, minlen=21),
    "old": dict(delim=",", county=0, district=1, school=2, group=5,
                grade=9, testid=10, tested=8, pct=16, enr=11, minlen=17),
}


def detect_layout(path):
    with open(path, encoding="latin-1") as f:
        first = f.readline()
    return "new" if "^" in first else "old"


def parse_year(path):
    """Return {cds: (weighted_pct, enrolled)} for one year file (either layout)."""
    L = LAYOUTS[detect_layout(path)]
    agg = {}
    with open(path, encoding="latin-1", newline="") as f:
        r = csv.reader(f, delimiter=L["delim"])
        next(r, None)  # header
        for row in r:
            if len(row) < L["minlen"]:
                continue
            if row[L["group"]] != "1":     # All students
                continue
            if row[L["grade"]] != "13":    # All grades
                continue
            if row[L["testid"]] not in ("1", "2"):
                continue
            pct = row[L["pct"]].strip()
            tested = row[L["tested"]].strip()
            if pct in ("", "*", "N/A", "NA") or tested in ("", "*", "N/A", "NA"):
                continue
            try:
                pct = float(pct)
                tested = float(tested)
            except ValueError:
                continue
            if tested <= 0:
                continue
            cds = (row[L["county"]].zfill(2) + row[L["district"]].zfill(5) +
                   row[L["school"]].zfill(7))
            a = agg.get(cds)
            if a is None:
                a = [0.0, 0.0, 0]; agg[cds] = a
            a[0] += pct * tested
            a[1] += tested
            try:
                enr = int(float(row[L["enr"]]))
                if enr > a[2]:
                    a[2] = enr
            except (ValueError, IndexError):
                pass
    out = {}
    for cds, (wsum, tsum, enr) in agg.items():
        if tsum > 0:
            out[cds] = (wsum / tsum, enr)
    return out


def decile_ratings(prof_by_cds):
    """Map proficiency% -> statewide 1-10 decile for one year."""
    items = sorted(prof_by_cds.items(), key=lambda kv: kv[1])
    n = len(items)
    ratings = {}
    for i, (cds, prof) in enumerate(items):
        pct_rank = (i + 0.5) / n            # 0..1 percentile
        rating = int(math.ceil(pct_rank * 10))
        rating = max(1, min(10, rating))
        ratings[cds] = rating
    return ratings


def main():
    files = sorted(glob.glob(SRC_GLOB))
    if not files:
        sys.exit(f"No CAASPP files matched {SRC_GLOB}")

    per_year_prof = {}     # year -> {cds: (prof, enr)}
    for path in files:
        y = year_from_name(path)
        if not y:
            continue
        print(f"parsing {y}: {os.path.basename(path)}")
        per_year_prof[y] = parse_year(path)

    # build per-year statewide deciles
    per_year_rating = {y: decile_ratings({c: p for c, (p, _e) in d.items()})
                       for y, d in per_year_prof.items()}

    # assemble per-CDS record
    out = {}
    years = sorted(per_year_prof.keys())
    for y in years:
        profs = per_year_prof[y]
        rats = per_year_rating[y]
        for cds, (prof, enr) in profs.items():
            rec = out.get(cds)
            if rec is None:
                rec = {"r": {}, "p": {}, "enr": 0}
                out[cds] = rec
            rec["r"][str(y)] = rats[cds]
            rec["p"][str(y)] = round(prof, 1)
            if enr > rec["enr"]:
                rec["enr"] = enr

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write("/* AUTO-GENERATED by scripts/build_ratings.py — REAL CAASPP.\n")
        f.write("   rating = statewide 1-10 decile of (ELA+Math % met/above),\n")
        f.write(f"   years available: {years} (2020-21 had no statewide testing). */\n")
        f.write("window.SCHOOL_RATINGS = ")
        json.dump(out, f, separators=(",", ":"))
        f.write(";\n")

    print(f"Wrote {len(out)} schools with real ratings -> {OUT}")
    print("Years:", years)


if __name__ == "__main__":
    main()
