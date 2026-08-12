/* =====================================================================
 * data.js — data layer for CA School Finder
 * ---------------------------------------------------------------------
 *   geocodeAddress(addr)          -> { lat, lon, matched, city, zip, source }
 *   getSchoolsNear(lat, lon)      -> { assigned, nearby, all, note }
 *
 * School LOCATIONS, NAMES, DISTRICTS, GRADES are REAL (CA Dept. of Education
 * public-school directory, built into data/schools.js by scripts/build_schools.py).
 *
 * "Assigned" is computed as the nearest REAL, non-charter school of each level
 * WITHIN the residence's school district (district-aware nearest). This is an
 * approximation of the official attendance-boundary assignment — see README.
 *
 * Ratings + decade history are MODELED (deterministic, seeded by the school's
 * real CDS id) and clearly badged in the UI.
 * ===================================================================== */

const YEARS = (() => {
  const end = new Date().getFullYear();
  const arr = [];
  for (let y = end - 10; y <= end; y++) arr.push(y);
  return arr;
})();

/* ---------- deterministic PRNG ---------- */
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- geo ---------- */
function haversineMi(lat1, lon1, lat2, lon2) {
  const R = 3958.8, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ---------- modeled ratings / history / subscores (seeded by real id) ---------- */
function buildHistory(seed) {
  const rng = mulberry32(seed);
  let v = 3 + rng() * 6;
  const drift = (rng() - 0.5) * 0.55;
  const meanRevert = 0.15;
  const target = 3 + rng() * 6;
  const hist = [];
  for (let i = 0; i < YEARS.length; i++) {
    v += drift + meanRevert * (target - v) + (rng() - 0.5) * 0.9;
    v = Math.max(1, Math.min(10, v));
    hist.push({ year: YEARS[i], rating: Math.round(v * 10) / 10 });
  }
  return hist;
}
function trendOf(hist) {
  const first = hist[0].rating, last = hist[hist.length - 1].rating;
  const delta = Math.round((last - first) * 10) / 10;
  const n = hist.length, xs = hist.map((_, i) => i), ys = hist.map((h) => h.rating);
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const slope = den ? num / den : 0;
  let dir = "flat";
  if (slope > 0.08) dir = "up"; else if (slope < -0.08) dir = "down";
  return { delta, slopePerYear: Math.round(slope * 100) / 100, dir };
}
function subscores(seed) {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const j = () => Math.round(30 + rng() * 70);
  return {
    testScores: j(), academicProgress: j(), equity: j(), collegeReadiness: j(),
    studentTeacherRatio: 16 + Math.floor(rng() * 14),
    enrollment: 250 + Math.floor(rng() * 1600),
    lowIncomePct: Math.floor(rng() * 80),
    graduationPct: 78 + Math.floor(rng() * 22),
  };
}
function enrich(base, distanceMi) {
  const seed = hashStr(base.id || base.name);
  const modeledSub = subscores(seed);

  // Prefer REAL CAASPP ratings/history when available for this CDS id.
  const R = (window.SCHOOL_RATINGS || {})[base.id];
  if (R && R.r && Object.keys(R.r).length) {
    const years = Object.keys(R.r).map(Number).sort((a, b) => a - b);
    const history = years.map((y) => ({ year: y, rating: R.r[String(y)] }));
    const latestY = years[years.length - 1];
    const rating = R.r[String(latestY)];
    const latestProf = R.p ? R.p[String(latestY)] : null;
    const sub = { ...modeledSub };
    if (latestProf != null) sub.testScores = Math.round(latestProf); // real % met/above
    if (R.enr) sub.enrollment = R.enr;                               // real enrollment

    // REAL score breakdown (latest year) + derived proficiency growth.
    const ela = R.ela ? R.ela[String(latestY)] : null;
    const mathP = R.math ? R.math[String(latestY)] : null;
    const statePct = R.pct ? R.pct[String(latestY)] : null;
    const profYears = years.filter((y) => R.p[String(y)] != null);
    const firstProf = profYears.length ? R.p[String(profYears[0])] : null;
    const profGrowth = (firstProf != null && latestProf != null)
      ? Math.round((latestProf - firstProf) * 10) / 10 : null;
    const growthYears = profYears.length
      ? `${profYears[0]}→${profYears[profYears.length - 1]}` : "";

    return {
      ...base,
      distanceMi: Math.round(distanceMi * 100) / 100,
      rating,
      history,
      trend: trendOf(history),
      sub,
      proficiency: latestProf,
      breakdown: {
        latestYear: latestY,
        ela, math: mathP, combined: latestProf,
        statePercentile: statePct,
        profGrowth, growthYears,
      },
      acct: (window.SCHOOL_ACCT || {})[base.id] || null, // REAL CA Dashboard
      ratingProvenance: "real",           // CAASPP decile
      dataYears: years,
      provenance: "real-location-real-caaspp-rating",
    };
  }

  // Fallback: deterministic modeled rating/history (badged "modeled").
  const hist = buildHistory(seed);
  return {
    ...base,
    distanceMi: Math.round(distanceMi * 100) / 100,
    rating: hist[hist.length - 1].rating,
    history: hist,
    trend: trendOf(hist),
    sub: modeledSub,
    ratingProvenance: "modeled",
    provenance: "real-location-modeled-rating",
  };
}

/* ---------- offline geocoder (works on locked networks, no CORS) ----------
 * 1) ZIP centroid from data/zips.js (Census ZCTA gazetteer, real).
 * 2) City centroid = average of REAL school coordinates in that city.
 */
function offlineGeocode(addr) {
  const ZIP = window.ZIP_CENTROIDS || {};
  const zipMatch = addr.match(/\b(9\d{4})\b/);
  if (zipMatch && ZIP[zipMatch[1]]) {
    const [la, lo] = ZIP[zipMatch[1]];
    return { lat: la, lon: lo, matched: `ZIP ${zipMatch[1]} (area centroid)`,
      city: "", zip: zipMatch[1], source: "offline-zip" };
  }
  // try city name (token(s) before ", CA")
  const cityMatch = addr.match(/,\s*([A-Za-z .'-]+?)\s*,?\s*(?:CA|California)\b/i)
    || addr.match(/^([A-Za-z .'-]+?)\s*,?\s*(?:CA|California)\b/i);
  if (cityMatch) {
    const city = cityMatch[1].trim().toLowerCase();
    const SCH = window.SCHOOLS || [];
    let sla = 0, slo = 0, n = 0;
    for (const s of SCH) {
      if ((s.city || "").toLowerCase() === city) { sla += s.lat; slo += s.lon; n++; }
    }
    if (n > 0) {
      return { lat: sla / n, lon: slo / n,
        matched: `${cityMatch[1].trim()}, CA (city centroid)`,
        city: cityMatch[1].trim(), zip: "", source: "offline-city" };
    }
  }
  return null;
}

/* ---------- source ---------- */
const Source = {
  async geocodeAddress(addr) {
    // Try online street-level geocoders first (best accuracy). On locked/CORS
    // networks these throw; we then fall back to the offline geocoder.
    const url = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress" +
      "?benchmark=Public_AR_Current&format=json&address=" + encodeURIComponent(addr);
    try {
      const r = await fetch(url);
      const j = await r.json();
      const m = j?.result?.addressMatches?.[0];
      if (m) {
        const c = m.coordinates, comp = m.addressComponents || {};
        return { lat: c.y, lon: c.x, matched: m.matchedAddress,
          city: comp.city || "", zip: comp.zip || "", source: "census" };
      }
    } catch (e) { /* fallthrough */ }
    try {
      const u2 = "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=" +
        encodeURIComponent(addr);
      const r2 = await fetch(u2, { headers: { Accept: "application/json" } });
      const j2 = await r2.json();
      if (j2 && j2[0]) {
        return { lat: parseFloat(j2[0].lat), lon: parseFloat(j2[0].lon),
          matched: j2[0].display_name, city: "", zip: "", source: "nominatim" };
      }
    } catch (e) { /* ignore */ }
    // Offline fallback (always available).
    return offlineGeocode(addr);
  },

  async getSchoolsNear(lat, lon) {
    const SCH = window.SCHOOLS || [];
    // distance to every school (cheap enough for ~7k rows)
    const withDist = SCH.map((s) => ({ s, d: haversineMi(lat, lon, s.lat, s.lon) }));
    withDist.sort((a, b) => a.d - b.d);

    const nearestByLevel = { Elementary: null, Middle: null, High: null };
    for (const { s, d } of withDist) {
      if (!nearestByLevel[s.level]) nearestByLevel[s.level] = { s, d };
      if (nearestByLevel.Elementary && nearestByLevel.Middle && nearestByLevel.High) break;
    }

    // District-aware assignment:
    //  - elementary & middle come from the residence's K-8 district
    //    (district of the nearest elementary school),
    //  - high comes from the nearest high school's district.
    const elemDistrict = nearestByLevel.Elementary?.s.district;
    const highDistrict = nearestByLevel.High?.s.district;

    function nearestInDistrict(level, district) {
      if (district) {
        for (const { s, d } of withDist) {
          if (s.level === level && s.district === district) return { s, d };
        }
      }
      return nearestByLevel[level]; // fallback: nearest overall
    }

    const aE = nearestInDistrict("Elementary", elemDistrict);
    const aM = nearestInDistrict("Middle", elemDistrict);
    const aH = nearestInDistrict("High", highDistrict);

    const assigned = {
      Elementary: aE ? enrich(aE.s, aE.d) : null,
      Middle: aM ? enrich(aM.s, aM.d) : null,
      High: aH ? enrich(aH.s, aH.d) : null,
    };
    const assignedIds = new Set(Object.values(assigned).filter(Boolean).map((s) => s.id));

    // Nearby = next-closest schools of each level within a radius (excluding assigned).
    const RADIUS = 8; // miles
    const CAP = { Elementary: 8, Middle: 6, High: 6 };
    const counts = { Elementary: 0, Middle: 0, High: 0 };
    const nearby = [];
    for (const { s, d } of withDist) {
      if (d > RADIUS) break;
      if (assignedIds.has(s.id)) continue;
      if (counts[s.level] >= CAP[s.level]) continue;
      counts[s.level]++;
      nearby.push(enrich(s, d));
    }

    const all = [...Object.values(assigned).filter(Boolean), ...nearby];
    const note =
      `Assigned = nearest non-charter school of each level within your district ` +
      `(elementary/middle: ${elemDistrict || "n/a"}; high: ${highDistrict || "n/a"}). ` +
      `This approximates official attendance boundaries — verify with the district.`;
    return { assigned, nearby, all, note, elemDistrict, highDistrict };
  },
};

window.SchoolData = {
  YEARS,
  geocodeAddress: (a) => Source.geocodeAddress(a),
  getSchoolsNear: (lat, lon) => Source.getSchoolsNear(lat, lon),
  haversineMi,
};
