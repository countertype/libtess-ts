import { describe, it, expect } from 'vitest';
import { GluTesselator, GLU_TESS } from '../src';

describe('Combine Callback', () => {
  it('calls combine callback on self-intersecting contour', () => {
    const tess = new GluTesselator();

    // Bowtie: two edges cross at (1,1)
    const coords: [number, number][] = [
      [0, 0],
      [2, 2],
      [2, 0],
      [0, 2]
    ];

    let combineCalled = false;
    let combineCoords: number[] = [];
    tess.gluTessCallback(GLU_TESS.COMBINE, (c: any) => {
      combineCalled = true;
      combineCoords = [c[0], c[1]];
      return { interpolated: true };
    });

    const vertices: unknown[] = [];
    tess.gluTessCallback(GLU_TESS.VERTEX, (d: unknown) => vertices.push(d));

    tess.gluTessBeginPolygon();
    tess.gluTessBeginContour();
    for (const c of coords) {
      tess.gluTessVertex(c, c);
    }
    tess.gluTessEndContour();
    tess.gluTessEndPolygon();

    expect(combineCalled).toBe(true);
    expect(combineCoords[0]).toBeCloseTo(1, 5);
    expect(combineCoords[1]).toBeCloseTo(1, 5);
    expect(vertices.length).toBeGreaterThan(0);
    expect(vertices.length % 3).toBe(0);
  });

  it('interpolates vertex data via weights', () => {
    const tess = new GluTesselator();

    const contour: [number, number][] = [
      [0, 0],
      [2, 2],
      [2, 0],
      [0, 2]
    ];
    const colors = [
      { r: 1.0, g: 0.0, b: 0.0 },
      { r: 0.0, g: 1.0, b: 0.0 },
      { r: 0.0, g: 0.0, b: 1.0 },
      { r: 1.0, g: 1.0, b: 0.0 }
    ];

    let interpolatedColor: { r: number; g: number; b: number } | null = null;
    tess.gluTessCallback(GLU_TESS.COMBINE, (coords: any, data: any, weights: any) => {
      let r = 0,
        g = 0,
        b = 0;
      for (let i = 0; i < 4; i++) {
        if (data[i] && typeof data[i] === 'object') {
          const color = data[i] as { r: number; g: number; b: number };
          r += color.r * weights[i];
          g += color.g * weights[i];
          b += color.b * weights[i];
        }
      }
      interpolatedColor = { r, g, b };
      return interpolatedColor;
    });

    tess.gluTessBeginPolygon();
    tess.gluTessBeginContour();
    for (let i = 0; i < contour.length; i++) {
      tess.gluTessVertex(contour[i], colors[i]);
    }
    tess.gluTessEndContour();
    tess.gluTessEndPolygon();

    expect(interpolatedColor).not.toBeNull();
    // Weights sum to 1.0, so each channel should be in [0, 1]
    expect(interpolatedColor!.r).toBeGreaterThanOrEqual(0);
    expect(interpolatedColor!.r).toBeLessThanOrEqual(1);
    expect(interpolatedColor!.g).toBeGreaterThanOrEqual(0);
    expect(interpolatedColor!.g).toBeLessThanOrEqual(1);
  });

  it('fires error callback without combine on self-intersection', () => {
    const tess = new GluTesselator();
    const contour: [number, number][] = [
      [0, 0],
      [2, 2],
      [2, 0],
      [0, 2]
    ];

    let errorFired = false;
    tess.gluTessCallback(GLU_TESS.ERROR, () => {
      errorFired = true;
    });

    tess.gluTessBeginPolygon();
    tess.gluTessBeginContour();
    for (const c of contour) {
      tess.gluTessVertex(c, c);
    }
    tess.gluTessEndContour();
    tess.gluTessEndPolygon();

    // Without a combine callback, self-intersection triggers NEED_COMBINE error
    expect(errorFired).toBe(true);
  });

  it('handles polygon with hole (no intersections, no combine needed)', () => {
    const tess = new GluTesselator();
    let combineCallCount = 0;

    tess.gluTessCallback(GLU_TESS.COMBINE, () => {
      combineCallCount++;
      return {};
    });

    const vertices: unknown[] = [];
    tess.gluTessCallback(GLU_TESS.VERTEX, (d: unknown) => vertices.push(d));

    const outer: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4]
    ];
    const inner: [number, number][] = [
      [1, 1],
      [3, 1],
      [3, 3],
      [1, 3]
    ];

    tess.gluTessBeginPolygon();
    tess.gluTessBeginContour();
    for (const pt of outer) tess.gluTessVertex(pt, pt);
    tess.gluTessEndContour();
    tess.gluTessBeginContour();
    for (const pt of inner) tess.gluTessVertex(pt, pt);
    tess.gluTessEndContour();
    tess.gluTessEndPolygon();

    // No intersections, so combine should not fire
    expect(combineCallCount).toBe(0);
    expect(vertices.length).toBeGreaterThan(0);
    expect(vertices.length % 3).toBe(0);
  });

  it('handles 3D self-intersecting contour', () => {
    const tess = new GluTesselator();
    const contour: [number, number, number][] = [
      [0, 0, 0],
      [2, 2, 1],
      [2, 0, 0],
      [0, 2, 1]
    ];

    let combineCalled = false;
    tess.gluTessCallback(GLU_TESS.COMBINE, (coords: any, data: any, weights: any) => {
      combineCalled = true;
      let u = 0,
        v = 0;
      for (let i = 0; i < 4; i++) {
        if (data[i] && data[i].uv) {
          u += data[i].uv[0] * weights[i];
          v += data[i].uv[1] * weights[i];
        }
      }
      return { uv: [u, v] };
    });

    const vertexData = [{ uv: [0, 0] }, { uv: [1, 1] }, { uv: [1, 0] }, { uv: [0, 1] }];

    const vertices: unknown[] = [];
    tess.gluTessCallback(GLU_TESS.VERTEX, (d: unknown) => vertices.push(d));

    tess.gluTessBeginPolygon();
    tess.gluTessBeginContour();
    for (let i = 0; i < contour.length; i++) {
      tess.gluTessVertex(contour[i], vertexData[i]);
    }
    tess.gluTessEndContour();
    tess.gluTessEndPolygon();

    expect(combineCalled).toBe(true);
    expect(vertices.length).toBeGreaterThan(0);
  });
});
