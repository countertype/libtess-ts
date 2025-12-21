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

// Normal.ts - Normal vector computation
// Based on libtess (SGI OpenGL) normal.c/h by Eric Veach (1994)

import { V3 } from "./types";
import { Vertex, Face, Mesh } from "./Mesh";
import { HalfEdge } from "./Mesh";

// Compute polygon normal from vertices
export function computeNormal(mesh: Mesh, norm: V3): void {
    let v: Vertex, v1: Vertex, v2: Vertex;
    let c, tLen2, maxLen2;
    let maxVal: V3 = [0, 0, 0],
      minVal: V3 = [0, 0, 0],
      d1: V3 = [0, 0, 0],
      d2: V3 = [0, 0, 0],
      tNorm: V3 = [0, 0, 0];

    const maxVert: Array<Vertex | null> = [null, null, null],
      minVert: Array<Vertex | null> = [null, null, null];
    const vHead = mesh.vHead;

    v = vHead.next;
    for (let i = 0; i < 3; ++i) {
      c = v.coords[i];
      minVal[i] = c;
      minVert[i] = v;
      maxVal[i] = c;
      maxVert[i] = v;
    }

    for (v = vHead.next; v !== vHead; v = v.next) {
      for (let i = 0; i < 3; ++i) {
        c = v.coords[i];

        if (c < minVal[i]) {
          minVal[i] = c;
          minVert[i] = v;
        }

        if (c > maxVal[i]) {
          maxVal[i] = c;
          maxVert[i] = v;
        }
      }
    }

    // Find two vertices separated by at least 1/sqrt(3) of the maximum
    // distance between any two vertices
    let i = 0;
    if (maxVal[1] - minVal[1] > maxVal[0] - minVal[0]) {
      i = 1;
    }

    if (maxVal[2] - minVal[2] > maxVal[i] - minVal[i]) {
      i = 2;
    }

    if (minVal[i] >= maxVal[i]) {
      // All vertices are the same -- normal doesn't matter
      norm[0] = 0;
      norm[1] = 0;
      norm[2] = 1;
      return;
    }

    // Look for a third vertex which forms the triangle with maximum area
    // (Length of normal == twice the triangle area)
    maxLen2 = 0;
    v1 = minVert[i]!;
    v2 = maxVert[i]!;
    d1[0] = v1.coords[0] - v2.coords[0];
    d1[1] = v1.coords[1] - v2.coords[1];
    d1[2] = v1.coords[2] - v2.coords[2];

    for (v = vHead.next; v !== vHead; v = v.next) {
      d2[0] = v.coords[0] - v2.coords[0];
      d2[1] = v.coords[1] - v2.coords[1];
      d2[2] = v.coords[2] - v2.coords[2];

      tNorm[0] = d1[1] * d2[2] - d1[2] * d2[1];
      tNorm[1] = d1[2] * d2[0] - d1[0] * d2[2];
      tNorm[2] = d1[0] * d2[1] - d1[1] * d2[0];
      tLen2 = tNorm[0] * tNorm[0] + tNorm[1] * tNorm[1] + tNorm[2] * tNorm[2];

      if (tLen2 > maxLen2) {
        maxLen2 = tLen2;
        norm[0] = tNorm[0];
        norm[1] = tNorm[1];
        norm[2] = tNorm[2];
      }
    }

    if (maxLen2 <= 0) {
      // All points lie on a single line -- any decent normal will do
      norm[0] = norm[1] = norm[2] = 0;
      norm[longAxis(d1)] = 1;
    }
  }

// Check and fix polygon orientation
export function checkOrientation(mesh: Mesh, tUnit: V3): void {
    let f,
      fHead = mesh.fHead;
    let v,
      vHead = mesh.vHead;
    let e: HalfEdge;
    let area = 0;

    for (f = fHead.next; f !== fHead; f = f.next) {
      e = f.anEdge;
      if (e.winding <= 0) continue;

      do {
        area += (e.Org.s - e.Sym.Org.s) * (e.Org.t + e.Sym.Org.t);
        e = e.Lnext;
      } while (e !== f.anEdge);
    }

    if (area < 0) {
      // Reverse orientation
      for (v = vHead.next; v !== vHead; v = v.next) {
        v.t = -v.t;
      }
      tUnit[0] = -tUnit[0];
      tUnit[1] = -tUnit[1];
      tUnit[2] = -tUnit[2];
    }
  }

export function longAxis(v: V3): number {
    let i = 0;

    if (Math.abs(v[1]) > Math.abs(v[0])) {
      i = 1;
    }

    if (Math.abs(v[2]) > Math.abs(v[i])) {
      i = 2;
    }

    return i;
  }

export function normalize(v: V3): void {
    let len = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];

    if (!len) {
      throw new Error("Cannot normalize zero-length vector");
    }

    len = Math.sqrt(len);

    v[0] /= len;
    v[1] /= len;
    v[2] /= len;
  }

export function dot(u: V3, v: V3): number {
  return u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
}
