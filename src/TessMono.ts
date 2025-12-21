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

// Tessmono.ts - Monotone region tessellation
// Based on libtess (SGI OpenGL) tessmono.c/h by Eric Veach (1994)

import { Mesh, Face, HalfEdge } from "./Mesh";
import { Geom } from "./Geom";

// Tessellate monotone regions into triangles
export class TessMono {
  static addWinding(eDst: HalfEdge, eSrc: HalfEdge): void {
    eDst.winding += eSrc.winding;
    eDst.Sym.winding += eSrc.Sym.winding;
  }

  // Tessellate a monotone region into triangles
  //
  // The region must consist of a single loop of half-edges oriented CCW.
  // "Monotone" means that any vertical line intersects the interior of the
  // region in a single interval.
  //
  // Tessellation consists of adding interior edges (pairs of half-edges),
  // to split the region into non-overlapping triangles.
  //
  // The basic idea is explained in Preparata and Shamos. There are two edge
  // chains, an upper chain and a lower chain. We process all vertices from
  // both chains in order, from right to left.
  //
  // The algorithm ensures that the following invariant holds after each
  // vertex is processed: the untessellated region consists of two chains,
  // where one chain (say the upper) is a single edge, and the other chain
  // is concave. The left vertex of the single edge is always to the left
  // of all vertices in the concave chain.
  //
  // Each step consists of adding the rightmost unprocessed vertex to one
  // of the two chains, and forming a fan of triangles from the rightmost
  // of two chain endpoints. Determining whether we can add each triangle
  // to the fan is a simple orientation test. By making the fan as large
  // as possible, we restore the invariant (check it yourself).
  static tessellateMonoRegion(mesh: Mesh, face: Face): boolean {
    let up: HalfEdge, lo: HalfEdge;

    // All edges are oriented CCW around the boundary of the region.
    // First, find the half-edge whose origin vertex is rightmost.
    // Since the sweep goes from left to right, face->anEdge should
    // be close to the edge we want.
    up = face.anEdge;
    if (!(up.Lnext !== up && up.Lnext.Lnext !== up)) {
      throw new Error("Monotone region has degenerate topology");
    }

    // Inline vertLeq for hot loop
    for (; Geom.vertLeq(up.Sym.Org, up.Org); up = up.Onext.Sym);
    for (; Geom.vertLeq(up.Org, up.Sym.Org); up = up.Lnext);

    lo = up.Onext.Sym;

    let tempHalfEdge!: HalfEdge;

    while (up.Lnext !== lo) {
      // Inline vertLeq
      if (Geom.vertLeq(up.Sym.Org, lo.Org)) {
        // up->Dst is on the left.  It is safe to form triangles from lo->Org.
        // The EdgeGoesLeft test guarantees progress even when some triangles
        // are CW, given that the upper and lower chains are truly monotone.
        while (
          lo.Lnext !== up &&
          (Geom.edgeGoesLeft(lo.Lnext) ||
            Geom.edgeSign(lo.Org, lo.Sym.Org, lo.Lnext.Sym.Org) <= 0.0)
        ) {
          tempHalfEdge = mesh.connect(lo.Lnext, lo);
          lo = tempHalfEdge.Sym;
        }
        lo = lo.Onext.Sym;
      } else {
        // lo->Org is on the left.  We can make CCW triangles from up->Dst.
        while (
          lo.Lnext !== up &&
          (Geom.edgeGoesRight(up.Onext.Sym) ||
            Geom.edgeSign(up.Sym.Org, up.Org, up.Onext.Sym.Org) >= 0.0)
        ) {
          tempHalfEdge = mesh.connect(up, up.Onext.Sym);
          up = tempHalfEdge.Sym;
        }
        up = up.Lnext;
      }
    }

    // Now lo->Org == up->Dst == the leftmost vertex.  The remaining region
    // can be tessellated in a fan from this leftmost vertex.

    if (lo.Lnext === up) {
      throw new Error("Monotone region has insufficient vertices");
    }

    while (lo.Lnext.Lnext !== up) {
      tempHalfEdge = mesh.connect(lo.Lnext, lo);
      lo = tempHalfEdge.Sym;
    }

    return true;
  }

  // Tessellate all interior regions (must be monotone)
  static tessellateInterior(mesh: Mesh): boolean {
    let next: Face;

    for (let f = mesh.fHead.next; f !== mesh.fHead; f = next) {
      // Make sure we don't try to tessellate the new triangles.
      next = f!.next!;

      if (f!.inside) {
        if (!TessMono.tessellateMonoRegion(mesh, f!)) {
          return false;
        }
      }
    }

    return true;
  }
}
