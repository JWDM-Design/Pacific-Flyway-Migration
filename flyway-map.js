/* =============================================================================
   Pacific Flyway — interactive BirdFlow migration map
   -----------------------------------------------------------------------------
   Loads the team's ArcGIS web map (basemap + Pacific Americas Flyway boundary)
   and draws Emerson's BirdFlow spring routes on top of it:
     • faint route lines, coloured amber (start of season) -> deep blue (end)
     • one bold arrow per species along its main corridor
     • dots for where the 200 simulated birds are in the chosen week
       (teal = inside the study states, grey = outside), with a week slider
   Data: flyway-routes.json (same folder as this file).

   Things you may want to change are in SETTINGS just below.
   ========================================================================== */

const SETTINGS = {
  portalUrl: "https://sdsugeo.maps.arcgis.com",
  webMapId: "6f61ed93ba7c4ded840346a9a78b04ce",
  dataFile: "flyway-routes.json",
  studyStates: ["CA", "OR", "WA", "NV", "AZ", "ID", "UT"],
  statesUrl:
    "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_States_Generalized_Boundaries/FeatureServer/0",
  // Map view on load (lon/lat box): Central America to Alaska
  startExtent: { xmin: -160, ymin: 8, xmax: -88, ymax: 64 },
  startSpecies: "all",          // "all" or a species code, e.g. "westan"
  playSpeedMs: 900,             // time per week when playing
  colors: {
    seasonStart: "#d99a2b",     // amber
    seasonMid: "#3e9a8f",       // teal
    seasonEnd: "#1f3d5a",       // deep blue
    inside: "#1f9e89",          // dot inside study states
    outside: "#8c9196",         // dot outside
    arrow: "#16324a"
  }
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (iso) => { const [, m, d] = iso.split("-").map(Number); return MONTHS[m - 1] + " " + d; };
const dateNum = (iso) => Number(iso.replaceAll("-", ""));

/* ---------- styles (kept here so index.html needs no extra CSS) ---------- */
const CSS = `
.fm{font-family:Inter,system-ui,sans-serif;color:#1d2b33}
.fm-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 10px}
.fm-bar .fm-label{font-size:13px;color:#5b6b73;margin-right:2px}
.fm-sp{border:1px solid #c9d3d6;background:#fff;border-radius:999px;padding:6px 12px;font:500 13px Inter,system-ui,sans-serif;cursor:pointer;color:#1d2b33}
.fm-sp:hover{border-color:#3e9a8f}
.fm-sp[aria-pressed="true"]{background:#1f3d5a;border-color:#1f3d5a;color:#fff}
.fm-mapwrap{position:relative;border-radius:12px;overflow:hidden;border:1px solid #d9e0e2}
.fm-view{height:620px;width:100%}
@media (max-width:700px){.fm-view{height:480px}}
.fm-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.75);font-size:14px;color:#33444c;z-index:2}
.fm-time{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;align-items:center;margin-top:12px}
.fm-play{width:42px;height:42px;border-radius:50%;border:none;background:#1f3d5a;color:#fff;font-size:16px;cursor:pointer;grid-row:span 2}
.fm-play:hover{background:#2c5476}
.fm-week{font:600 15px Inter,system-ui,sans-serif}
.fm-week span{font-weight:400;color:#5b6b73;font-size:13px;margin-left:8px}
.fm-sliderbox{position:relative;padding-top:2px}
.fm-slider{width:100%;accent-color:#1f3d5a;margin:0}
.fm-stops{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;min-height:28px;align-items:center}
.fm-stop{border:1px dashed #3e9a8f;background:#eef7f5;color:#1d4f49;border-radius:6px;padding:4px 9px;font:500 12px Inter,system-ui,sans-serif;cursor:pointer}
.fm-stop[aria-pressed="true"]{background:#1f9e89;color:#fff;border-style:solid}
.fm-stops .fm-hint{font-size:12px;color:#5b6b73}
.fm-toggles{display:flex;flex-wrap:wrap;gap:14px;margin-top:10px;font-size:13px}
.fm-toggles label{display:flex;gap:6px;align-items:center;cursor:pointer}
.fm-legend{display:flex;flex-wrap:wrap;gap:8px 20px;margin-top:12px;font-size:12.5px;color:#33444c;align-items:center}
.fm-legend i{display:inline-block;vertical-align:middle;margin-right:6px}
.fm-grad{width:90px;height:8px;border-radius:4px}
.fm-dot{width:10px;height:10px;border-radius:50%;border:1px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.15)}
.fm-box{width:16px;height:11px;border:1.5px solid #333;background:rgba(255,255,255,.4)}
.fm-fly{width:16px;height:11px;background:rgba(246,209,252,.6);border:1px solid #6e6e6e}
.fm-note{font-size:12px;color:#5b6b73;margin-top:8px;line-height:1.5}
`;

/* ---------- build the controls ---------- */
function buildUI(root, species) {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  const c = SETTINGS.colors;
  root.classList.add("fm");
  root.innerHTML = `
    <div class="fm-bar" role="group" aria-label="Choose a species">
      <span class="fm-label">Species:</span>
      <button class="fm-sp" data-sp="all">All six</button>
      ${species.map((s) => `<button class="fm-sp" data-sp="${s.code}">${s.name}</button>`).join("")}
    </div>
    <div class="fm-mapwrap">
      <div class="fm-view"></div>
      <div class="fm-loading">Loading migration routes…</div>
    </div>
    <div class="fm-time">
      <button class="fm-play" aria-label="Play weeks">▶</button>
      <div class="fm-week" aria-live="polite"></div>
      <div class="fm-sliderbox"><input class="fm-slider" type="range" min="0" max="0" step="1" value="0" aria-label="Week"></div>
    </div>
    <div class="fm-stops"></div>
    <div class="fm-toggles">
      <label><input type="checkbox" data-layer="paths" checked> Route lines</label>
      <label><input type="checkbox" data-layer="arrows" checked> Main corridor arrow</label>
      <label><input type="checkbox" data-layer="dots" checked> Birds this week</label>
    </div>
    <div class="fm-legend">
      <span><i class="fm-grad" style="background:linear-gradient(90deg,${c.seasonStart},${c.seasonMid},${c.seasonEnd})"></i>Start → end of season</span>
      <span><i class="fm-dot" style="background:${c.inside}"></i>Bird inside the study states</span>
      <span><i class="fm-dot" style="background:${c.outside}"></i>Bird outside</span>
      <span><i class="fm-box"></i>Study state</span>
      <span><i class="fm-fly"></i>Pacific Americas Flyway</span>
    </div>
    <p class="fm-note">200 simulated birds per species from BirdFlow, a model of bird movement (model estimates, not tracked birds).
      Faint lines are birds that never enter the study states. Click a line or dot for details.</p>`;
  return {
    view: root.querySelector(".fm-view"),
    loading: root.querySelector(".fm-loading"),
    spButtons: [...root.querySelectorAll(".fm-sp")],
    play: root.querySelector(".fm-play"),
    week: root.querySelector(".fm-week"),
    slider: root.querySelector(".fm-slider"),
    stops: root.querySelector(".fm-stops"),
    toggles: [...root.querySelectorAll(".fm-toggles input")]
  };
}

/* ---------- symbols ---------- */
function arrowSymbol(hex) {
  const rgb = hex.match(/\w\w/g).map((h) => parseInt(h, 16));
  const head = (size, placement) => ({
    type: "CIMVectorMarker", enable: true, size, respectFrame: true,
    anchorPointUnits: "Relative", anchorPoint: { x: 0, y: 0 },
    frame: { xmin: 0, ymin: 0, xmax: 10, ymax: 10 },
    markerPlacement: placement,
    markerGraphics: [{
      type: "CIMMarkerGraphic",
      geometry: { rings: [[[0, 0], [10, 5], [0, 10], [3, 5], [0, 0]]] },
      symbol: { type: "CIMPolygonSymbol", symbolLayers: [
        { type: "CIMSolidStroke", enable: true, width: 1.2, color: [255, 255, 255, 230] },
        { type: "CIMSolidFill", enable: true, color: [...rgb, 255] }] }
    }]
  });
  return {
    type: "cim",
    data: { type: "CIMSymbolReference", symbol: { type: "CIMLineSymbol", symbolLayers: [
      head(16, { type: "CIMMarkerPlacementAtExtremities", extremityPlacement: "JustEnd", angleToLine: true }),
      head(10, { type: "CIMMarkerPlacementAlongLineSameSize", angleToLine: true, placementTemplate: [70], endings: "Unconstrained" }),
      { type: "CIMSolidStroke", enable: true, width: 3.2, color: [...rgb, 255], capStyle: "Round", joinStyle: "Round" },
      { type: "CIMSolidStroke", enable: true, width: 6.5, color: [255, 255, 255, 190], capStyle: "Round", joinStyle: "Round" }
    ] } }
  };
}

/* ---------- main ---------- */
export async function initFlywayMap(root) {
  const data = window.FLYWAY_DATA ||
    (await fetch(new URL(SETTINGS.dataFile, import.meta.url)).then((r) => r.json()));
  const species = data.species;
  while (!window.$arcgis) await new Promise((r) => setTimeout(r, 50)); // wait for the ArcGIS loader in <head>
  const byCode = Object.fromEntries(species.map((s) => [s.code, s]));
  const ui = buildUI(root, species);

  const [WebMap, MapView, FeatureLayer, Graphic, Polyline, Point, Extent, geometryEngine, esriConfig] =
    await $arcgis.import([
      "@arcgis/core/WebMap.js", "@arcgis/core/views/MapView.js", "@arcgis/core/layers/FeatureLayer.js",
      "@arcgis/core/Graphic.js", "@arcgis/core/geometry/Polyline.js", "@arcgis/core/geometry/Point.js",
      "@arcgis/core/geometry/Extent.js", "@arcgis/core/geometry/geometryEngine.js", "@arcgis/core/config.js"
    ]);
  esriConfig.portalUrl = SETTINGS.portalUrl;

  const map = new WebMap({ portalItem: { id: SETTINGS.webMapId } });
  const view = new MapView({
    container: ui.view, map,
    extent: new Extent({ ...SETTINGS.startExtent, spatialReference: { wkid: 4326 } }),
    constraints: { minZoom: 2, snapToZoom: false },
    popup: { dockEnabled: false, defaultPopupTemplateEnabled: false }
  });

  /* study-state outlines */
  const where = `STATE_ABBR IN (${SETTINGS.studyStates.map((s) => `'${s}'`).join(",")})`;
  const statesLayer = new FeatureLayer({
    url: SETTINGS.statesUrl, definitionExpression: where, title: "Study states", popupEnabled: false,
    renderer: { type: "simple", symbol: { type: "simple-fill", color: [255, 255, 255, 0.25], outline: { color: [35, 35, 35, 0.9], width: 1.3 } } },
    labelingInfo: [{ labelExpressionInfo: { expression: "$feature.STATE_ABBR" },
      symbol: { type: "text", color: [30, 30, 30, 1], haloColor: "white", haloSize: 1.5, font: { size: 10, weight: "bold" } } }]
  });

  /* route segments (one feature per weekly hop, so each can carry its season colour) */
  const segGraphics = [];
  const corridorGraphics = [];
  let oid = 1;
  for (const s of species) {
    const n = s.dates.length;
    const sum = Array.from({ length: n }, () => [0, 0]);
    let used = 0;
    s.routes.forEach((flat, r) => {
      const cross = s.cross[r];
      for (let i = 0; i < n - 1; i++) {
        const a = [flat[2 * i], flat[2 * i + 1]], b = [flat[2 * i + 2], flat[2 * i + 3]];
        if (a[0] === b[0] && a[1] === b[1]) continue; // bird stayed put this week
        segGraphics.push(new Graphic({
          geometry: new Polyline({ paths: [[a, b]], spatialReference: { wkid: 4326 } }),
          attributes: { oid: oid++, sp: s.code, name: s.name, bird: r + 1, cross, frac: (i + 0.5) / (n - 1),
            wk: `${fmtDate(s.dates[i])} → ${fmtDate(s.dates[i + 1])}` }
        }));
      }
      if (cross) { used++; for (let i = 0; i < n; i++) { sum[i][0] += flat[2 * i]; sum[i][1] += flat[2 * i + 1]; } }
    });
    // main corridor = average weekly position of the birds that use the study states
    const path = sum.map(([x, y]) => [x / used, y / used])
      .filter((p, i, arr) => i === 0 || Math.hypot(p[0] - arr[i - 1][0], p[1] - arr[i - 1][1]) > 0.3);
    corridorGraphics.push(new Graphic({
      geometry: new Polyline({ paths: [path], spatialReference: { wkid: 4326 } }),
      attributes: { oid: corridorGraphics.length + 1, sp: s.code, name: s.name, used }
    }));
  }

  const fields = (extra) => [{ name: "oid", type: "oid" }, { name: "sp", type: "string" }, { name: "name", type: "string" }, ...extra];

  const pathsLayer = new FeatureLayer({
    title: "Simulated routes", source: segGraphics, objectIdField: "oid", geometryType: "polyline",
    spatialReference: { wkid: 4326 },
    fields: fields([{ name: "bird", type: "integer" }, { name: "cross", type: "integer" }, { name: "frac", type: "double" }, { name: "wk", type: "string" }]),
    renderer: {
      type: "simple", symbol: { type: "simple-line", width: 1, color: SETTINGS.colors.seasonMid, cap: "round" },
      visualVariables: [
        { type: "color", field: "frac", stops: [
          { value: 0, color: SETTINGS.colors.seasonStart }, { value: 0.5, color: SETTINGS.colors.seasonMid }, { value: 1, color: SETTINGS.colors.seasonEnd }] },
        { type: "opacity", field: "cross", stops: [{ value: 0, opacity: 0.18 }, { value: 1, opacity: 0.45 }] },
        { type: "size", field: "cross", stops: [{ value: 0, size: 0.6 }, { value: 1, size: 1.2 }] }
      ]
    },
    popupTemplate: { title: "{name} — simulated bird #{bird}",
      content: [{ type: "text", text: "Week of {wk}<br>{expression/passes}" }],
      expressionInfos: [{ name: "passes", expression: "IIF($feature.cross == 1, 'This bird passes through the study states.', 'This bird never enters the study states.')" }] }
  });

  const arrowsLayer = new FeatureLayer({
    title: "Main corridor", source: corridorGraphics, objectIdField: "oid", geometryType: "polyline",
    spatialReference: { wkid: 4326 }, fields: fields([{ name: "used", type: "integer" }]),
    renderer: { type: "simple", symbol: arrowSymbol(SETTINGS.colors.arrow) },
    labelingInfo: [{ labelExpressionInfo: { expression: "$feature.name" }, labelPlacement: "center-along",
      symbol: { type: "text", color: SETTINGS.colors.arrow, haloColor: "white", haloSize: 2, font: { size: 11, weight: "bold", family: "Inter" } } }],
    popupTemplate: { title: "{name}: main spring corridor",
      content: "The average weekly position of the {used} simulated birds (of 200) that pass through the study states. Arrows point the way they travel." }
  });

  map.addMany([statesLayer, pathsLayer, arrowsLayer]);

  /* bird positions per week — need inside/outside, so load state shapes first */
  const statesFS = await statesLayer.queryFeatures({ where, returnGeometry: true, outSpatialReference: { wkid: 4326 }, maxAllowableOffset: 0.02 });
  const stateGeoms = statesFS.features.map((f) => f.geometry);
  const inside = (x, y) => stateGeoms.some((g) => x >= g.extent.xmin && x <= g.extent.xmax && y >= g.extent.ymin && y <= g.extent.ymax &&
    geometryEngine.contains(g, new Point({ x, y, spatialReference: { wkid: 4326 } })));

  const dotGraphics = [];
  const insideCount = {}; // `${sp}|${date}` -> n inside
  for (const s of species) {
    s.dates.forEach((d, i) => {
      let k = 0;
      s.routes.forEach((flat, r) => {
        const x = flat[2 * i], y = flat[2 * i + 1], inn = inside(x, y) ? 1 : 0;
        k += inn;
        dotGraphics.push(new Graphic({ geometry: new Point({ x, y, spatialReference: { wkid: 4326 } }),
          attributes: { oid: dotGraphics.length + 1, sp: s.code, name: s.name, bird: r + 1, t: dateNum(d), inside: inn, wk: fmtDate(d) } }));
      });
      insideCount[`${s.code}|${d}`] = k;
    });
  }
  const dotSym = (color) => ({ type: "simple-marker", size: 6.5, color, outline: { color: [255, 255, 255, 0.9], width: 0.8 } });
  const dotsLayer = new FeatureLayer({
    title: "Birds this week", source: dotGraphics, objectIdField: "oid", geometryType: "point", spatialReference: { wkid: 4326 },
    fields: fields([{ name: "bird", type: "integer" }, { name: "t", type: "integer" }, { name: "inside", type: "integer" }, { name: "wk", type: "string" }]),
    renderer: { type: "unique-value", field: "inside", defaultSymbol: dotSym(SETTINGS.colors.outside),
      uniqueValueInfos: [{ value: 1, symbol: dotSym(SETTINGS.colors.inside) }, { value: 0, symbol: dotSym(SETTINGS.colors.outside) }] },
    definitionExpression: "1=0",
    popupTemplate: { title: "{name} — simulated bird #{bird}",
      content: [{ type: "text", text: "Week of {wk}: {expression/where}" }],
      expressionInfos: [{ name: "where", expression: "IIF($feature.inside == 1, 'inside the study states', 'outside the study states')" }] }
  });
  map.add(dotsLayer);

  /* ---------- state + interaction ---------- */
  const allDates = [...new Set(species.flatMap((s) => s.dates))].sort();
  let current = SETTINGS.startSpecies;
  let dates = allDates;
  let idx = 0;
  let timer = null;

  function renderWeek() {
    const d = dates[idx];
    const spFilter = current === "all" ? "" : `sp = '${current}' AND `;
    dotsLayer.definitionExpression = `${spFilter}t = ${dateNum(d)}`;
    let summary;
    if (current === "all") {
      const active = species.filter((s) => s.dates.includes(d));
      const k = active.reduce((a, s) => a + insideCount[`${s.code}|${d}`], 0);
      summary = active.length ? `${k} of ${active.reduce((a, s) => a + s.routes.length, 0)} birds (${active.length} species migrating) inside the study states` : "";
    } else {
      summary = `${insideCount[`${current}|${d}`]} of ${byCode[current].routes.length} birds inside the study states`;
    }
    ui.week.innerHTML = `Week of ${fmtDate(d)}<span>${summary}</span>`;
    ui.slider.value = idx;
    ui.stops.querySelectorAll(".fm-stop").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.date === d)));
  }

  function setSpecies(code) {
    current = code;
    const s = byCode[code];
    const prev = dates[idx];
    dates = s ? s.dates : allDates;
    idx = Math.max(0, dates.indexOf(prev));
    if (s && !dates.includes(prev)) idx = dates.indexOf(s.stops[1].date);
    ui.slider.max = dates.length - 1;
    ui.spButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sp === code)));
    const filt = s ? `sp = '${code}'` : null;
    pathsLayer.definitionExpression = filt;
    arrowsLayer.definitionExpression = filt;
    ui.stops.innerHTML = s
      ? `<span class="fm-hint">Jump to:</span>` + s.stops.map((st) =>
          `<button class="fm-stop" data-date="${st.date}" title="${st.note}">${st.label} · ${fmtDate(st.date)}</button>`).join("")
      : `<span class="fm-hint">Pick a species to jump to its early, midpoint and peak weeks.</span>`;
    ui.stops.querySelectorAll(".fm-stop").forEach((b) => b.addEventListener("click", () => {
      stop(); idx = dates.indexOf(b.dataset.date); renderWeek();
    }));
    renderWeek();
  }

  function stop() { clearInterval(timer); timer = null; ui.play.textContent = "▶"; ui.play.setAttribute("aria-label", "Play weeks"); }
  function play() {
    if (idx >= dates.length - 1) idx = 0;
    ui.play.textContent = "❚❚"; ui.play.setAttribute("aria-label", "Pause");
    timer = setInterval(() => {
      if (idx >= dates.length - 1) { stop(); return; }
      idx++; renderWeek();
    }, SETTINGS.playSpeedMs);
    renderWeek();
  }

  ui.play.addEventListener("click", () => (timer ? stop() : play()));
  ui.slider.addEventListener("input", () => { stop(); idx = Number(ui.slider.value); renderWeek(); });
  ui.spButtons.forEach((b) => b.addEventListener("click", () => { stop(); setSpecies(b.dataset.sp); }));
  const layerFor = { paths: pathsLayer, arrows: arrowsLayer, dots: dotsLayer };
  ui.toggles.forEach((t) => t.addEventListener("change", () => { layerFor[t.dataset.layer].visible = t.checked; }));

  idx = Math.max(0, allDates.indexOf("2023-04-26"));
  setSpecies(current);
  await view.when();
  ui.loading.remove();
  return view;
}

const root = document.getElementById("flyway-map-app");
if (root) initFlywayMap(root).catch((err) => {
  console.error("Flyway map failed to load:", err);
  root.insertAdjacentHTML("beforeend", `<p style="color:#a33">The migration map could not load. (${err.message || err})</p>`);
});
