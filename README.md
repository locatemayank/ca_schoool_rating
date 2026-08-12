# California School Finder

Enter a **California address** and get the **assigned** public **elementary,
middle, and high** schools — plus **nearby (non‑assigned)** schools — each with:

- A **0–10 rating** and letter‑style label.
- A **decade rating history** (line chart + year‑by‑year table).
- A **trend verdict** (Improving / Stable / Declining) with per‑year slope.
- **Sub‑scores** (test scores, academic progress, equity, college readiness)
  and facts (enrollment, student:teacher ratio, low‑income %, graduation rate).
- Auto‑generated **plain‑English insights**.
- A self‑contained **map** (inline SVG — no external tiles, works on locked
  networks).

Static site (HTML + vanilla JS), no build step, GitHub‑Pages friendly.

## What is REAL vs modeled

| Field | Source | Status |
|---|---|---|
| School **names, locations, districts, grade spans** | **CA Dept. of Education** public‑school directory (`pubschls.txt`) | **REAL** |
| **ZIP / area centroids** (offline geocoding) | **US Census** 2023 ZCTA gazetteer | **REAL** |
| **Ratings + decade history** | **CA CAASPP** ELA+Math % Met/Exceeded → statewide decile | **REAL** |
| Enrollment, latest test proficiency | CA CAASPP research files | **REAL** |
| **Assignment** (which school you're zoned to) | district‑aware nearest‑school heuristic | **approximation** |
| Other sub‑scores (progress, equity, college, ratio, grad) | deterministic model seeded by CDS id | **modeled** |

Everything is badged in the UI so nothing is mistaken for official data.

## How assignment works (and its limits)

The residence is geocoded, then for each level we pick the **nearest real,
non‑charter, comprehensive school within the residence's district**:

- elementary & middle → the residence's K‑8 district,
- high → the residence's high‑school district.

This is correct for most addresses (e.g. `1224 Rosebriar Way, 95131` →
**Vinci Park Elementary** and **Independence High** are exact), but **nearest‑
in‑district is not identical to the official attendance boundary**. Where a
district has several schools of one level, the nearest may differ from the truly
zoned one (e.g. it returns *Piedmont Middle* where the boundary school is
*Morrill Middle*). The truly‑zoned school always appears in the **Other Nearby
Schools** list, and the in‑app note states the districts used.

**To make assignment exact**, add attendance‑boundary polygons and do a
point‑in‑polygon test (see "Upgrading" below).

## How ratings are calculated (REAL CAASPP data)

The 0–10 rating and the decade history are computed from **real California
statewide test results** (CAASPP Smarter Balanced), not a placeholder:

1. For each school and year we take the **% of students who Met or Exceeded**
   the standard on **ELA** and **Math** (all grades, all students), and combine
   them into a single proficiency % (enrollment‑weighted across the two tests).
2. That proficiency is converted to a **statewide decile (1–10)** — the school is
   ranked against **every CA school that year** — which is the same idea behind
   GreatSchools' *test‑score* rating. The last available year is the displayed
   rating; the per‑year deciles form the decade chart and trend.

Real years included: **2015–2019 and 2022–2024** (2020–21 had no statewide
testing). The number shown in the detail panel (e.g. Vinci Park **decile 9**,
~60% proficient; Morrill Middle **8**, ~54%) is derived directly from these
files and stored in `data/ratings.js` keyed by the school's CDS id.

**Why it can still differ slightly from GreatSchools:** GreatSchools blends the
test‑score component with **academic growth**, **graduation / college‑readiness**
(A‑G, AP/IB) and an **equity** sub‑rating, with grade‑level‑specific weights and
periodic re‑calibration. This app currently uses the **test‑score component
only**, so a school can land one decile above/below GreatSchools' composite.
Progress / equity / college‑readiness / graduation / student‑teacher fields shown
in the panel are still modeled (badged) until those DataQuest feeds are joined.

**Rebuild the ratings** (see commands below): `scripts/build_ratings.py` parses
the CAASPP research files (it auto‑handles the caret‑delimited 2022+ layout and
the comma‑delimited ≤2019 layout) and writes `data/ratings.js`. If a school has
no CAASPP match, the app falls back to a badged modeled rating.

**Add the remaining real components (optional upgrade):** join **CA DOE
DataQuest** four‑year cohort graduation, A‑G completion and AP/IB, plus the CAASPP
growth model, and blend them into the decile in `build_ratings.py`. The UI reads
`rating`/`history`/`sub`, so nothing else changes.

## Geocoding (works on locked networks)

`geocodeAddress()` tries, in order:

1. **US Census** one‑line geocoder (street‑level), then
2. **OpenStreetMap Nominatim** (street‑level), then
3. a **built‑in offline geocoder** — `data/zips.js` **ZIP centroid**, else a
   **city centroid** computed from the real school coordinates.

On corporate networks the first two may be blocked by CORS; the offline path
guarantees the app still works (no more "Access Blocked"). The active geocoder
is shown as a badge in the results header.

## Quick start

```bash
cd ca_school_finder
python3 -m http.server 8000
# open http://localhost:8000
```

Type an address (a CA default is prefilled), press **Find Schools**, then click
any school card or map dot for the full report with the decade chart.

## Project layout

```
ca_school_finder/
  index.html                app entry
  css/style.css
  js/
    data.js                 geocoding + district-aware assignment + modeled ratings
    app.js                  UI: cards, SVG charts, SVG map, detail modal, insights
  data/
    schools.js              REAL CA schools (window.SCHOOLS)  [generated]
    zips.js                 REAL CA ZIP centroids (window.ZIP_CENTROIDS) [generated]
  scripts/
    build_schools.py        builds data/schools.js from pubschls.txt
  README.md
```

## Re‑generating the data

```bash
# 1) Real school directory (names, districts, grades, lat/lon)
curl -o scripts/pubschls.txt \
  "https://www.cde.ca.gov/schooldirectory/report?rid=dl1&tp=txt"
python3 scripts/build_schools.py scripts/pubschls.txt   # -> data/schools.js

# 1b) REAL ratings + decade history from CAASPP (statewide deciles)
#     Download each year's "all" research file (filenames vary by year):
#       2022-2024:  sb_ca{YEAR}_all_csv_v1.zip     (caret-delimited)
#       2015-2019:  sb_ca{YEAR}_all_csv_v{2..4}.zip (comma-delimited)
#     from https://caaspp-elpac.ets.org/caaspp/researchfiles , unzip into /tmp,
#     then:
python3 scripts/build_ratings.py "/tmp/sb_ca*_all_csv_*.txt"  # -> data/ratings.js

# 2) ZIP centroids (offline geocoder) — Census 2023 ZCTA gazetteer
curl -o /tmp/gaz.zip \
  "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.zip"
cd /tmp && unzip -o gaz.zip
python3 - <<'PY'
import csv,json
out={}
with open('/tmp/2023_Gaz_zcta_national.txt',encoding='latin-1') as f:
    r=csv.DictReader(f,delimiter='\t'); r.fieldnames=[h.strip() for h in r.fieldnames]
    for d in r:
        z=d['GEOID'].strip()
        if z[:2] in ('90','91','92','93','94','95','96'):
            out[z]=[round(float(d['INTPTLAT']),5),round(float(d['INTPTLONG'].strip()),5)]
open('data/zips.js','w').write('window.ZIP_CENTROIDS='+json.dumps(out,separators=(',',':'))+';\n')
PY
```

## Upgrading

- **Exact assignment:** add attendance‑boundary GeoJSON (NCES EDGE **SABS**, or
  a district's published boundaries) and replace the nearest‑in‑district step in
  `getSchoolsNear()` with a point‑in‑polygon lookup. School objects already carry
  everything the UI needs.
- **Real ratings/history:** replace the modeled `history`/`sub` fields with CA
  DOE CAASPP / Dashboard yearly files or a GreatSchools feed (keyed). The decade
  chart, trend verdict, and insights update automatically.

## Notes / limitations

- School locations/names/districts/grades **and the ratings + decade history are
  REAL** (CA DOE directory + CAASPP). The rating is the **test‑score decile
  only**; it omits growth/graduation/equity, so it can differ by ~1 decile from
  GreatSchools' composite.
- Assignment is a **nearest‑in‑district approximation** until attendance‑boundary
  polygons are wired in.
- Some schools have only recent CAASPP years (new/renamed schools); their chart
  shows the available real years, and any school with no CAASPP match falls back
  to a clearly badged modeled rating.
