// Test cases from SGI OpenGL Red Book (2nd Edition)
// Source: tess.c and tesswind.c by Eric Veach, SGI, 1994
// License: SGI Free Software License B
export interface TestCase {
  name: string;
  contours: number[][];
  vertexSize: number;
  description: string;
  expected?: {
    triangles?: number;
    vertices?: number;
  };
}

export const REDBOOK_TESTS: TestCase[] = [
  {
    name: 'rectangleWithTriangularHole',
    description: 'Rectangle with triangular hole inside (tess.c)',
    vertexSize: 3,
    contours: [
      // Outer rectangle
      [50.0, 50.0, 0.0, 200.0, 50.0, 0.0, 200.0, 200.0, 0.0, 50.0, 200.0, 0.0],
      // Inner triangle (hole)
      [75.0, 75.0, 0.0, 125.0, 175.0, 0.0, 175.0, 75.0, 0.0]
    ],
    expected: {
      triangles: 7 // From libtess README performance table
    }
  },

  {
    name: 'selfIntersectingStar',
    description: 'Self-intersecting 5-point star (tess.c) - CLASSIC TEST',
    vertexSize: 3,
    contours: [[250.0, 50.0, 0.0, 325.0, 200.0, 0.0, 400.0, 50.0, 0.0, 250.0, 150.0, 0.0, 400.0, 150.0, 0.0]],
    expected: {
      triangles: 5 // From libtess README line 442
    }
  },

  {
    name: 'nestedRectangles',
    description: 'Three nested rectangles (tesswind.c)',
    vertexSize: 3,
    contours: [
      [50.0, 50.0, 0.0, 300.0, 50.0, 0.0, 300.0, 300.0, 0.0, 50.0, 300.0, 0.0],
      [100.0, 100.0, 0.0, 250.0, 100.0, 0.0, 250.0, 250.0, 0.0, 100.0, 250.0, 0.0],
      [150.0, 150.0, 0.0, 200.0, 150.0, 0.0, 200.0, 200.0, 0.0, 150.0, 200.0, 0.0]
    ]
  },

  {
    name: 'spiral',
    description: 'Self-intersecting spiral (tesswind.c)',
    vertexSize: 3,
    contours: [
      [
        400.0, 250.0, 0.0, 400.0, 50.0, 0.0, 50.0, 50.0, 0.0, 50.0, 400.0, 0.0, 350.0, 400.0, 0.0, 350.0, 100.0, 0.0,
        100.0, 100.0, 0.0, 100.0, 350.0, 0.0, 300.0, 350.0, 0.0, 300.0, 150.0, 0.0, 150.0, 150.0, 0.0, 150.0, 300.0,
        0.0, 250.0, 300.0, 0.0, 250.0, 200.0, 0.0, 200.0, 200.0, 0.0, 200.0, 250.0, 0.0
      ]
    ]
  },

  {
    name: 'overlappingQuads',
    description: 'Two overlapping quadrilaterals (tesswind.c)',
    vertexSize: 3,
    contours: [
      [50.0, 150.0, 0.0, 350.0, 150.0, 0.0, 350.0, 200.0, 0.0, 50.0, 200.0, 0.0],
      [100.0, 100.0, 0.0, 300.0, 100.0, 0.0, 300.0, 350.0, 0.0, 100.0, 350.0, 0.0]
    ]
  },

  {
    name: 'overlappingQuadsWithTriangle',
    description: 'Two overlapping quads plus triangle (tesswind.c)',
    vertexSize: 3,
    contours: [
      [50.0, 150.0, 0.0, 350.0, 150.0, 0.0, 350.0, 200.0, 0.0, 50.0, 200.0, 0.0],
      [100.0, 100.0, 0.0, 300.0, 100.0, 0.0, 300.0, 350.0, 0.0, 100.0, 350.0, 0.0],
      [200.0, 50.0, 0.0, 250.0, 300.0, 0.0, 150.0, 300.0, 0.0]
    ]
  }
];

export const BASIC_TESTS: TestCase[] = [
  {
    name: 'triangle',
    description: 'Simple triangle (identity operation)',
    vertexSize: 2,
    contours: [[0, 0, 1, 0, 0.5, 1]],
    expected: {
      triangles: 1,
      vertices: 3
    }
  },

  {
    name: 'square',
    description: 'Simple square (2 triangles)',
    vertexSize: 2,
    contours: [[0, 0, 1, 0, 1, 1, 0, 1]],
    expected: {
      triangles: 2,
      vertices: 4
    }
  },

  {
    name: 'bowtie',
    description: 'Self-intersecting bowtie (libtess README line 441)',
    vertexSize: 3,
    contours: [[0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 1, 0]],
    expected: {
      triangles: 2
    }
  }
];
