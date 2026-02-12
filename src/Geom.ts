import { Vertex, HalfEdge } from './Mesh';

export function vertEq(u: Vertex, v: Vertex) {
  return u.s === v.s && u.t === v.t;
}

// TRUE if u is lexicographically <= v
export function vertLeq(u: Vertex, v: Vertex) {
  return u.s < v.s || (u.s === v.s && u.t <= v.t);
}

// Transposed version of vertLeq
export function transLeq(u: Vertex, v: Vertex) {
  return u.t < v.t || (u.t === v.t && u.s <= v.s);
}

export function edgeGoesLeft(e: HalfEdge) {
  return vertLeq(e.Sym.Org, e.Org);
}

export function edgeGoesRight(e: HalfEdge) {
  return vertLeq(e.Org, e.Sym.Org);
}

export function vertL1dist(u: Vertex, v: Vertex) {
  return Math.abs(u.s - v.s) + Math.abs(u.t - v.t);
}

// Given three vertices u,v,w such that VertLeq(u,v) && VertLeq(v,w),
// evaluates the t-coord of the edge uw at the s-coord of vertex v.
// Returns v.t - (uw)(v.s), ie. the signed distance from uw to v.
// If uw is vertical (and thus passes thru v), the result is zero.
//
// The calculation is extremely accurate and stable, even when v
// is very close to u or w. In particular if we set v.t = 0 and
// let r be the negated result (this evaluates (uw)(v.s)), then
// r is guaranteed to satisfy MIN(u.t,w.t) <= r <= MAX(u.t,w.t)
export function edgeEval(u: Vertex, v: Vertex, w: Vertex) {
  let gapL = v.s - u.s;
  let gapR = w.s - v.s;

  if (gapL + gapR > 0.0) {
    if (gapL < gapR) {
      return v.t - u.t + (u.t - w.t) * (gapL / (gapL + gapR));
    } else {
      return v.t - w.t + (w.t - u.t) * (gapR / (gapL + gapR));
    }
  }
  return 0.0;
}

// Returns a number whose sign matches edgeEval(u,v,w) but which
// is cheaper to evaluate. Returns > 0, == 0, or < 0
// as v is above, on, or below the edge uw
export function edgeSign(u: Vertex, v: Vertex, w: Vertex) {
  let gapL = v.s - u.s;
  let gapR = w.s - v.s;

  if (gapL + gapR > 0.0) {
    return (v.t - w.t) * gapL + (v.t - u.t) * gapR;
  }
  return 0.0;
}

// Transposed versions of edgeEval and edgeSign

// Given three vertices u,v,w such that TransLeq(u,v) && TransLeq(v,w),
// evaluates the s-coord of the edge uw at the t-coord of vertex v.
// Returns v.s - (uw)(v.t), ie. the signed distance from uw to v.
// If uw is vertical (and thus passes thru v), the result is zero.
//
// The calculation is extremely accurate and stable, even when v
// is very close to u or w. In particular if we set v.s = 0 and
// let r be the negated result (this evaluates (uw)(v.t)), then
// r is guaranteed to satisfy MIN(u.s,w.s) <= r <= MAX(u.s,w.s)
export function transEval(u: Vertex, v: Vertex, w: Vertex) {
  let gapL = v.t - u.t;
  let gapR = w.t - v.t;

  if (gapL + gapR > 0.0) {
    if (gapL < gapR) {
      return v.s - u.s + (u.s - w.s) * (gapL / (gapL + gapR));
    } else {
      return v.s - w.s + (w.s - u.s) * (gapR / (gapL + gapR));
    }
  }
  return 0.0;
}

// Returns a number whose sign matches transEval(u,v,w) but cheaper
// to evaluate. Returns > 0, == 0, or < 0
// as v is above, on, or below the edge uw
export function transSign(u: Vertex, v: Vertex, w: Vertex) {
  let gapL = v.t - u.t;
  let gapR = w.t - v.t;

  if (gapL + gapR > 0.0) {
    return (v.s - w.s) * gapL + (v.s - u.s) * gapR;
  }
  return 0.0;
}

// Given parameters a,x,b,y returns the value (b*x+a*y)/(a+b),
// or (x+y)/2 if a==b==0. It requires that a,b >= 0, and enforces
// this in the rare case that one argument is slightly negative.
// The implementation is extremely stable numerically.
// In particular it guarantees that the result r satisfies
// MIN(x,y) <= r <= MAX(x,y), and the results are very accurate
// even when a and b differ greatly in magnitude
export function interpolate(a: number, x: number, b: number, y: number) {
  return (
    (a = a < 0 ? 0 : a),
    (b = b < 0 ? 0 : b),
    a <= b ? (b === 0 ? (x + y) / 2 : x + (y - x) * (a / (a + b))) : y + (x - y) * (b / (a + b))
  );
}

// Given edges (o1,d1) and (o2,d2), compute their point of intersection.
// The computed point is guaranteed to lie in the intersection of the
// bounding rectangles defined by each edge.
//
// Strategy: find the two middle vertices in the VertLeq ordering,
// and interpolate the intersection s-value from these. Then repeat
// using the TransLeq ordering to find the intersection t-value.
// This is not the most efficient approach but it is very numerically stable
export function intersect(o1: Vertex, d1: Vertex, o2: Vertex, d2: Vertex, v: Vertex) {
  let z1, z2;
  let t;

  if (!vertLeq(o1, d1)) {
    t = o1;
    o1 = d1;
    d1 = t;
  }
  if (!vertLeq(o2, d2)) {
    t = o2;
    o2 = d2;
    d2 = t;
  }
  if (!vertLeq(o1, o2)) {
    t = o1;
    o1 = o2;
    o2 = t;
    t = d1;
    d1 = d2;
    d2 = t;
  }

  if (!vertLeq(o2, d1)) {
    // No intersection -- do our best
    v.s = (o2.s + d1.s) * 0.5;
  } else if (vertLeq(d1, d2)) {
    z1 = edgeEval(o1, o2, d1);
    z2 = edgeEval(o2, d1, d2);
    if (z1 + z2 < 0) {
      z1 = -z1;
      z2 = -z2;
    }
    v.s = interpolate(z1, o2.s, z2, d1.s);
  } else {
    z1 = edgeSign(o1, o2, d1);
    z2 = -edgeSign(o1, d2, d1);
    if (z1 + z2 < 0) {
      z1 = -z1;
      z2 = -z2;
    }
    v.s = interpolate(z1, o2.s, z2, d2.s);
  }

  // Now repeat the process for t

  if (!transLeq(o1, d1)) {
    t = o1;
    o1 = d1;
    d1 = t;
  }
  if (!transLeq(o2, d2)) {
    t = o2;
    o2 = d2;
    d2 = t;
  }
  if (!transLeq(o1, o2)) {
    t = o1;
    o1 = o2;
    o2 = t;
    t = d1;
    d1 = d2;
    d2 = t;
  }

  if (!transLeq(o2, d1)) {
    v.t = (o2.t + d1.t) * 0.5;
  } else if (transLeq(d1, d2)) {
    z1 = transEval(o1, o2, d1);
    z2 = transEval(o2, d1, d2);
    if (z1 + z2 < 0) {
      z1 = -z1;
      z2 = -z2;
    }
    v.t = interpolate(z1, o2.t, z2, d1.t);
  } else {
    z1 = transSign(o1, o2, d1);
    z2 = -transSign(o1, d2, d1);
    if (z1 + z2 < 0) {
      z1 = -z1;
      z2 = -z2;
    }
    v.t = interpolate(z1, o2.t, z2, d2.t);
  }
}
