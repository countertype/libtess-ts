#!/usr/bin/env node
/**
 * Paired A/B benchmark: libtess.js vs libtess-ts vs tess2.js
 *
 * Runs synthetic and real-world geometry workloads with statistical rigor:
 *   - Paired measurements alternate A/B to eliminate thermal drift
 *   - Welch's paired t-test with p-values and 95% confidence intervals
 *   - Cold (new instance per call) and warm (reused instance) paths
 *
 * All runners accumulate output (vertices + elements) for a fair comparison,
 * since tess2.js always builds result arrays internally.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const libtessJs = require('libtess');
const libtessTs = await import('../dist/libtess.min.js');
const tess2 = createRequire(import.meta.url)('tess2');

const thirdPartyGeometries = [
  require('../test/data/geometry/poly2tri-dude.cjs'),
  require('../test/data/geometry/osm_building.cjs'),
  require('../test/data/geometry/osm_two_buildings.cjs'),
  require('../test/data/geometry/osm_nyc_midtown.cjs'),
  require('../test/data/geometry/roboto-registered.cjs'),
  require('../test/data/geometry/letter-e.cjs'),
  require('../test/data/geometry/hourglass.cjs'),
  require('../test/data/geometry/intersection-heavy.cjs'),
  require('../test/data/geometry/shared-borders.cjs'),
  require('../test/data/geometry/degenerate-hourglass.cjs'),
];

function mean(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

function variance(arr, m) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) { const d = arr[i] - m; s += d * d; }
  return s / (arr.length - 1);
}

// Normal CDF (Abramowitz & Stegun 7.1.26)
function normCDF(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sgn = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sgn * y);
}

// t-distribution CDF (Cornish-Fisher approx, accurate for df > 5)
function tCDF(t, df) {
  const g1 = 1 / (4 * df);
  return normCDF(t * (1 - g1));
}

// Paired t-test on raw time arrays (same length)
function pairedTest(a, b) {
  const n = a.length;
  const diffs = new Float64Array(n);
  for (let i = 0; i < n; i++) diffs[i] = a[i] - b[i];
  const m = mean(diffs);
  const v = variance(diffs, m);
  const se = Math.sqrt(v / n);
  const t = se > 0 ? m / se : 0;
  const df = n - 1;
  const p = 2 * (1 - tCDF(Math.abs(t), df));
  const tCrit = 1.96 + 2.4 / df;
  const ci = tCrit * se;
  return { meanDiff: m, ci, t, df, p, se };
}

// Glyph-like 'O' shape: outer ellipse + inner hole, ~60 verts
function makeGlyph() {
  const outer = [], hole = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    outer.push(Math.cos(a) * 50, Math.sin(a) * 70);
  }
  for (let i = 20 - 1; i >= 0; i--) {
    const a = (i / 20) * Math.PI * 2;
    hole.push(Math.cos(a) * 25, Math.sin(a) * 40);
  }
  return [outer, hole];
}

// Star-like ripple polygon (single contour)
function makeStar(n) {
  const c = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 100 + Math.sin(a * 7) * 10 + Math.cos(a * 13) * 5;
    c.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  return [c];
}

// Real glyph 'e' with self-intersections (cubics flattened to polyline)
function makeGlyphE() {
  const commands = [
    { cmd: 'M', pts: [375.0, 576.0] },
    { cmd: 'L', pts: [375.0, 576.0] },
    { cmd: 'L', pts: [853.0, 576.0] },
    { cmd: 'C', pts: [861.0, 604.0, 867.0, 658.0, 867.0, 750.0] },
    { cmd: 'C', pts: [864.0, 976.0, 729.0, 1116.0, 502.0, 1116.0] },
    { cmd: 'C', pts: [238.0, 1116.0, 50.0, 913.0, 50.0, 584.0] },
    { cmd: 'C', pts: [50.0, 267.0, 190.0, 50.0, 489.0, 50.0] },
    { cmd: 'C', pts: [647.0, 50.0, 791.0, 133.0, 839.0, 199.0] },
    { cmd: 'L', pts: [817.0, 258.0] },
    { cmd: 'C', pts: [769.0, 213.0, 685.0, 182.0, 630.0, 182.0] },
    { cmd: 'C', pts: [454.0, 182.0, 390.0, 358.0, 387.0, 598.0] },
    { cmd: 'C', pts: [382.0, 995.0, 425.0, 1061.0, 487.0, 1061.0] },
    { cmd: 'C', pts: [541.0, 1061.0, 563.0, 994.0, 563.0, 771.0] },
    { cmd: 'L', pts: [563.0, 609.0] },
    { cmd: 'L', pts: [710.0, 652.0] },
    { cmd: 'L', pts: [373.0, 631.0] },
    { cmd: 'Z', pts: [] },
  ];
  function sampleCubic(p0, p1, p2, p3, segments) {
    const pts = [];
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const mt = 1 - t;
      const x = mt*mt*mt*p0[0] + 3*mt*mt*t*p1[0] + 3*mt*t*t*p2[0] + t*t*t*p3[0];
      const y = mt*mt*mt*p0[1] + 3*mt*mt*t*p1[1] + 3*mt*t*t*p2[1] + t*t*t*p3[1];
      pts.push(x, y);
    }
    return pts;
  }
  const contour = [];
  let current = [0, 0], start = [0, 0];
  for (const c of commands) {
    if (c.cmd === 'M') {
      current = [c.pts[0], c.pts[1]]; start = current.slice();
      contour.push(current[0], current[1]);
    } else if (c.cmd === 'L') {
      current = [c.pts[0], c.pts[1]];
      contour.push(current[0], current[1]);
    } else if (c.cmd === 'C') {
      const segs = sampleCubic(current, [c.pts[0], c.pts[1]], [c.pts[2], c.pts[3]], [c.pts[4], c.pts[5]], 24);
      contour.push(...segs);
      current = [c.pts[4], c.pts[5]];
    } else if (c.cmd === 'Z') {
      contour.push(start[0], start[1]);
    }
  }
  return [contour];
}

// libtess.js cold (2D contours, accumulates output)
function coldJs2D(contours, useNormal, useCombine) {
  const t = new libtessJs.GluTesselator();
  const verts = [];
  const elems = [];
  let vi = 0;
  t.gluTessCallback(libtessJs.gluEnum.GLU_TESS_VERTEX_DATA, (d) => { verts.push(d[0], d[1]); });
  t.gluTessCallback(libtessJs.gluEnum.GLU_TESS_BEGIN, () => {});
  t.gluTessCallback(libtessJs.gluEnum.GLU_TESS_END, () => {});
  if (useCombine) t.gluTessCallback(libtessJs.gluEnum.GLU_TESS_COMBINE, (c) => [c[0], c[1]]);
  if (useNormal) t.gluTessNormal(0, 0, 1);
  const tmp = [0, 0, 0];
  const start = performance.now();
  t.gluTessBeginPolygon();
  for (const c of contours) {
    t.gluTessBeginContour();
    for (let j = 0; j < c.length; j += 2) {
      tmp[0] = c[j]; tmp[1] = c[j + 1]; tmp[2] = 0;
      t.gluTessVertex(tmp, [c[j], c[j + 1]]);
    }
    t.gluTessEndContour();
  }
  t.gluTessEndPolygon();
  // Build element indices from triangle fan output
  for (let i = 0; i < verts.length / 2; i++) elems.push(i);
  return performance.now() - start;
}

// libtess-ts cold (2D contours, accumulates output)
function coldTs2D(contours, useNormal, useCombine) {
  const t = new libtessTs.GluTesselator();
  const verts = [];
  const elems = [];
  t.gluTessCallback(100100, () => {});
  t.gluTessCallback(100101, (d) => { verts.push(d[0], d[1]); });
  t.gluTessCallback(100102, () => {});
  if (useCombine) t.gluTessCallback(100105, (c) => [c[0], c[1]]);
  if (useNormal) t.gluTessNormal(0, 0, 1);
  const tmp = [0, 0];
  const start = performance.now();
  t.gluTessBeginPolygon();
  for (const c of contours) {
    t.gluTessBeginContour();
    for (let j = 0; j < c.length; j += 2) {
      tmp[0] = c[j]; tmp[1] = c[j + 1];
      t.gluTessVertex(tmp, [c[j], c[j + 1]]);
    }
    t.gluTessEndContour();
  }
  t.gluTessEndPolygon();
  for (let i = 0; i < verts.length / 2; i++) elems.push(i);
  return performance.now() - start;
}

// tess2.js cold (2D contours, always accumulates output)
function coldTess2_2D(contours, useNormal, useCombine) {
  const start = performance.now();
  tess2.tesselate({
    contours,
    windingRule: tess2.WINDING_NONZERO,
    elementType: tess2.POLYGONS,
    polySize: 3,
    vertexSize: 2,
  });
  return performance.now() - start;
}

// libtess.js warm (2D, reused instance, accumulates output)
function warmJs2D(contours, useNormal, useCombine) {
  const t = new libtessJs.GluTesselator();
  const verts = [];
  const elems = [];
  t.gluTessCallback(libtessJs.gluEnum.GLU_TESS_VERTEX_DATA, (d) => { verts.push(d[0], d[1]); });
  t.gluTessCallback(libtessJs.gluEnum.GLU_TESS_BEGIN, () => {});
  t.gluTessCallback(libtessJs.gluEnum.GLU_TESS_END, () => {});
  if (useCombine) t.gluTessCallback(libtessJs.gluEnum.GLU_TESS_COMBINE, (c) => [c[0], c[1]]);
  if (useNormal) t.gluTessNormal(0, 0, 1);
  const tmp = [0, 0, 0];
  return () => {
    verts.length = 0;
    elems.length = 0;
    const start = performance.now();
    t.gluTessBeginPolygon();
    for (const c of contours) {
      t.gluTessBeginContour();
      for (let j = 0; j < c.length; j += 2) {
        tmp[0] = c[j]; tmp[1] = c[j + 1]; tmp[2] = 0;
        t.gluTessVertex(tmp, [c[j], c[j + 1]]);
      }
      t.gluTessEndContour();
    }
    t.gluTessEndPolygon();
    for (let i = 0; i < verts.length / 2; i++) elems.push(i);
    return performance.now() - start;
  };
}

// libtess-ts warm (2D, reused instance, accumulates output)
function warmTs2D(contours, useNormal, useCombine) {
  const t = new libtessTs.GluTesselator();
  const verts = [];
  const elems = [];
  t.gluTessCallback(100100, () => {});
  t.gluTessCallback(100101, (d) => { verts.push(d[0], d[1]); });
  t.gluTessCallback(100102, () => {});
  if (useCombine) t.gluTessCallback(100105, (c) => [c[0], c[1]]);
  if (useNormal) t.gluTessNormal(0, 0, 1);
  const tmp = [0, 0];
  return () => {
    verts.length = 0;
    elems.length = 0;
    const start = performance.now();
    t.gluTessBeginPolygon();
    for (const c of contours) {
      t.gluTessBeginContour();
      for (let j = 0; j < c.length; j += 2) {
        tmp[0] = c[j]; tmp[1] = c[j + 1];
        t.gluTessVertex(tmp, [c[j], c[j + 1]]);
      }
      t.gluTessEndContour();
    }
    t.gluTessEndPolygon();
    for (let i = 0; i < verts.length / 2; i++) elems.push(i);
    return performance.now() - start;
  };
}

// libtess.js cold (3D contours, accumulates output)
function coldJs3D(contours, useCombine) {
  const t = new libtessJs.GluTesselator();
  const verts = [];
  const elems = [];
  t.gluTessCallback(libtessJs.gluEnum.GLU_TESS_VERTEX_DATA, (d) => { verts.push(d[0], d[1], d[2]); });
  t.gluTessCallback(libtessJs.gluEnum.GLU_TESS_BEGIN, () => {});
  t.gluTessCallback(libtessJs.gluEnum.GLU_TESS_END, () => {});
  if (useCombine) t.gluTessCallback(libtessJs.gluEnum.GLU_TESS_COMBINE, (c) => [c[0], c[1], c[2]]);
  t.gluTessNormal(0, 0, 1);
  const tmp = [0, 0, 0];
  const start = performance.now();
  t.gluTessBeginPolygon();
  for (const c of contours) {
    t.gluTessBeginContour();
    for (let j = 0; j < c.length; j += 3) {
      tmp[0] = c[j]; tmp[1] = c[j + 1]; tmp[2] = c[j + 2];
      t.gluTessVertex(tmp, [c[j], c[j + 1], c[j + 2]]);
    }
    t.gluTessEndContour();
  }
  t.gluTessEndPolygon();
  for (let i = 0; i < verts.length / 3; i++) elems.push(i);
  return performance.now() - start;
}

// libtess-ts cold (3D contours, accumulates output)
function coldTs3D(contours, useCombine) {
  const t = new libtessTs.GluTesselator();
  const verts = [];
  const elems = [];
  t.gluTessCallback(100100, () => {});
  t.gluTessCallback(100101, (d) => { verts.push(d[0], d[1], d[2]); });
  t.gluTessCallback(100102, () => {});
  if (useCombine) t.gluTessCallback(100105, (c) => [c[0], c[1], c[2]]);
  t.gluTessNormal(0, 0, 1);
  const tmp = [0, 0, 0];
  const start = performance.now();
  t.gluTessBeginPolygon();
  for (const c of contours) {
    t.gluTessBeginContour();
    for (let j = 0; j < c.length; j += 3) {
      tmp[0] = c[j]; tmp[1] = c[j + 1]; tmp[2] = c[j + 2];
      t.gluTessVertex(tmp, [c[j], c[j + 1], c[j + 2]]);
    }
    t.gluTessEndContour();
  }
  t.gluTessEndPolygon();
  for (let i = 0; i < verts.length / 3; i++) elems.push(i);
  return performance.now() - start;
}

// tess2.js cold (3D contours, always accumulates output)
function coldTess2_3D(contours, useCombine) {
  const start = performance.now();
  tess2.tesselate({
    contours,
    windingRule: tess2.WINDING_NONZERO,
    elementType: tess2.POLYGONS,
    polySize: 3,
    vertexSize: 3,
  });
  return performance.now() - start;
}

// libtess.js warm (3D, reused instance, accumulates output)
function warmJs3D(contours, useCombine) {
  const t = new libtessJs.GluTesselator();
  const verts = [];
  const elems = [];
  t.gluTessCallback(libtessJs.gluEnum.GLU_TESS_VERTEX_DATA, (d) => { verts.push(d[0], d[1], d[2]); });
  t.gluTessCallback(libtessJs.gluEnum.GLU_TESS_BEGIN, () => {});
  t.gluTessCallback(libtessJs.gluEnum.GLU_TESS_END, () => {});
  if (useCombine) t.gluTessCallback(libtessJs.gluEnum.GLU_TESS_COMBINE, (c) => [c[0], c[1], c[2]]);
  t.gluTessNormal(0, 0, 1);
  const tmp = [0, 0, 0];
  return () => {
    verts.length = 0;
    elems.length = 0;
    const start = performance.now();
    t.gluTessBeginPolygon();
    for (const c of contours) {
      t.gluTessBeginContour();
      for (let j = 0; j < c.length; j += 3) {
        tmp[0] = c[j]; tmp[1] = c[j + 1]; tmp[2] = c[j + 2];
        t.gluTessVertex(tmp, [c[j], c[j + 1], c[j + 2]]);
      }
      t.gluTessEndContour();
    }
    t.gluTessEndPolygon();
    for (let i = 0; i < verts.length / 3; i++) elems.push(i);
    return performance.now() - start;
  };
}

// libtess-ts warm (3D, reused instance, accumulates output)
function warmTs3D(contours, useCombine) {
  const t = new libtessTs.GluTesselator();
  const verts = [];
  const elems = [];
  t.gluTessCallback(100100, () => {});
  t.gluTessCallback(100101, (d) => { verts.push(d[0], d[1], d[2]); });
  t.gluTessCallback(100102, () => {});
  if (useCombine) t.gluTessCallback(100105, (c) => [c[0], c[1], c[2]]);
  t.gluTessNormal(0, 0, 1);
  const tmp = [0, 0, 0];
  return () => {
    verts.length = 0;
    elems.length = 0;
    const start = performance.now();
    t.gluTessBeginPolygon();
    for (const c of contours) {
      t.gluTessBeginContour();
      for (let j = 0; j < c.length; j += 3) {
        tmp[0] = c[j]; tmp[1] = c[j + 1]; tmp[2] = c[j + 2];
        t.gluTessVertex(tmp, [c[j], c[j + 1], c[j + 2]]);
      }
      t.gluTessEndContour();
    }
    t.gluTessEndPolygon();
    for (let i = 0; i < verts.length / 3; i++) elems.push(i);
    return performance.now() - start;
  };
}

function needsCombine(geom) {
  const names = ['hourglass', 'degenerate', 'intersection'];
  return names.some(n => geom.name.toLowerCase().includes(n));
}

function vertCount(geom) {
  let n = 0;
  for (const c of geom.value) n += c.length / 3;
  return n;
}

// Convert 3D contours (stride 3) to 2D (stride 2) for tess2.js vertexSize=2
function contours3Dto2D(contours) {
  return contours.map(c => {
    const out = [];
    for (let i = 0; i < c.length; i += 3) {
      out.push(c[i], c[i + 1]);
    }
    return out;
  });
}

const WARMUP = 200;
const SAMPLES = 500;
const PAD = 42;

function bench2(label, runA, runB) {
  for (let i = 0; i < WARMUP; i++) { runA(); runB(); }

  const tA = new Float64Array(SAMPLES);
  const tB = new Float64Array(SAMPLES);

  for (let i = 0; i < SAMPLES; i++) {
    if (i & 1) { tB[i] = runB(); tA[i] = runA(); }
    else       { tA[i] = runA(); tB[i] = runB(); }
  }

  const mA = mean(tA), mB = mean(tB);
  const res = pairedTest(tA, tB);
  const pct = ((mB - mA) / mA * 100);
  const sig = res.p < 0.001 ? '***' : res.p < 0.01 ? '**' : res.p < 0.05 ? '*' : ' ns';
  const pStr = res.p < 0.0001 ? '<0.0001' : res.p.toFixed(4);
  const loCI = ((res.meanDiff - res.ci) * 1000).toFixed(1);
  const hiCI = ((res.meanDiff + res.ci) * 1000).toFixed(1);

  console.log(
    `  ${label.padEnd(PAD)}` +
    `  A ${(mA * 1000).toFixed(0).padStart(6)}μs` +
    `  B ${(mB * 1000).toFixed(0).padStart(6)}μs` +
    `  ${pct > 0 ? '+' : ''}${pct.toFixed(1).padStart(5)}%` +
    `  p=${pStr.padEnd(7)} ${sig}` +
    `  CI:[${loCI},${hiCI}]μs`
  );
}

function bench3(label, runA, runB, runC) {
  for (let i = 0; i < WARMUP; i++) { runA(); runB(); runC(); }

  const tA = new Float64Array(SAMPLES);
  const tB = new Float64Array(SAMPLES);
  const tC = new Float64Array(SAMPLES);

  // Rotate order each iteration: ABC, BCA, CAB
  for (let i = 0; i < SAMPLES; i++) {
    switch (i % 3) {
      case 0: tA[i] = runA(); tB[i] = runB(); tC[i] = runC(); break;
      case 1: tB[i] = runB(); tC[i] = runC(); tA[i] = runA(); break;
      case 2: tC[i] = runC(); tA[i] = runA(); tB[i] = runB(); break;
    }
  }

  const mA = mean(tA), mB = mean(tB), mC = mean(tC);
  const ab = pairedTest(tA, tB);
  const ac = pairedTest(tA, tC);
  const bc = pairedTest(tB, tC);

  function fmt(baseline, other, res) {
    const pct = ((other - baseline) / baseline * 100);
    const sig = res.p < 0.001 ? '***' : res.p < 0.01 ? '**' : res.p < 0.05 ? '*' : 'ns';
    return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}% ${sig}`;
  }

  console.log(
    `  ${label.padEnd(PAD)}` +
    `  JS ${(mA * 1000).toFixed(0).padStart(5)}μs` +
    `  TS ${(mB * 1000).toFixed(0).padStart(5)}μs` +
    `  T2 ${(mC * 1000).toFixed(0).padStart(5)}μs` +
    `  JS→TS ${fmt(mA, mB, ab).padStart(10)}` +
    `  JS→T2 ${fmt(mA, mC, ac).padStart(10)}` +
    `  TS→T2 ${fmt(mB, mC, bc).padStart(10)}`
  );
}

const glyph   = makeGlyph();
const glyphE  = makeGlyphE();
const star1k  = makeStar(1000);
const star7k  = makeStar(7000);
const glyphEVerts = glyphE[0].length / 2;

const W = 140;

console.log();
console.log('='.repeat(W));
console.log(`  libtess.js (JS) vs libtess-ts (TS) vs tess2.js (T2) | ${WARMUP} warmup + ${SAMPLES} samples | paired t-test`);
console.log(`  All runners accumulate output arrays for fair comparison.`);
console.log('='.repeat(W));

// Section 1: Synthetic cold, 3-way
console.log();
console.log('  SYNTHETIC - COLD (new instance per call)');
console.log('  ' + '-'.repeat(W - 2));
bench3('Glyph 60v, normal=[0,0,1]',
  () => coldJs2D(glyph, true, false),
  () => coldTs2D(glyph, true, false),
  () => coldTess2_2D(glyph, false, false));
bench3('Glyph 60v, no normal',
  () => coldJs2D(glyph, false, false),
  () => coldTs2D(glyph, false, false),
  () => coldTess2_2D(glyph, false, false));
bench3(`Glyph-e ${glyphEVerts}v, self-intersect`,
  () => coldJs2D(glyphE, true, true),
  () => coldTs2D(glyphE, true, true),
  () => coldTess2_2D(glyphE, false, true));
bench3('Star 1Kv, no normal',
  () => coldJs2D(star1k, false, false),
  () => coldTs2D(star1k, false, false),
  () => coldTess2_2D(star1k, false, false));
bench3('Star 7Kv, no normal',
  () => coldJs2D(star7k, false, false),
  () => coldTs2D(star7k, false, false),
  () => coldTess2_2D(star7k, false, false));

// Section 2: Synthetic warm (JS vs TS only - tess2.js has no reuse path)
console.log();
console.log('  SYNTHETIC - WARM (reused instance, JS vs TS only)');
console.log('  ' + '-'.repeat(W - 2));
bench2('Glyph 60v, normal=[0,0,1]',    warmJs2D(glyph, true, false),  warmTs2D(glyph, true, false));
bench2('Glyph 60v, no normal',          warmJs2D(glyph, false, false), warmTs2D(glyph, false, false));
bench2(`Glyph-e ${glyphEVerts}v, self-intersect`, warmJs2D(glyphE, true, true),  warmTs2D(glyphE, true, true));
bench2('Star 1Kv, no normal',           warmJs2D(star1k, false, false), warmTs2D(star1k, false, false));
bench2('Star 7Kv, no normal',           warmJs2D(star7k, false, false), warmTs2D(star7k, false, false));

// Section 3: Third-party geometry cold, 3-way
console.log();
console.log('  THIRD-PARTY GEOMETRY - COLD');
console.log('  ' + '-'.repeat(W - 2));
for (const geom of thirdPartyGeometries) {
  const verts = vertCount(geom);
  const combine = needsCombine(geom);
  const label = `${geom.name} (${verts}v${combine ? ', combine' : ''})`;
  const contours2D = contours3Dto2D(geom.value);
  bench3(label,
    () => coldJs3D(geom.value, combine),
    () => coldTs3D(geom.value, combine),
    () => coldTess2_2D(contours2D, false, combine)
  );
}

// Section 4: Third-party geometry warm (JS vs TS only)
console.log();
console.log('  THIRD-PARTY GEOMETRY - WARM (JS vs TS only)');
console.log('  ' + '-'.repeat(W - 2));
for (const geom of thirdPartyGeometries) {
  const verts = vertCount(geom);
  const combine = needsCombine(geom);
  const label = `${geom.name} (${verts}v${combine ? ', combine' : ''})`;
  bench2(label,
    warmJs3D(geom.value, combine),
    warmTs3D(geom.value, combine)
  );
}

console.log();
console.log('  Significance: *** p<0.001  ** p<0.01  * p<0.05  ns = not significant');
console.log('  Negative % = second library is faster. All runners accumulate vertices + elements.');
console.log('  JS = libtess.js  TS = libtess-ts  T2 = tess2.js');
console.log('='.repeat(W));
console.log();
