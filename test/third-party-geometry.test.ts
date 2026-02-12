import { describe, it, expect } from 'vitest';
import { GluTesselator, WINDING, GLU_TESS } from '../src';

const poly2triDude = require('./data/geometry/poly2tri-dude.cjs');
const osmBuilding = require('./data/geometry/osm_building.cjs');
const osmTwoBuildings = require('./data/geometry/osm_two_buildings.cjs');
const osmNycMidtown = require('./data/geometry/osm_nyc_midtown.cjs');
const robotoRegistered = require('./data/geometry/roboto-registered.cjs');
const hourglass = require('./data/geometry/hourglass.cjs');
const twoTriangles = require('./data/geometry/two-triangles.cjs');
const letterE = require('./data/geometry/letter-e.cjs');
const degenerateHourglass = require('./data/geometry/degenerate-hourglass.cjs');
const intersectionHeavy = require('./data/geometry/intersection-heavy.cjs');
const sharedBorders = require('./data/geometry/shared-borders.cjs');
const sharedEdgeTriangles = require('./data/geometry/shared-edge-triangles.cjs');
const twoOppositeTriangles = require('./data/geometry/two-opposite-triangles.cjs');

const libtessJs = require('libtess');

interface Geometry {
  name: string;
  value: number[][];
}

const ALL_GEOMETRIES: Geometry[] = [
  // Third-party
  poly2triDude,
  osmBuilding,
  osmTwoBuildings,
  osmNycMidtown,
  robotoRegistered,
  // Core
  hourglass,
  twoTriangles,
  letterE,
  degenerateHourglass,
  intersectionHeavy,
  sharedBorders,
  sharedEdgeTriangles,
  twoOppositeTriangles
];

const WINDING_RULES = [
  { name: 'ODD', value: WINDING.ODD, jsValue: libtessJs.windingRule.GLU_TESS_WINDING_ODD },
  { name: 'NONZERO', value: WINDING.NONZERO, jsValue: libtessJs.windingRule.GLU_TESS_WINDING_NONZERO },
  { name: 'POSITIVE', value: WINDING.POSITIVE, jsValue: libtessJs.windingRule.GLU_TESS_WINDING_POSITIVE },
  { name: 'NEGATIVE', value: WINDING.NEGATIVE, jsValue: libtessJs.windingRule.GLU_TESS_WINDING_NEGATIVE },
  { name: 'ABS_GEQ_TWO', value: WINDING.ABS_GEQ_TWO, jsValue: libtessJs.windingRule.GLU_TESS_WINDING_ABS_GEQ_TWO }
];

// Tessellate contours (flat xyz arrays) with libtess-ts, return flat vertex output
function tessellateTS(
  contours: number[][],
  windingRule: number,
  normal: [number, number, number] = [0, 0, 1]
): number[] {
  const tess = new GluTesselator();
  const result: number[] = [];

  tess.gluTessCallback(GLU_TESS.BEGIN, () => {}); // BEGIN
  tess.gluTessCallback(GLU_TESS.VERTEX, (data: any) => {
    result.push(data[0], data[1], data[2]);
  });
  tess.gluTessCallback(GLU_TESS.END, () => {}); // END
  tess.gluTessCallback(GLU_TESS.COMBINE, (coords: number[], data: any[], weight: number[]) => {
    return [coords[0], coords[1], coords[2]];
  });

  tess.gluTessProperty(GLU_TESS.WINDING_RULE, windingRule); // GLU_TESS_WINDING_RULE
  tess.gluTessNormal(...normal);

  tess.gluTessBeginPolygon();
  for (const contour of contours) {
    tess.gluTessBeginContour();
    for (let j = 0; j < contour.length; j += 3) {
      const coords: [number, number, number] = [contour[j], contour[j + 1], contour[j + 2]];
      tess.gluTessVertex(coords, coords);
    }
    tess.gluTessEndContour();
  }
  tess.gluTessEndPolygon();

  return result;
}

function tessellateJS(
  contours: number[][],
  windingRule: number,
  normal: [number, number, number] = [0, 0, 1]
): number[] {
  const tess = new libtessJs.GluTesselator();
  const resultVerts: number[][] = [];

  tess.gluTessCallback(libtessJs.gluEnum.GLU_TESS_BEGIN_DATA, (_type: number, arr: number[][]) => {
    arr.push([]);
  });
  tess.gluTessCallback(libtessJs.gluEnum.GLU_TESS_VERTEX_DATA, (data: number[], arr: number[][]) => {
    arr[arr.length - 1].push(data[0], data[1], data[2]);
  });
  tess.gluTessCallback(libtessJs.gluEnum.GLU_TESS_END, () => {});
  tess.gluTessCallback(libtessJs.gluEnum.GLU_TESS_COMBINE, (coords: number[]) => [coords[0], coords[1], coords[2]]);
  tess.gluTessCallback(libtessJs.gluEnum.GLU_TESS_EDGE_FLAG, () => {});

  tess.gluTessProperty(libtessJs.gluEnum.GLU_TESS_WINDING_RULE, windingRule);
  tess.gluTessNormal(...normal);

  tess.gluTessBeginPolygon(resultVerts);
  for (const contour of contours) {
    tess.gluTessBeginContour();
    for (let j = 0; j < contour.length; j += 3) {
      const coords = [contour[j], contour[j + 1], contour[j + 2]];
      tess.gluTessVertex(coords, coords);
    }
    tess.gluTessEndContour();
  }
  tess.gluTessEndPolygon();

  // Flatten to single array
  return resultVerts.flat();
}

// Canonical form for order-independent triangle comparison
function normalizeTriangles(verts: number[]): string[] {
  const tris: string[] = [];
  for (let i = 0; i < verts.length; i += 9) {
    const v0 = `${verts[i]},${verts[i + 1]},${verts[i + 2]}`;
    const v1 = `${verts[i + 3]},${verts[i + 4]},${verts[i + 5]}`;
    const v2 = `${verts[i + 6]},${verts[i + 7]},${verts[i + 8]}`;
    tris.push([v0, v1, v2].sort().join('|'));
  }
  return tris.sort();
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function totalArea(verts: number[]): number {
  let area = 0;
  for (let i = 0; i < verts.length; i += 9) {
    const ax = verts[i],
      ay = verts[i + 1];
    const bx = verts[i + 3],
      by = verts[i + 4];
    const cx = verts[i + 6],
      cy = verts[i + 7];
    area += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay));
  }
  return area * 0.5;
}

function uniqueVertices(verts: number[]): string[] {
  const set = new Set<string>();
  for (let i = 0; i < verts.length; i += 3) {
    set.add(`${verts[i]},${verts[i + 1]},${verts[i + 2]}`);
  }
  return [...set].sort();
}

describe('Third-party geometry: triangulation matches libtess.js', () => {
  for (const geom of ALL_GEOMETRIES) {
    describe(geom.name, () => {
      for (const rule of WINDING_RULES) {
        it(`winding=${rule.name}`, () => {
          const tsResult = tessellateTS(geom.value, rule.value);
          const jsResult = tessellateJS(geom.value, rule.jsValue);

          // Same triangle count
          expect(tsResult.length).toBe(jsResult.length);

          if (tsResult.length === 0) return;

          // Same triangles (order- and winding-independent)
          const tsTris = normalizeTriangles(tsResult);
          const jsTris = normalizeTriangles(jsResult);

          // renderMonotoneDirect may triangulate monotone regions differently
          // (different valid diagonals), so if exact match fails, verify same
          // total area and vertex set instead.
          if (!arraysEqual(tsTris, jsTris)) {
            const tsArea = totalArea(tsResult);
            const jsArea = totalArea(jsResult);
            const areaDiff = Math.abs(tsArea - jsArea);
            const relDiff = jsArea !== 0 ? areaDiff / Math.abs(jsArea) : areaDiff;
            expect(relDiff).toBeLessThan(1e-10);

            // Same set of unique vertices
            const tsVerts = uniqueVertices(tsResult);
            const jsVerts = uniqueVertices(jsResult);
            expect(tsVerts).toEqual(jsVerts);
          }
        });
      }
    });
  }
});

describe('Third-party geometry: boundary output matches libtess.js', () => {
  for (const geom of ALL_GEOMETRIES) {
    it(`${geom.name} boundary loops`, () => {
      // libtess-ts
      const tess = new GluTesselator();
      const tsLoops: number[][] = [];
      tess.gluTessCallback(GLU_TESS.BEGIN, () => {
        tsLoops.push([]);
      });
      tess.gluTessCallback(GLU_TESS.VERTEX, (data: any) => {
        tsLoops[tsLoops.length - 1].push(data[0], data[1], data[2]);
      });
      tess.gluTessCallback(GLU_TESS.END, () => {});
      tess.gluTessCallback(GLU_TESS.COMBINE, (coords: number[]) => [coords[0], coords[1], coords[2]]);
      tess.gluTessProperty(GLU_TESS.BOUNDARY_ONLY, true); // BOUNDARY_ONLY
      tess.gluTessNormal(0, 0, 1);
      tess.gluTessBeginPolygon();
      for (const c of geom.value) {
        tess.gluTessBeginContour();
        for (let j = 0; j < c.length; j += 3) {
          const coords: [number, number, number] = [c[j], c[j + 1], c[j + 2]];
          tess.gluTessVertex(coords, coords);
        }
        tess.gluTessEndContour();
      }
      tess.gluTessEndPolygon();

      // libtess.js
      const jsT = new libtessJs.GluTesselator();
      const jsLoops: number[][] = [];
      jsT.gluTessCallback(libtessJs.gluEnum.GLU_TESS_BEGIN_DATA, (_t: number, arr: number[][]) => {
        arr.push([]);
      });
      jsT.gluTessCallback(libtessJs.gluEnum.GLU_TESS_VERTEX_DATA, (data: number[], arr: number[][]) => {
        arr[arr.length - 1].push(data[0], data[1], data[2]);
      });
      jsT.gluTessCallback(libtessJs.gluEnum.GLU_TESS_END, () => {});
      jsT.gluTessCallback(libtessJs.gluEnum.GLU_TESS_COMBINE, (coords: number[]) => [coords[0], coords[1], coords[2]]);
      jsT.gluTessCallback(libtessJs.gluEnum.GLU_TESS_EDGE_FLAG, () => {});
      jsT.gluTessProperty(libtessJs.gluEnum.GLU_TESS_BOUNDARY_ONLY, true);
      jsT.gluTessNormal(0, 0, 1);
      jsT.gluTessBeginPolygon(jsLoops);
      for (const c of geom.value) {
        jsT.gluTessBeginContour();
        for (let j = 0; j < c.length; j += 3) {
          const coords = [c[j], c[j + 1], c[j + 2]];
          jsT.gluTessVertex(coords, coords);
        }
        jsT.gluTessEndContour();
      }
      jsT.gluTessEndPolygon();

      // Same number of boundary loops
      expect(tsLoops.length).toBe(jsLoops.length);

      // Sort loops for order-independent comparison and compare
      const sortLoop = (loops: number[][]) => loops.map((l) => l.join(',')).sort();
      expect(sortLoop(tsLoops)).toEqual(sortLoop(jsLoops));
    });
  }
});
