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

import { assert } from "./Assert";
import { Vertex, HalfEdge } from "./Mesh";

export class Geom {
  static vertEq(u: Vertex, v: Vertex) {
    return u.s === v.s && u.t === v.t;
  }

  // Returns TRUE if u is lexicographically <= v.
  static vertLeq(u: Vertex, v: Vertex) {
    return u.s < v.s || (u.s === v.s && u.t <= v.t);
  }

  // Versions of VertLeq, EdgeSign, EdgeEval with s and t transposed.
  static transLeq(u: Vertex, v: Vertex) {
    return u.t < v.t || (u.t === v.t && u.s <= v.s);
  }

  static edgeGoesLeft(e: HalfEdge) {
    return Geom.vertLeq(e.Sym.Org, e.Org);
  }

  static edgeGoesRight(e: HalfEdge) {
    return Geom.vertLeq(e.Org, e.Sym.Org);
  }

  static vertL1dist(u: Vertex, v: Vertex) {
    return Math.abs(u.s - v.s) + Math.abs(u.t - v.t);
  }

  // number tesedgeEval( Vertex *u, Vertex *v, Vertex *w )
  static edgeEval(u: Vertex, v: Vertex, w: Vertex) {
    // Given three vertices u,v,w such that VertLeq(u,v) && VertLeq(v,w),
    // evaluates the t-coord of the edge uw at the s-coord of the vertex v.
    // Returns v.t - (uw)(v.s), ie. the signed distance from uw to v.
    // If uw is vertical (and thus passes thru v), the result is zero.
    //
    // The calculation is extremely accurate and stable, even when v
    // is very close to u or w.  In particular if we set v.t = 0 and
    // let r be the negated result (this evaluates (uw)(v.s)), then
    // r is guaranteed to satisfy MIN(u.t,w.t) <= r <= MAX(u.t,w.t).

    let gapL = v.s - u.s;
    let gapR = w.s - v.s;

    if (gapL + gapR > 0.0) {
      if (gapL < gapR) {
        return v.t - u.t + (u.t - w.t) * (gapL / (gapL + gapR));
      } else {
        return v.t - w.t + (w.t - u.t) * (gapR / (gapL + gapR));
      }
    }
    // vertical line
    return 0.0;
  }

  // number tesedgeSign( Vertex *u, Vertex *v, Vertex *w )
  static edgeSign(u: Vertex, v: Vertex, w: Vertex) {
    // Returns a number whose sign matches EdgeEval(u,v,w) but which
    // is cheaper to evaluate.  Returns > 0, == 0 , or < 0
    // as v is above, on, or below the edge uw.

    let gapL = v.s - u.s;
    let gapR = w.s - v.s;

    if (gapL + gapR > 0.0) {
      return (v.t - w.t) * gapL + (v.t - u.t) * gapR;
    }
    // vertical line
    return 0.0;
  }

  // Versions of EdgeSign, EdgeEval with s and t transposed

  // number testransEval( Vertex *u, Vertex *v, Vertex *w )
  static transEval(u: Vertex, v: Vertex, w: Vertex) {
    // Given three vertices u,v,w such that TransLeq(u,v) && TransLeq(v,w),
    // evaluates the t-coord of the edge uw at the s-coord of the vertex v.
    // Returns v.s - (uw)(v.t), ie. the signed distance from uw to v.
    // If uw is vertical (and thus passes thru v), the result is zero.
    //
    // The calculation is extremely accurate and stable, even when v
    // is very close to u or w.  In particular if we set v.s = 0 and
    // let r be the negated result (this evaluates (uw)(v.t)), then
    // r is guaranteed to satisfy MIN(u.s,w.s) <= r <= MAX(u.s,w.s).

    let gapL = v.t - u.t;
    let gapR = w.t - v.t;

    if (gapL + gapR > 0.0) {
      if (gapL < gapR) {
        return v.s - u.s + (u.s - w.s) * (gapL / (gapL + gapR));
      } else {
        return v.s - w.s + (w.s - u.s) * (gapR / (gapL + gapR));
      }
    }
    // vertical line
    return 0.0;
  }

  // number testransSign( Vertex *u, Vertex *v, Vertex *w )
  static transSign(u: Vertex, v: Vertex, w: Vertex) {
    // Returns a number whose sign matches TransEval(u,v,w) but which
    // is cheaper to evaluate.  Returns > 0, == 0 , or < 0
    // as v is above, on, or below the edge uw.

    let gapL = v.t - u.t;
    let gapR = w.t - v.t;

    if (gapL + gapR > 0.0) {
      return (v.s - w.s) * gapL + (v.s - u.s) * gapR;
    }
    // vertical line
    return 0.0;
  }

  // int tesvertCCW( Vertex *u, Vertex *v, Vertex *w )
  static vertCCW(u: Vertex, v: Vertex, w: Vertex) {
    // For almost-degenerate situations, the results are not reliable.
    // Unless the floating-point arithmetic can be performed without
    // rounding errors, *any* implementation will give incorrect results
    // on some degenerate inputs, so the client must have some way to
    // handle this situation.
    return u.s * (v.t - w.t) + v.s * (w.t - u.t) + w.s * (u.t - v.t) >= 0.0;
  }

  // Given parameters a,x,b,y returns the value (b*x+a*y)/(a+b),
  // or (x+y)/2 if a==b==0.  It requires that a,b >= 0, and enforces
  // this in the rare case that one argument is slightly negative.
  // The implementation is extremely stable numerically.
  // In particular it guarantees that the result r satisfies
  // MIN(x,y) <= r <= MAX(x,y), and the results are very accurate
  // even when a and b differ greatly in magnitude.
  static interpolate(a: number, x: number, b: number, y: number) {
    return (
      (a = a < 0 ? 0 : a),
      (b = b < 0 ? 0 : b),
      a <= b
        ? b === 0
          ? (x + y) / 2
          : x + (y - x) * (a / (a + b))
        : y + (x - y) * (b / (a + b))
    );
  }

  // Original C implementation had a FOR_TRITE_TEST_PROGRAM mode for testing.
  // Claim: the ONLY property the sweep algorithm relies on is that
  // MIN(x,y) <= r <= MAX(x,y).  This is a nasty way to test that.
  // Not needed in TypeScript implementation.

  static intersect(o1: Vertex, d1: Vertex, o2: Vertex, d2: Vertex, v: Vertex) {
    // Given edges (o1,d1) and (o2,d2), compute their point of intersection.
    // The computed point is guaranteed to lie in the intersection of the
    // bounding rectangles defined by each edge.
    let z1, z2;
    let t;

    // This is certainly not the most efficient way to find the intersection
    // of two line segments, but it is very numerically stable.
    //
    // Strategy: find the two middle vertices in the VertLeq ordering,
    // and interpolate the intersection s-value from these.  Then repeat
    // using the TransLeq ordering to find the intersection t-value.

    if (!Geom.vertLeq(o1, d1)) {
      t = o1;
      o1 = d1;
      d1 = t;
    } //swap( o1, d1 ); }
    if (!Geom.vertLeq(o2, d2)) {
      t = o2;
      o2 = d2;
      d2 = t;
    } //swap( o2, d2 ); }
    if (!Geom.vertLeq(o1, o2)) {
      t = o1;
      o1 = o2;
      o2 = t;
      t = d1;
      d1 = d2;
      d2 = t;
    } //swap( o1, o2 ); swap( d1, d2 ); }

    if (!Geom.vertLeq(o2, d1)) {
      // Technically, no intersection -- do our best
      v.s = (o2.s + d1.s) * 0.5;
    } else if (Geom.vertLeq(d1, d2)) {
      // Interpolate between o2 and d1
      z1 = Geom.edgeEval(o1, o2, d1);
      z2 = Geom.edgeEval(o2, d1, d2);
      if (z1 + z2 < 0) {
        z1 = -z1;
        z2 = -z2;
      }
      v.s = Geom.interpolate(z1, o2.s, z2, d1.s);
    } else {
      // Interpolate between o2 and d2
      z1 = Geom.edgeSign(o1, o2, d1);
      z2 = -Geom.edgeSign(o1, d2, d1);
      if (z1 + z2 < 0) {
        z1 = -z1;
        z2 = -z2;
      }
      v.s = Geom.interpolate(z1, o2.s, z2, d2.s);
    }

    // Now repeat the process for t

    if (!Geom.transLeq(o1, d1)) {
      t = o1;
      o1 = d1;
      d1 = t;
    } //swap( o1, d1 ); }
    if (!Geom.transLeq(o2, d2)) {
      t = o2;
      o2 = d2;
      d2 = t;
    } //swap( o2, d2 ); }
    if (!Geom.transLeq(o1, o2)) {
      t = o1;
      o1 = o2;
      o2 = t;
      t = d1;
      d1 = d2;
      d2 = t;
    } //swap( o1, o2 ); swap( d1, d2 ); }

    if (!Geom.transLeq(o2, d1)) {
      // Technically, no intersection -- do our best
      v.t = (o2.t + d1.t) * 0.5;
    } else if (Geom.transLeq(d1, d2)) {
      // Interpolate between o2 and d1
      z1 = Geom.transEval(o1, o2, d1);
      z2 = Geom.transEval(o2, d1, d2);
      if (z1 + z2 < 0) {
        z1 = -z1;
        z2 = -z2;
      }
      v.t = Geom.interpolate(z1, o2.t, z2, d1.t);
    } else {
      // Interpolate between o2 and d2
      z1 = Geom.transSign(o1, o2, d1);
      z2 = -Geom.transSign(o1, d2, d1);
      if (z1 + z2 < 0) {
        z1 = -z1;
        z2 = -z2;
      }
      v.t = Geom.interpolate(z1, o2.t, z2, d2.t);
    }
  }
}
