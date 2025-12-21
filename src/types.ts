/*
 * Copyright 2000, Silicon Graphics, Inc. All Rights Reserved.
 * Copyright 2025, Countertype LLC. All Rights Reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice including the dates of first publication and
 * either this permission notice or a reference to http://oss.sgi.com/projects/FreeB/
 * shall be included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * SILICON GRAPHICS, INC. BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 * WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
 * IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * Original Code. The Original Code is: OpenGL Sample Implementation,
 * Version 1.2.1, released January 26, 2000, developed by Silicon Graphics,
 * Inc. The Original Code is Copyright (c) 1991-2000 Silicon Graphics, Inc.
 * Copyright in any portions created by third parties is as indicated
 * elsewhere herein. All Rights Reserved.
 */

// Type aliases
export type V3 = [number, number, number | 0];
export type V2 = [number, number];

// Combine callback for vertex attribute interpolation at intersections
export type CombineCallback = (
  coords: [number, number, number],
  data: [unknown, unknown, unknown, unknown],
  weights: [number, number, number, number]
) => unknown;

// Enums (const = fully inlined, no runtime object)
export const enum WINDING {
  ODD = 0,
  NONZERO = 1,
  POSITIVE = 2,
  NEGATIVE = 3,
  ABS_GEQ_TWO = 4,
}

export const enum ELEMENT {
  POLYGONS = 0,
  CONNECTED_POLYGONS = 1,
  BOUNDARY_CONTOURS = 2,
}

// OpenGL callback types (for gluTessCallback)
export enum GLU_TESS {
  BEGIN = 100100,
  EDGE_FLAG = 100104,
  VERTEX = 100101,
  END = 100102,
  ERROR = 100103,
  COMBINE = 100105,
  BEGIN_DATA = 100106,
  EDGE_FLAG_DATA = 100110,
  VERTEX_DATA = 100107,
  END_DATA = 100108,
  ERROR_DATA = 100109,
  COMBINE_DATA = 100111,
}

// OpenGL primitive types
export const GL_TRIANGLES = 4;
export const GL_TRIANGLE_FAN = 6;
export const GL_TRIANGLE_STRIP = 5;
export const GL_LINE_LOOP = 2;
