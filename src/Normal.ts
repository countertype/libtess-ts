// Normal vector computation and projection utilities

import { V3 } from './types';
import { Vertex, Mesh, HalfEdge } from './Mesh';

// Compute polygon normal from vertices
export function computeNormal(mesh: Mesh, norm: V3): void {
  const vHead = mesh.vHead;
  let v: Vertex = vHead.next;

  let minVal0 = v.x,
    minVal1 = v.y,
    minVal2 = v.z;
  let maxVal0 = minVal0,
    maxVal1 = minVal1,
    maxVal2 = minVal2;
  let minVert0: Vertex = v,
    minVert1: Vertex = v,
    minVert2: Vertex = v;
  let maxVert0: Vertex = v,
    maxVert1: Vertex = v,
    maxVert2: Vertex = v;

  for (v = vHead.next; v !== vHead; v = v.next) {
    const c0 = v.x,
      c1 = v.y,
      c2 = v.z;
    if (c0 < minVal0) {
      minVal0 = c0;
      minVert0 = v;
    }
    if (c0 > maxVal0) {
      maxVal0 = c0;
      maxVert0 = v;
    }
    if (c1 < minVal1) {
      minVal1 = c1;
      minVert1 = v;
    }
    if (c1 > maxVal1) {
      maxVal1 = c1;
      maxVert1 = v;
    }
    if (c2 < minVal2) {
      minVal2 = c2;
      minVert2 = v;
    }
    if (c2 > maxVal2) {
      maxVal2 = c2;
      maxVert2 = v;
    }
  }

  // Find two vertices separated by at least 1/sqrt(3) of the maximum
  // distance between any two vertices
  let bestAxis = 0;
  let bestSpan = maxVal0 - minVal0;
  const span1 = maxVal1 - minVal1;
  const span2 = maxVal2 - minVal2;
  if (span1 > bestSpan) {
    bestAxis = 1;
    bestSpan = span1;
  }
  if (span2 > bestSpan) {
    bestAxis = 2;
  }

  let v1: Vertex, v2: Vertex;
  if (bestAxis === 0) {
    if (minVal0 >= maxVal0) {
      norm[0] = 0;
      norm[1] = 0;
      norm[2] = 1;
      return;
    }
    v1 = minVert0;
    v2 = maxVert0;
  } else if (bestAxis === 1) {
    if (minVal1 >= maxVal1) {
      norm[0] = 0;
      norm[1] = 0;
      norm[2] = 1;
      return;
    }
    v1 = minVert1;
    v2 = maxVert1;
  } else {
    if (minVal2 >= maxVal2) {
      norm[0] = 0;
      norm[1] = 0;
      norm[2] = 1;
      return;
    }
    v1 = minVert2;
    v2 = maxVert2;
  }

  // Find the third vertex that maximizes triangle area
  // (length of cross product == twice the triangle area)
  const d1x = v1.x - v2.x;
  const d1y = v1.y - v2.y;
  const d1z = v1.z - v2.z;
  let maxLen2 = 0;

  for (v = vHead.next; v !== vHead; v = v.next) {
    const d2x = v.x - v2.x;
    const d2y = v.y - v2.y;
    const d2z = v.z - v2.z;

    const tnx = d1y * d2z - d1z * d2y;
    const tny = d1z * d2x - d1x * d2z;
    const tnz = d1x * d2y - d1y * d2x;
    const tLen2 = tnx * tnx + tny * tny + tnz * tnz;

    if (tLen2 > maxLen2) {
      maxLen2 = tLen2;
      norm[0] = tnx;
      norm[1] = tny;
      norm[2] = tnz;
    }
  }

  if (maxLen2 <= 0) {
    // All points collinear -- pick any perpendicular
    norm[0] = norm[1] = norm[2] = 0;
    if (Math.abs(d1y) > Math.abs(d1x)) {
      norm[Math.abs(d1z) > Math.abs(d1y) ? 2 : 1] = 1;
    } else {
      norm[Math.abs(d1z) > Math.abs(d1x) ? 2 : 0] = 1;
    }
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
