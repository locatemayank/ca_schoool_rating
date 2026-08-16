/* =====================================================================
 * app.js — UI wiring for CA School Finder
 * ===================================================================== */

const $ = (id) => document.getElementById(id);
let LAST = null;   // { loc, data }

/* ---------- rating color scale (0..10) ---------- */
function ratingColor(r) {
  if (r >= 8) return "#16a34a";
  if (r >= 6) return "#65a30d";
  if (r >= 4) return "#f59e0b";
  if (r >= 2) return "#ea580c";
  return "#dc2626";
}
function ratingLabel(r) {
  if (r >= 8) return "Above average";
  if (r >= 6) return "Average+";
  if (r >= 4) return "Average";
  if (r >= 2) return "Below average";
  return "Well below avg";
}
function trendMeta(dir) {
  if (dir === "up") return { cls: "trend-up", icon: "▲", word: "Improving" };
  if (dir === "down") return { cls: "trend-down", icon: "▼", word: "Declining" };
  return { cls: "trend-flat", icon: "▬", word: "Stable" };
}

/* ---------- tiny SVG sparkline ---------- */
function sparkline(hist, w = 130, h = 34) {
  const vals = hist.map((d) => d.rating);
  const min = 1, max = 10;
  const denom = Math.max(1, vals.length - 1);
  const px = (i) => (vals.length === 1 ? w / 2 : (i / denom) * (w - 4) + 2);
  const py = (v) => h - 2 - ((v - min) / (max - min)) * (h - 4);
  const pts = vals.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ");
  const col = ratingColor(vals[vals.length - 1]);
  const single = vals.length === 1
    ? `<circle cx="${px(0)}" cy="${py(vals[0])}" r="3" fill="${col}"/>` : "";
  return `<svg class="spark" viewBox="0 0 ${w} ${h}">
    <polyline fill="none" stroke="${col}" stroke-width="2"
      stroke-linejoin="round" stroke-linecap="round" points="${pts}"/>${single}
  </svg>`;
}

/* ---------- rating forecast (linear trend on real history) ---------- */
function computeForecast(hist, n) {
  n = n || 3;
  if (!hist || hist.length < 3) return [];
  const xs = hist.map((_, i) => i), ys = hist.map((h) => h.rating);
  const m = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / m, my = ys.reduce((a, b) => a + b, 0) / m;
  let num = 0, den = 0;
  for (let i = 0; i < m; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const slope = den ? num / den : 0, intc = my - slope * mx;
  const lastYear = hist[hist.length - 1].year;
  const out = [];
  for (let k = 1; k <= n; k++) {
    let v = intc + slope * ((m - 1) + k);
    v = Math.max(1, Math.min(10, v));
    out.push({ year: lastYear + k, rating: Math.round(v * 10) / 10 });
  }
  return out;
}

/* ---------- larger SVG history chart (with optional dashed forecast) ---------- */
function historyChart(hist, fc) {
  fc = fc || [];
  const all = hist.concat(fc.map((p) => ({ year: p.year, rating: p.rating })));
  const w = 700, h = 220, padL = 34, padB = 26, padT = 12, padR = 12;
  const min = 0, max = 10;
  const iw = w - padL - padR, ih = h - padT - padB;
  const n = all.length, nReal = hist.length;
  const denom = Math.max(1, n - 1);
  const x = (i) => (n === 1 ? padL + iw / 2 : padL + (i / denom) * iw);
  const y = (v) => padT + ih - ((v - min) / (max - min)) * ih;

  let grid = "";
  for (let g = 0; g <= 10; g += 2) {
    const gy = y(g);
    grid += `<line x1="${padL}" y1="${gy}" x2="${w - padR}" y2="${gy}"
      stroke="#e2e8f0" stroke-width="1"/>
      <text x="${padL - 6}" y="${gy + 3}" text-anchor="end"
        font-size="10" fill="#94a3b8">${g}</text>`;
  }
  let xlabels = "";
  all.forEach((d, i) => {
    if (i % 2 === 0 || i === n - 1) {
      const isF = i >= nReal;
      xlabels += `<text x="${x(i)}" y="${h - 6}" text-anchor="middle"
        font-size="10" fill="${isF ? "#a78bfa" : "#94a3b8"}">${d.year}${isF ? "*" : ""}</text>`;
    }
  });
  const col = ratingColor(hist[hist.length - 1].rating);
  const realLine = hist.map((d, i) => `${x(i).toFixed(1)},${y(d.rating).toFixed(1)}`).join(" ");
  const area = `${padL},${y(min)} ${realLine} ${x(nReal - 1).toFixed(1)},${y(min)}`;
  const dots = hist.map((d, i) =>
    `<circle cx="${x(i).toFixed(1)}" cy="${y(d.rating).toFixed(1)}" r="3"
       fill="${ratingColor(d.rating)}"/>`).join("");

  let band = "", fcLine = "", fcDots = "";
  if (fc.length) {
    const startIdx = nReal - 1;
    const pts = [[startIdx, hist[hist.length - 1].rating]]
      .concat(fc.map((p, k) => [startIdx + 1 + k, p.rating]));
    fcLine = pts.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    fcDots = fc.map((p, k) =>
      `<circle cx="${x(startIdx + 1 + k).toFixed(1)}" cy="${y(p.rating).toFixed(1)}" r="3.2"
         fill="#fff" stroke="${col}" stroke-width="2"/>`).join("");
    const top = [], bot = [];
    pts.forEach(([i, v], idx) => {
      const unc = Math.min(2, 0.4 * idx);
      top.push(`${x(i).toFixed(1)},${y(Math.min(10, v + unc)).toFixed(1)}`);
    });
    for (let idx = pts.length - 1; idx >= 0; idx--) {
      const [i, v] = pts[idx], unc = Math.min(2, 0.4 * idx);
      bot.push(`${x(i).toFixed(1)},${y(Math.max(0, v - unc)).toFixed(1)}`);
    }
    band = `<polygon points="${top.concat(bot).join(" ")}" fill="${col}18"/>`;
  }
  return `<svg class="hist-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
    <rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff"/>
    ${grid}${xlabels}
    <polygon points="${area}" fill="${col}22"/>
    ${band}
    <polyline fill="none" stroke="${col}" stroke-width="2.5"
      stroke-linejoin="round" points="${realLine}"/>
    ${fc.length ? `<polyline fill="none" stroke="${col}" stroke-width="2.5" stroke-dasharray="6 5" points="${fcLine}"/>` : ""}
    ${dots}${fcDots}
  </svg>`;
}

/* ---------- school card ---------- */
function schoolCard(s) {
  const tm = trendMeta(s.trend.dir);
  const deltaTxt = (s.trend.delta >= 0 ? "+" : "") + s.trend.delta;
  return `<div class="school-card" data-id="${s.id}">
    <div class="sc-top">
      <div>
        <p class="sc-name">${s.name}</p>
        <div class="sc-level">${s.level} · ${s.distanceMi} mi</div>
        <div class="sc-district">${s.district}</div>
      </div>
      <div class="rating-chip" style="background:${ratingColor(s.rating)}">
        <div class="num">${s.rating.toFixed(1)}</div>
        <div class="of">/ 10</div>
      </div>
    </div>
    <div class="sc-metrics">
      ${s.acct ? `
        <div class="metric">Enrollment<b>${s.sub.enrollment.toLocaleString()}</b></div>
        <div class="metric">ELA DFS (${s.acct.year})<b>${s.acct.elaDFS == null ? "—" : (s.acct.elaDFS >= 0 ? "+" : "") + s.acct.elaDFS}</b></div>
        <div class="metric">Math DFS (${s.acct.year})<b>${s.acct.mathDFS == null ? "—" : (s.acct.mathDFS >= 0 ? "+" : "") + s.acct.mathDFS}</b></div>
      ` : `
        <div class="metric">Enrollment<b>${s.sub.enrollment.toLocaleString()}</b></div>
        <div class="metric">Students/Teacher<b>${s.sub.studentTeacherRatio}:1</b></div>
        <div class="metric">Grad rate<b>${s.sub.graduationPct}%</b></div>
      `}
    </div>
    <div class="trend-line">
      ${sparkline(s.history)}
      <span class="trend-tag ${tm.cls}">${tm.icon} ${tm.word} (${deltaTxt} / decade)</span>
    </div>
  </div>`;
}

/* ---------- insights generator ---------- */
function insights(s) {
  const out = [];
  const r = s.rating, t = s.trend;
  if (r >= 8) out.push(["pos", `Strong current rating of <b>${r.toFixed(1)}/10</b> — ${ratingLabel(r)} for California.`]);
  else if (r >= 6) out.push(["neu", `Solid rating of <b>${r.toFixed(1)}/10</b> — ${ratingLabel(r)}.`]);
  else out.push(["neg", `Modest rating of <b>${r.toFixed(1)}/10</b> — ${ratingLabel(r)}. Visit before deciding.`]);

  if (t.dir === "up") out.push(["pos", `Ratings have <b>improved</b> over the last decade (${t.delta >= 0 ? "+" : ""}${t.delta} pts, ~${t.slopePerYear}/yr). Momentum is positive.`]);
  else if (t.dir === "down") out.push(["neg", `Ratings have <b>declined</b> over the last decade (${t.delta} pts, ~${t.slopePerYear}/yr). Watch this trend.`]);
  else out.push(["neu", `Ratings have been <b>stable</b> over the last decade (${t.delta >= 0 ? "+" : ""}${t.delta} pts).`]);

  const peak = s.history.reduce((a, b) => (b.rating > a.rating ? b : a));
  const low = s.history.reduce((a, b) => (b.rating < a.rating ? b : a));
  out.push(["neu", `Peak rating <b>${peak.rating}</b> in ${peak.year}; lowest <b>${low.rating}</b> in ${low.year}.`]);

  const real = s.ratingProvenance === "real";
  if (real) {
    const fc = computeForecast(s.history, 3);
    if (fc.length) out.push([fc[fc.length - 1].rating >= s.rating ? "pos" : "neg",
      `Projected rating (next 3 yrs): <b>${fc.map((p) => p.year + " → " + p.rating).join(", ")}</b> <i>(linear trend, illustrative)</i>.`]);
  }
  if (real && s.acct) {
    const a = s.acct;
    if (a.acadProg != null) out.push([a.acadProg >= 0 ? "pos" : "neg",
      `Academic progress ${a.year}: <b>${a.acadProg >= 0 ? "+" : ""}${a.acadProg} pts</b> (mean ELA+Math change).`]);
    out.push(["neu",
      `${a.year} Distance‑from‑Standard: ELA <b>${a.elaDFS == null ? "n/a" : (a.elaDFS >= 0 ? "+" : "") + a.elaDFS}</b>, Math <b>${a.mathDFS == null ? "n/a" : (a.mathDFS >= 0 ? "+" : "") + a.mathDFS}</b>.`]);
  } else {
    if (s.sub.studentTeacherRatio <= 20) out.push(["pos", `Favorable student:teacher ratio of <b>${s.sub.studentTeacherRatio}:1</b>.`]);
    else if (s.sub.studentTeacherRatio >= 26) out.push(["neg", `High student:teacher ratio of <b>${s.sub.studentTeacherRatio}:1</b> — larger classes.`]);
    if (s.sub.graduationPct >= 95 && s.level === "High") out.push(["pos", `Excellent graduation rate of <b>${s.sub.graduationPct}%</b>.`]);
    if (s.sub.collegeReadiness >= 75 && s.level === "High") out.push(["pos", `High college-readiness sub-score (<b>${s.sub.collegeReadiness}/100</b>).`]);
    if (s.sub.equity < 45) out.push(["neg", `Equity sub-score is low (<b>${s.sub.equity}/100</b>).`]);
  }
  return out;
}

/* ---------- real score breakdown (current year only, CA Dashboard) ---------- */
function scoreBreakdown(s) {
  const a = s.acct;
  if (!a) return "";
  const clamp = (v) => Math.max(0, Math.min(100, v));
  const bar = (v) => (v == null ? "" :
    `<div class="bd-bar"><span style="width:${clamp(v)}%"></span></div>`);
  const real = `<span class="tag-real">real</span>`;
  const na = `<span class="tag-modeled">not wired</span>`;
  const pct = (label, v) => (v == null
    ? `<div class="bd-row"><div class="bd-l">${label} ${na}</div><div class="bd-v">N/A</div></div>`
    : `<div class="bd-row"><div class="bd-l">${label} ${real}</div><div class="bd-v">${v}%</div>${bar(v)}</div>`);
  const pts = (label, v) => (v == null ? ""
    : `<div class="bd-row"><div class="bd-l">${label} ${real}</div><div class="bd-v">${v >= 0 ? "+" : ""}${v}</div></div>`);
  return `
    <h3 style="margin-top:6px">Score breakdown — ${a.year}
      <span class="badge real">CA Dashboard</span></h3>
    <div class="bd">
      ${pts("ELA — Distance from Standard", a.elaDFS)}
      ${pts("Math — Distance from Standard", a.mathDFS)}
      ${a.acadProg != null ? `<div class="bd-row"><div class="bd-l">Academic progress (mean ELA+Math change) ${real}</div><div class="bd-v">${a.acadProg >= 0 ? "+" : ""}${a.acadProg} pts</div></div>` : ""}
      ${pct("Attendance (100−chronic)", a.attend)}
      ${pct("College/Career prepared", a.college)}
      ${a.grad != null ? pct("Graduation (4‑yr cohort)", a.grad) : ""}
    </div>
    <p style="font-size:12px;color:#64748b;margin:2px 0 8px">Showing <b>${a.year}</b> CA Dashboard data.
      <b>2026</b> data is expected after <b>Oct 15, 2026</b>.</p>`;
}

/* ---------- generic multi-year line chart (handles negative values) ---------- */
function metricChart(pairs, opts) {
  opts = opts || {};
  const col = opts.color || "#2563eb";
  const dec = opts.decimals != null ? opts.decimals : 0;
  const w = 700, h = 180, padL = 40, padB = 24, padT = 12, padR = 12;
  const iw = w - padL - padR, ih = h - padT - padB;
  const xs = pairs.map((p) => p[0]), ys = pairs.map((p) => p[1]);
  let mn = Math.min.apply(null, ys), mx = Math.max.apply(null, ys);
  if (mn === mx) { mn -= 1; mx += 1; }
  const pd = (mx - mn) * 0.12 || 1; mn -= pd; mx += pd;
  const nx = xs.length;
  const X = (i) => (nx === 1 ? padL + iw / 2 : padL + (i / (nx - 1)) * iw);
  const Y = (v) => padT + ih - ((v - mn) / (mx - mn)) * ih;
  let grid = "";
  for (let k = 0; k <= 4; k++) {
    const val = mn + (k / 4) * (mx - mn), gy = Y(val);
    grid += `<line x1="${padL}" y1="${gy}" x2="${w - padR}" y2="${gy}" stroke="#e2e8f0"/>` +
      `<text x="${padL - 6}" y="${gy + 3}" text-anchor="end" font-size="10" fill="#94a3b8">${val.toFixed(dec)}</text>`;
  }
  if (mn < 0 && mx > 0) {
    const zy = Y(0);
    grid += `<line x1="${padL}" y1="${zy}" x2="${w - padR}" y2="${zy}" stroke="#cbd5e1" stroke-dasharray="4 3"/>`;
  }
  let xl = "";
  xs.forEach((yr, i) => { xl += `<text x="${X(i)}" y="${h - 6}" text-anchor="middle" font-size="10" fill="#94a3b8">${yr}</text>`; });
  const line = pairs.map((p, i) => `${X(i).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ");
  const dots = pairs.map((p, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="3" fill="${col}"/>`).join("");
  return `<svg class="hist-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" style="height:180px">
    <rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff"/>
    ${grid}${xl}
    <polyline fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round" points="${line}"/>
    ${dots}
  </svg>`;
}
function seriesPairs(obj) {
  if (!obj) return [];
  return Object.keys(obj).map(Number).sort((a, b) => a - b).map((y) => [y, obj[String(y)]]);
}
function metricChartsBlock(s) {
  const a = s.acct;
  if (!a) return "";
  const ep = seriesPairs(a.elaHist), mp = seriesPairs(a.mathHist), pp = seriesPairs(a.progHist);
  let out = "";
  const tag = `<span class="badge real">CA Dashboard</span>`;
  if (ep.length) out += `<h3 style="margin-top:10px">ELA — Distance from Standard by year ${tag}</h3>${metricChart(ep, { color: "#2563eb" })}`;
  if (mp.length) out += `<h3 style="margin-top:10px">Math — Distance from Standard by year ${tag}</h3>${metricChart(mp, { color: "#7c3aed" })}`;
  if (pp.length) out += `<h3 style="margin-top:10px">Academic progress (mean ELA+Math change) by year ${tag}</h3>${metricChart(pp, { color: "#16a34a" })}`;
  return out;
}

/* ---------- detail modal ---------- */
function openDetail(id) {
  const s = LAST.data.all.find((x) => x.id === id);
  if (!s) return;
  const tm = trendMeta(s.trend.dir);
  const isReal = s.ratingProvenance === "real";
  const ratingBadge = isReal
    ? `<span class="badge real">CAASPP rating</span>`
    : `<span class="badge modeled">modeled rating</span>`;
  const yrs = (s.dataYears && s.dataYears.length)
    ? `${s.dataYears[0]}–${s.dataYears[s.dataYears.length - 1]}` : "";
  const explainer = isReal
    ? `<div class="rating-explainer" style="background:#ecfdf5;border-color:#a7f3d0;color:#065f46">
         <b>How this rating is calculated (REAL data):</b> it is the school's
         <b>statewide decile (1–10)</b> of the share of students who
         <b>Met or Exceeded</b> the standard on <b>CAASPP</b> ELA + Math
         (all grades, all students), i.e. the school is ranked against every CA
         school that year — the same idea GreatSchools' test-score rating uses.
         Latest year proficiency: <b>${s.proficiency != null ? s.proficiency + "%" : "n/a"}</b>.
         History shows real CAASPP years ${yrs} (2020–21 had no statewide testing).${(s.acct && s.acct.ratingYear != null) ? ` The most recent point (<b>${s.acct.year}</b>) is a REAL statewide decile computed from the CA Dashboard <b>ELA+Math Distance‑from‑Standard</b> rank (the 2025 CAASPP proficiency file isn't loaded yet, so 2025 uses the Dashboard academic measure).` : ""}
         Small differences vs GreatSchools come from their extra components
         (academic growth, graduation/college-readiness, equity) and their exact
         weighting; this app currently uses the test-score component only.
       </div>`
    : `<div class="rating-explainer">
         <b>How this rating is calculated:</b> no CAASPP record matched this
         school id, so this 0–10 value is a <b>modeled placeholder</b> (seeded by
         the school id). Connect/rebuild <code>data/ratings.js</code> to replace it
         with the real CAASPP decile.
       </div>`;
  const ins = insights(s).map(([k, txt]) => `<li class="${k}">${txt}</li>`).join("");
  const rows = s.history.map((d) =>
    `<tr><td>${d.year}</td><td style="color:${ratingColor(d.rating)};font-weight:700">${d.rating.toFixed(1)}</td></tr>`).join("");

  $("detailBody").innerHTML = `
    <div class="detail-head">
      <div class="rating-chip" style="background:${ratingColor(s.rating)};min-width:70px">
        <div class="num" style="font-size:28px">${s.rating.toFixed(1)}</div>
        <div class="of">/ 10</div>
      </div>
      <div>
        <h2>${s.name}</h2>
        <div class="detail-sub">${s.level} School · ${s.district}</div>
        <div class="detail-sub">${s.distanceMi} mi from address · ${ratingBadge}</div>
      </div>
    </div>

    <h3>Rating history &amp; forecast ${tm.icon}
      <span class="trend-tag ${tm.cls}">${tm.word}</span></h3>
    ${historyChart(s.history, isReal ? computeForecast(s.history, 3) : [])}
    ${isReal && computeForecast(s.history, 3).length ? `<div style="font-size:12px;color:#64748b;margin:-6px 0 10px">Solid = real (${s.history[0].year}–${s.history[s.history.length - 1].year}); <span style="color:#7c3aed">dashed*</span> = projected next 3 yrs (linear‑trend extrapolation of this school's own history — illustrative, not an official prediction).</div>` : ""}

    ${isReal ? scoreBreakdown(s) : ""}
    ${isReal ? metricChartsBlock(s) : ""}

    <div class="kpi-row">
      <div class="kpi"><div class="lbl">Enrollment ${isReal ? '<span class="tag-real">real</span>' : '<span class="tag-modeled">modeled</span>'}</div><div class="val">${s.sub.enrollment.toLocaleString()}</div></div>
      <div class="kpi"><div class="lbl">Academic progress ${isReal ? '<span class="tag-real">real</span>' : '<span class="tag-modeled">modeled</span>'}</div><div class="val">${isReal ? ((s.acct && s.acct.acadProg != null) ? ((s.acct.acadProg >= 0 ? "+" : "") + s.acct.acadProg + " pts") : (s.breakdown && s.breakdown.profGrowth != null ? ((s.breakdown.profGrowth >= 0 ? "+" : "") + s.breakdown.profGrowth + " pts") : "N/A")) : (s.sub.academicProgress + " /100")}</div></div>
      <div class="kpi"><div class="lbl">Graduation ${isReal ? ((s.acct && s.acct.grad != null) ? '<span class="tag-real">real</span>' : '<span class="tag-modeled">not wired</span>') : '<span class="tag-modeled">modeled</span>'}</div><div class="val">${isReal ? ((s.acct && s.acct.grad != null) ? s.acct.grad + "%" : "N/A") : s.sub.graduationPct + "%"}</div></div>
    </div>
    <div class="kpi-row">
      <div class="kpi"><div class="lbl">Equity ${isReal ? '<span class="tag-modeled">not wired</span>' : '<span class="tag-modeled">modeled</span>'}</div><div class="val">${isReal ? "N/A" : s.sub.equity + " /100"}</div></div>
      <div class="kpi"><div class="lbl">College ready ${isReal ? ((s.acct && s.acct.college != null) ? '<span class="tag-real">real</span>' : '<span class="tag-modeled">not wired</span>') : '<span class="tag-modeled">modeled</span>'}</div><div class="val">${isReal ? ((s.acct && s.acct.college != null) ? s.acct.college + "%" : "N/A") : s.sub.collegeReadiness + " /100"}</div></div>
      <div class="kpi"><div class="lbl">Students / teacher ${isReal ? '<span class="tag-modeled">not wired</span>' : '<span class="tag-modeled">modeled</span>'}</div><div class="val">${isReal ? "N/A" : s.sub.studentTeacherRatio + ":1"}</div></div>
      <div class="kpi"><div class="lbl">Low-income ${isReal ? '<span class="tag-modeled">not wired</span>' : '<span class="tag-modeled">modeled</span>'}</div><div class="val">${isReal ? "N/A" : s.sub.lowIncomePct + "%"}</div></div>
    </div>
    <p style="font-size:12px;color:#64748b;margin:4px 0 0">
      ${isReal ? 'REAL: rating, decade history, ELA/Math %, state percentile (CAASPP) + enrollment; ELA/Math Distance‑from‑Standard, academic progress, attendance, graduation, college/career (CA Dashboard 2025). Only <b>equity</b>, <b>student:teacher</b> and <b>low‑income</b> remain <span class="tag-modeled">not wired</span> (shown as N/A) — see README.' : 'This school had no CAASPP match, so values are modeled placeholders.'}
    </p>

    <h3>Insights</h3>
    <ul class="insight-list">${ins}</ul>

    <h3>Year-by-year</h3>
    <table class="hist-table">
      <thead><tr><th>Year</th><th>Rating</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <h3 style="margin-top:14px">How this rating is calculated</h3>
    ${explainer}`;
  $("detailOverlay").classList.remove("hidden");
}

/* ---------- render assigned + nearby ---------- */
function renderAll() {
  const a = LAST.data.assigned;
  $("assignedCards").innerHTML =
    ["Elementary", "Middle", "High"].map((lv) =>
      a[lv] ? schoolCard(a[lv]) : "").join("");
  renderNearby();
}

function renderNearby() {
  const lvl = $("nearbyLevel").value;
  const sort = $("nearbySort").value;
  let list = LAST.data.nearby.slice();
  if (lvl !== "all") list = list.filter((s) => s.level === lvl);
  if (sort === "rating") list.sort((a, b) => b.rating - a.rating);
  else if (sort === "distance") list.sort((a, b) => a.distanceMi - b.distanceMi);
  else list.sort((a, b) => b.trend.slopePerYear - a.trend.slopePerYear);
  $("nearbyCards").innerHTML = list.map(schoolCard).join("") ||
    `<p style="color:#64748b">No schools at this level in range.</p>`;
}

/* ---------- offline SVG map (no external tiles, works on locked networks) ---------- */
function renderMap(loc, data) {
  const el = $("map");
  const W = el.clientWidth || 820, H = 340, pad = 26;

  // collect points (home + all schools) to compute bounds
  const pts = [{ lat: loc.lat, lon: loc.lon, home: true }];
  data.all.forEach((s) => pts.push(s));
  let minLa = Infinity, maxLa = -Infinity, minLo = Infinity, maxLo = -Infinity;
  pts.forEach((p) => {
    minLa = Math.min(minLa, p.lat); maxLa = Math.max(maxLa, p.lat);
    minLo = Math.min(minLo, p.lon); maxLo = Math.max(maxLo, p.lon);
  });
  // pad the bbox a touch
  const dLa = (maxLa - minLa) || 0.01, dLo = (maxLo - minLo) || 0.01;
  minLa -= dLa * 0.08; maxLa += dLa * 0.08; minLo -= dLo * 0.08; maxLo += dLo * 0.08;

  const sx = (lo) => pad + ((lo - minLo) / (maxLo - minLo)) * (W - 2 * pad);
  const sy = (la) => H - pad - ((la - minLa) / (maxLa - minLa)) * (H - 2 * pad);

  const assignedIds = new Set(Object.values(data.assigned).filter(Boolean).map((s) => s.id));

  // subtle grid
  let grid = "";
  for (let i = 0; i <= 6; i++) {
    const gx = pad + (i / 6) * (W - 2 * pad);
    const gy = pad + (i / 6) * (H - 2 * pad);
    grid += `<line x1="${gx}" y1="${pad}" x2="${gx}" y2="${H - pad}" stroke="#eef2f7"/>`;
    grid += `<line x1="${pad}" y1="${gy}" x2="${W - pad}" y2="${gy}" stroke="#eef2f7"/>`;
  }

  // school dots
  let dots = "";
  data.all.forEach((s) => {
    const isA = assignedIds.has(s.id);
    const x = sx(s.lon), y = sy(s.lat);
    const r = isA ? 9 : 6;
    dots += `<g class="mapdot" data-id="${s.id}" style="cursor:pointer">
      <circle cx="${x}" cy="${y}" r="${r}" fill="${ratingColor(s.rating)}"
        stroke="${isA ? "#1d4ed8" : "#ffffff"}" stroke-width="${isA ? 3 : 1.5}"/>
      ${isA ? `<text x="${x + 11}" y="${y + 4}" font-size="11" font-weight="700"
        fill="#0f172a">${s.name.replace(/&/g, "&amp;")}</text>` : ""}
    </g>`;
  });

  // home marker
  const hx = sx(loc.lon), hy = sy(loc.lat);
  const home = `<g>
    <circle cx="${hx}" cy="${hy}" r="7" fill="#111827" stroke="#fff" stroke-width="2"/>
    <text x="${hx}" y="${hy - 11}" font-size="11" font-weight="700"
      text-anchor="middle" fill="#111827">📍 You</text>
  </g>`;

  const legend = `<g>
    <circle cx="${W - 150}" cy="20" r="7" fill="#16a34a" stroke="#1d4ed8" stroke-width="3"/>
    <text x="${W - 138}" y="24" font-size="11" fill="#334155">Assigned</text>
    <circle cx="${W - 70}" cy="20" r="6" fill="#94a3b8" stroke="#fff" stroke-width="1.5"/>
    <text x="${W - 58}" y="24" font-size="11" fill="#334155">Nearby</text>
  </g>`;

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}"
      style="background:#f8fafc;border-radius:12px">
      ${grid}${dots}${home}${legend}
    </svg>`;

  // click handlers on dots
  el.querySelectorAll(".mapdot").forEach((g) =>
    g.addEventListener("click", () => openDetail(g.dataset.id)));
}

/* ---------- main search ---------- */
async function runSearch() {
  const addr = $("addressInput").value.trim();
  if (!addr) return;
  $("statusLine").innerHTML = "⏳ Geocoding address…";
  const loc = await SchoolData.geocodeAddress(addr);
  if (!loc) {
    $("statusLine").innerHTML =
      "❌ Could not geocode that address. Try adding city + ZIP (e.g. \"…, San Jose, CA 95127\").";
    return;
  }
  $("statusLine").innerHTML = "⏳ Loading nearby schools…";
  const data = await SchoolData.getSchoolsNear(loc.lat, loc.lon, loc.city);
  LAST = { loc, data };

  $("locTitle").textContent = loc.city ? `${loc.city}${loc.zip ? " " + loc.zip : ""}` : "Your location";
  $("locMeta").innerHTML =
    `<b>Matched:</b> ${loc.matched || addr}<br>` +
    `<b>Coordinates:</b> ${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)} ` +
    `&nbsp;·&nbsp; <span class="badge real">geocode: ${loc.source}</span> ` +
    `<span class="badge real">schools: CA DOE</span> ` +
    `<span class="badge real">ratings: CAASPP</span>`;
  $("assignNote").innerHTML = "ℹ️ " + (data.note || "");

  $("results").classList.remove("hidden");
  renderAll();
  renderMap(loc, data);
  $("statusLine").innerHTML =
    `✅ Showing 3 assigned + ${data.nearby.length} nearby schools around your address.`;
  $("results").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- events ---------- */
$("searchBtn").addEventListener("click", runSearch);
$("addressInput").addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(); });
$("nearbyLevel").addEventListener("change", renderNearby);
$("nearbySort").addEventListener("change", renderNearby);
$("detailClose").addEventListener("click", () => $("detailOverlay").classList.add("hidden"));
$("detailOverlay").addEventListener("click", (e) => {
  if (e.target === $("detailOverlay")) $("detailOverlay").classList.add("hidden");
});
document.addEventListener("click", (e) => {
  const card = e.target.closest(".school-card");
  if (card) openDetail(card.dataset.id);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("detailOverlay").classList.add("hidden");
});
