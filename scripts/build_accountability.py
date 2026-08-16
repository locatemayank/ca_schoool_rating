#!/usr/bin/env python3
"""
build_accountability.py — REAL CA School Dashboard indicators per school,
with MULTI-YEAR ELA/Math Distance-from-Standard (DFS) and academic-progress
series for plotting.

Sources (tab-delimited; download into /tmp from
https://www3.cde.ca.gov/researchfiles/cadashboard/):
  eladownload<Y>.txt, mathdownload<Y>.txt   (academic; currstatus=DFS, change)
  graddownload<Y>.txt, chronicdownload<Y>.txt, ccidownload<Y>.txt (current year)

Dashboard academic years available: 2018, 2019, 2022, 2023, 2024, 2025
(2017 not published as a downloadable academic file; 2020-21 suspended).

Column positions differ by file (0-based):
  grad/chronic/cci : rtype=1, studentgroup=8, currstatus=11, change=15
  ela/math         : rtype=1, studentgroup=8, currstatus=10, change=13  (no currnumer)

Output: ../data/accountability.js -> window.SCHOOL_ACCT = {
  "<CDS>": {
     year, grad, chronic, attend, college,           # current-year scalars
     elaDFS, mathDFS, acadProg, ratingYear,          # current-year academic
     elaHist:  {year: dfs}, mathHist: {year: dfs},   # multi-year series
     progHist: {year: meanChange}                    # multi-year academic progress
  }, ...
}
"""

import csv, glob, math, os, sys, json

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data", "accountability.js")
SRC = "/tmp"
CUR = sys.argv[1] if len(sys.argv) > 1 else "2025"

C_CDS, C_RTYPE, C_GROUP = 0, 1, 8
# grad/chronic/cci columns
G_STATUS, G_CHANGE = 11, 15
# ela/math columns
A_STATUS, A_CHANGE = 10, 13


def num(x):
    x = (x or "").strip()
    if x in ("", "*", "N/A", "NA"):
        return None
    try:
        return float(x)
    except ValueError:
        return None


def read_metric(path, want, cstat, cchg):
    out = {}
    need = cstat if want == "status" else cchg
    if not os.path.exists(path):
        return out
    with open(path, encoding="latin-1", newline="") as f:
        r = csv.reader(f, delimiter="\t")
        next(r, None)
        for row in r:
            if len(row) <= max(cstat, cchg, C_GROUP):
                continue
            if row[C_RTYPE] != "S" or row[C_GROUP] != "ALL":
                continue
            v = num(row[need])
            if v is not None:
                out[row[C_CDS].strip().zfill(14)] = v
    return out


def academic_years():
    ys = []
    for p in glob.glob(os.path.join(SRC, "eladownload20*.txt")):
        base = os.path.basename(p)
        y = base.replace("eladownload", "").replace(".txt", "")
        if y.isdigit() and os.path.exists(os.path.join(SRC, f"mathdownload{y}.txt")):
            ys.append(int(y))
    return sorted(ys)


def decile_from(combined):
    ranked = sorted(combined.items(), key=lambda kv: kv[1])
    n = len(ranked)
    out = {}
    for i, (cds, _v) in enumerate(ranked):
        pr = (i + 0.5) / n if n else 0
        out[cds] = max(1, min(10, int(math.ceil(pr * 10))))
    return out


def main():
    years = academic_years()
    if not years:
        sys.exit("No eladownload/mathdownload files found in /tmp")
    cur = int(CUR) if CUR.isdigit() and int(CUR) in years else years[-1]

    # Per-year academic reads.
    ela_st, math_st, ela_ch, math_ch = {}, {}, {}, {}
    for y in years:
        ela = os.path.join(SRC, f"eladownload{y}.txt")
        mth = os.path.join(SRC, f"mathdownload{y}.txt")
        ela_st[y] = read_metric(ela, "status", A_STATUS, A_CHANGE)
        math_st[y] = read_metric(mth, "status", A_STATUS, A_CHANGE)
        ela_ch[y] = read_metric(ela, "change", A_STATUS, A_CHANGE)
        math_ch[y] = read_metric(mth, "change", A_STATUS, A_CHANGE)
        print(f"  {y}: elaDFS={len(ela_st[y])} mathDFS={len(math_st[y])}")

    # Current-year scalars from grad/chronic/cci.
    grad = read_metric(os.path.join(SRC, f"graddownload{cur}.txt"), "status", G_STATUS, G_CHANGE)
    chronic = read_metric(os.path.join(SRC, f"chronicdownload{cur}.txt"), "status", G_STATUS, G_CHANGE)
    cci = read_metric(os.path.join(SRC, f"ccidownload{cur}.txt"), "status", G_STATUS, G_CHANGE)

    # Current-year statewide DFS decile.
    combined_cur = {}
    for cds in (set(ela_st[cur]) | set(math_st[cur])):
        e, m = ela_st[cur].get(cds), math_st[cur].get(cds)
        vals = [x for x in (e, m) if x is not None]
        if vals:
            combined_cur[cds] = sum(vals) / len(vals)
    decile_cur = decile_from(combined_cur)

    all_cds = set(grad) | set(chronic) | set(cci)
    for y in years:
        all_cds |= set(ela_st[y]) | set(math_st[y])

    out = {}
    for cds in all_cds:
        rec = {"year": cur}
        if cds in grad:
            rec["grad"] = round(grad[cds], 1)
        if cds in chronic:
            rec["chronic"] = round(chronic[cds], 1)
            rec["attend"] = round(100 - chronic[cds], 1)
        if cds in cci:
            rec["college"] = round(cci[cds], 1)
        # current academic scalars
        if cds in ela_st[cur]:
            rec["elaDFS"] = round(ela_st[cur][cds], 1)
        if cds in math_st[cur]:
            rec["mathDFS"] = round(math_st[cur][cds], 1)
        e, m = ela_ch[cur].get(cds), math_ch[cur].get(cds)
        vv = [x for x in (e, m) if x is not None]
        if vv:
            rec["acadProg"] = round(sum(vv) / len(vv), 1)
        if cds in decile_cur:
            rec["ratingYear"] = decile_cur[cds]
        # multi-year series
        eh, mh, ph = {}, {}, {}
        for y in years:
            if cds in ela_st[y]:
                eh[str(y)] = round(ela_st[y][cds], 1)
            if cds in math_st[y]:
                mh[str(y)] = round(math_st[y][cds], 1)
            ce, cm = ela_ch[y].get(cds), math_ch[y].get(cds)
            cv = [x for x in (ce, cm) if x is not None]
            if cv:
                ph[str(y)] = round(sum(cv) / len(cv), 1)
        if eh:
            rec["elaHist"] = eh
        if mh:
            rec["mathHist"] = mh
        if ph:
            rec["progHist"] = ph
        out[cds] = rec

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write("/* AUTO-GENERATED by scripts/build_accountability.py — REAL CA Dashboard.\n")
        f.write(f"   current year={cur}; academic years={years}.\n")
        f.write("   *DFS = Distance from Standard (points); progHist = mean ELA+Math change. */\n")
        f.write("window.SCHOOL_ACCT = ")
        json.dump(out, f, separators=(",", ":"))
        f.write(";\n")
    print(f"years={years} current={cur} -> {len(out)} schools -> {OUT}")


if __name__ == "__main__":
    main()
