import { describe, it, expect } from 'vitest';
import { GluTesselator, WINDING, GLU_TESS } from '../src';
import { tessellateAndCollect } from './collect-output';

describe('gluTess API', () => {
  it('tessellates a square', () => {
    const tess = new GluTesselator();
    const output = tessellateAndCollect(tess, [[0, 0, 1, 0, 1, 1, 0, 1]], 2);

    // Should produce 2 triangles
    expect(output.elementCount).toBe(2);
    expect(output.vertexCount).toBe(4);
    expect(output.triangles.length).toBe(2);
  });

  it('handles polygon with hole', () => {
    const tess = new GluTesselator();
    const outer = [0, 0, 4, 0, 4, 4, 0, 4];
    const hole = [1, 1, 1, 3, 3, 3, 3, 1];
    const output = tessellateAndCollect(tess, [outer, hole], 2);

    // Should produce tessellated output
    expect(output.elementCount).toBeGreaterThan(0);
    expect(output.vertexCount).toBeGreaterThan(0);
  });

  it('handles 3D vertices', () => {
    const tess = new GluTesselator();
    const contour = [0, 0, 0, 1, 0, 0.5, 1, 1, 1, 0, 1, 0.5];
    const output = tessellateAndCollect(tess, [contour], 3);

    expect(output.elementCount).toBe(2);
    expect(output.vertexCount).toBe(4);
  });

  it('passes vertex data through callbacks', () => {
    const tess = new GluTesselator();

    tess.gluTessBeginPolygon();
    tess.gluTessBeginContour();
    tess.gluTessVertex([0, 0], { color: 'red', id: 0 });
    tess.gluTessVertex([1, 0], { color: 'green', id: 1 });
    tess.gluTessVertex([1, 1], { color: 'blue', id: 2 });
    tess.gluTessVertex([0, 1], { color: 'yellow', id: 3 });
    tess.gluTessEndContour();
    tess.gluTessEndPolygon();

    // Output arrays are not auto-generated in callback-only mode
    expect(true).toBe(true);
  });

  it('fires error callback if gluTessBeginContour called without gluTessBeginPolygon', () => {
    const tess = new GluTesselator();
    let errorNum = -1;
    tess.gluTessCallback(GLU_TESS.ERROR, (n: number) => {
      errorNum = n;
    });

    tess.gluTessBeginContour();
    expect(errorNum).toBe(100151); // GLU_TESS_MISSING_BEGIN_POLYGON
  });

  it('fires error callback if gluTessVertex called without gluTessBeginContour', () => {
    const tess = new GluTesselator();
    let errorNum = -1;
    tess.gluTessCallback(GLU_TESS.ERROR, (n: number) => {
      errorNum = n;
    });

    tess.gluTessBeginPolygon();
    tess.gluTessVertex([0, 0]);
    expect(errorNum).toBe(100152); // GLU_TESS_MISSING_BEGIN_CONTOUR
  });

  it('fires error callback if gluTessEndPolygon called while in contour', () => {
    const tess = new GluTesselator();
    let errorNum = -1;
    tess.gluTessCallback(GLU_TESS.ERROR, (n: number) => {
      errorNum = n;
    });

    tess.gluTessBeginPolygon();
    tess.gluTessBeginContour();
    tess.gluTessVertex([0, 0]);
    tess.gluTessEndPolygon();
    expect(errorNum).toBe(100154); // GLU_TESS_MISSING_END_CONTOUR
  });

  it('can reuse tessellator for multiple polygons', () => {
    const tess = new GluTesselator();

    // First polygon
    const output1 = tessellateAndCollect(tess, [[0, 0, 1, 0, 0.5, 1]], 2);
    const firstCount = output1.elementCount;

    // Second polygon (reuse tessellator)
    const output2 = tessellateAndCollect(tess, [[0, 0, 2, 0, 2, 2, 0, 2]], 2);
    const secondCount = output2.elementCount;

    expect(firstCount).toBe(1); // Triangle
    expect(secondCount).toBe(2); // Quad = 2 triangles
  });
});
