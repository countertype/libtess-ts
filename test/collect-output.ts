import { GluTesselator, GLU_TESS } from '../src';

export interface CollectedOutput {
  vertices: [number, number][] | [number, number, number][];
  triangles: number[][];
  elementCount: number;
  vertexCount: number;
}

export function tessellateAndCollect(
  tess: GluTesselator,
  contours: number[][],
  vertexSize: 2 | 3 = 2
): CollectedOutput {
  const vertices: any[] = [];
  const triangles: number[][] = [];
  let currentIndices: number[] = [];
  let vertexMap = new Map<any, number>();

  // Set callbacks to collect output
  tess.gluTessCallback(GLU_TESS.BEGIN, (type: number) => {
    // BEGIN - called once for GL_TRIANGLES
    currentIndices = [];
  });

  tess.gluTessCallback(GLU_TESS.VERTEX, (data: any) => {
    // VERTEX - collect indices, group into triangles of 3
    let idx = vertexMap.get(data);
    if (idx === undefined) {
      idx = vertices.length;
      vertices.push(data);
      vertexMap.set(data, idx);
    }
    currentIndices.push(idx);

    // Every 3 vertices = 1 triangle
    if (currentIndices.length % 3 === 0 && currentIndices.length > 0) {
      const triStart = currentIndices.length - 3;
      triangles.push([currentIndices[triStart], currentIndices[triStart + 1], currentIndices[triStart + 2]]);
    }
  });

  tess.gluTessCallback(GLU_TESS.END, () => {
    // END
  });

  tess.gluTessCallback(GLU_TESS.COMBINE, (coords: number[], data: any[], weight: number[]) => {
    // COMBINE - needed for self-intersecting polygons
    return vertexSize === 2 ? [coords[0], coords[1]] : [coords[0], coords[1], coords[2]];
  });

  // Tessellate
  tess.gluTessBeginPolygon();
  for (const contour of contours) {
    tess.gluTessBeginContour();
    for (let i = 0; i < contour.length; i += vertexSize) {
      const coords: [number, number] | [number, number, number] =
        vertexSize === 2 ? [contour[i], contour[i + 1]] : [contour[i], contour[i + 1], contour[i + 2]];
      tess.gluTessVertex(coords, coords); // Use coords as data
    }
    tess.gluTessEndContour();
  }
  tess.gluTessEndPolygon();

  return {
    vertices: vertices as any,
    triangles,
    elementCount: triangles.length,
    vertexCount: vertices.length
  };
}
