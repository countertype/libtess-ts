import { vertLeq, edgeSign, vertEq, intersect, vertL1dist, edgeGoesLeft, edgeGoesRight } from './Geom';
import { assert } from './Assert';
import { PriorityQ } from './PriorityQ';
import { WINDING } from './types';
import { DictNode, Vertex, Mesh, HalfEdge } from './Mesh';
import { Dict } from './Dict';
import { GluTesselator } from './GluTesselator';

// Scratch objects reused across sweep events to reduce allocations
let isectScratch: Vertex | null = null;
let tmpRegionScratch: DictNode | null = null;
const scratchWeights: [number, number, number, number] = [0, 0, 0, 0];
const scratchData: [unknown, unknown, unknown, unknown] = [null, null, null, null];
const scratchCoords: [number, number, number] = [0, 0, 0];

function regionBelow(r: DictNode) {
  return r.prev;
}

function regionAbove(r: DictNode) {
  return r.next;
}

// Invariants for the Edge Dictionary:
// - each pair of adjacent edges e2=Succ(e1) satisfies EdgeLeq(e1,e2)
//   at any valid location of the sweep event
// - if EdgeLeq(e2,e1) as well (at any valid sweep event), then e1 and e2
//   share a common endpoint
// - for each e, e->Dst has been processed, but not e->Org
// - each edge e satisfies VertLeq(e->Dst,event) && VertLeq(event,e->Org)
//   where "event" is the current sweep line event
// - no edge e has zero length
//
// Invariants for the Mesh (the processed portion):
// - the portion of the mesh left of the sweep line is a planar graph,
//   ie. there is *some* way to embed it in the plane
// - no processed edge has zero length
// - no two processed vertices have identical coordinates
// - each "inside" region is monotone, ie. can be broken into two chains
//   of monotonically increasing vertices according to VertLeq(v1,v2)
// - a non-invariant: these chains may intersect (very slightly)
//
// Invariants for the event vertex:
// - if none of the edges incident to the event vertex have an activeRegion
//   (ie. none of these edges are in the edge dictionary), then the vertex
//   has only right-going edges
// - if an edge is marked "fixUpperEdge" (a temporary edge introduced
//   by connectRightVertex), then it is the only right-going edge from
//   its associated vertex (these edges exist only when necessary)
function addWinding(eDst: HalfEdge, eSrc: HalfEdge) {
  eDst.winding += eSrc.winding;
  eDst.Sym.winding += eSrc.Sym.winding;
}

function deleteRegion(tess: GluTesselator, reg: DictNode) {
  // It was created with zero winding number, so it better be
  // deleted with zero winding number (ie. it better not get merged
  // with a real edge)
  assert(!reg.fixUpperEdge || reg.eUp.winding === 0);
  reg.eUp.activeRegion = null;
  tess.dict.delete(reg);
}

function fixUpperEdge(tess: GluTesselator, reg: DictNode, newEdge: HalfEdge) {
  // Replace an upper edge which needs fixing (see connectRightVertex)

  tess.mesh.delete(reg.eUp);
  reg.fixUpperEdge = false;
  reg.eUp = newEdge;
  newEdge.activeRegion = reg;
}

function topLeftRegion(tess: GluTesselator, reg: DictNode) {
  let org = reg.eUp.Org;
  let e;

  // Find the region above the uppermost edge with the same origin
  do {
    reg = regionAbove(reg);
  } while (reg.eUp.Org === org);

  // If the edge above was a temporary edge introduced by ConnectRightVertex,
  // now is the time to fix it
  if (reg.fixUpperEdge) {
    e = tess.mesh.connect(regionBelow(reg).eUp.Sym, reg.eUp.Lnext);
    fixUpperEdge(tess, reg, e);
    reg = regionAbove(reg);
  }
  return reg;
}

function topRightRegion(reg: DictNode) {
  let dst = reg.eUp.Sym.Org;
  // Find the region above the uppermost edge with the same destination
  do {
    reg = regionAbove(reg);
  } while (reg.eUp.Sym.Org === dst);
  return reg;
}

function addRegionBelow(tess: GluTesselator, regAbove: DictNode, eNewUp: HalfEdge) {
  // Add a new active region to the sweep line, *somewhere* below "regAbove"
  // (according to where the new edge belongs in the sweep-line dictionary).
  // The upper edge of the new region will be "eNewUp".
  // Winding number and "inside" flag are not updated.
  //
  const regNew = new DictNode();
  regNew.eUp = eNewUp;
  tess.dict.insertBefore(regAbove, regNew);
  regNew.fixUpperEdge = false;
  regNew.sentinel = false;
  regNew.dirty = false;

  eNewUp.activeRegion = regNew;
  return regNew;
}

function isWindingInside(tess: GluTesselator, n: number) {
  switch (tess.windingRule_) {
    case WINDING.ODD:
      return (n & 1) !== 0;
    case WINDING.NONZERO:
      return n !== 0;
    case WINDING.POSITIVE:
      return n > 0;
    case WINDING.NEGATIVE:
      return n < 0;
    case WINDING.ABS_GEQ_TWO:
      return n >= 2 || n <= -2;
  }

  throw new Error('Invalid winding rule');
}

function computeWinding(tess: GluTesselator, reg: DictNode) {
  reg.windingNumber = regionAbove(reg).windingNumber + reg.eUp.winding;
  reg.inside = isWindingInside(tess, reg.windingNumber);
}

function finishRegion(tess: GluTesselator, reg: DictNode) {
  // Delete a region from the sweep line.  This happens when the upper
  // and lower chains of a region meet (at a vertex on the sweep line).
  // The "inside" flag is copied to the appropriate mesh face (we could
  // not do this before -- since the structure of the mesh is always
  // changing, this face may not have even existed until now).
  //
  const e = reg.eUp;
  const f = e.Lface;

  f.inside = reg.inside;
  f.anEdge = e; // optimization for tessMeshTessellateMonoRegion()
  deleteRegion(tess, reg);
}

function finishLeftRegions(tess: GluTesselator, regFirst: DictNode, regLast: DictNode | null) {
  // We are given a vertex with one or more left-going edges.  All affected
  // edges should be in the edge dictionary.  Starting at regFirst->eUp,
  // we walk down deleting all regions where both edges have the same
  // origin vOrg.  At the same time we copy the "inside" flag from the
  // active region to the face, since at this point each face will belong
  // to at most one region (this was not necessarily true until this point
  // in the sweep).  The walk stops at the region above regLast; if regLast
  // is NULL we walk as far as possible.  At the same time we relink the
  // mesh if necessary, so that the ordering of edges around vOrg is the
  // same as in the dictionary.
  //
  let e;
  let reg = null;
  let regPrev = regFirst;
  let ePrev = regFirst.eUp;

  while (regPrev !== regLast) {
    regPrev.fixUpperEdge = false; // placement was OK
    reg = regionBelow(regPrev);
    e = reg.eUp;
    if (e.Org != ePrev.Org) {
      if (!reg.fixUpperEdge) {
        // Remove the last left-going edge.  Even though there are no further
        // edges in the dictionary with this origin, there may be further
        // such edges in the mesh (if we are adding left edges to a vertex
        // that has already been processed).  Thus it is important to call
        // FinishRegion rather than just DeleteRegion
        finishRegion(tess, regPrev);
        break;
      }
      // If the edge below was a temporary edge introduced by
      // ConnectRightVertex, now is the time to fix it
      e = tess.mesh.connect(ePrev.Onext.Sym, e.Sym);
      fixUpperEdge(tess, reg, e);
    }

    // Relink edges so that ePrev->Onext == e
    if (ePrev.Onext !== e) {
      tess.mesh.splice(e.Sym.Lnext, e);
      tess.mesh.splice(ePrev, e);
    }
    finishRegion(tess, regPrev); // may change reg->eUp
    ePrev = reg.eUp;
    regPrev = reg;
  }
  return ePrev;
}

function addRightEdges(
  tess: GluTesselator,
  regUp: DictNode,
  eFirst: HalfEdge,
  eLast: HalfEdge,
  eTopLeft: HalfEdge | null,
  cleanUp: boolean
) {
  // Purpose: insert right-going edges into the edge dictionary, and update
  // winding numbers and mesh connectivity appropriately.  All right-going
  // edges share a common origin vOrg.  Edges are inserted CCW starting at
  // eFirst; the last edge inserted is eLast->Oprev.  If vOrg has any
  // left-going edges already processed, then eTopLeft must be the edge
  // such that an imaginary upward vertical segment from vOrg would be
  // contained between eTopLeft->Oprev and eTopLeft; otherwise eTopLeft
  // should be NULL.
  //
  let reg, regPrev;
  let e, ePrev;
  let firstTime = true;

  // Insert the new right-going edges in the dictionary
  e = eFirst;
  do {
    addRegionBelow(tess, regUp, e.Sym);
    e = e.Onext;
  } while (e !== eLast);

  // Walk *all* right-going edges from e->Org, in the dictionary order,
  // updating the winding numbers of each region, and re-linking the mesh
  // edges to match the dictionary ordering (if necessary).
  if (eTopLeft === null) {
    eTopLeft = regionBelow(regUp).eUp.Sym.Onext;
  }
  regPrev = regUp;
  ePrev = eTopLeft;
  while (true) {
    reg = regionBelow(regPrev);
    e = reg.eUp.Sym;
    if (e.Org !== ePrev.Org) break;

    if (e.Onext !== ePrev) {
      // Unlink e from its current position, and relink below ePrev
      tess.mesh.splice(e.Sym.Lnext, e);
      tess.mesh.splice(ePrev.Sym.Lnext, e);
    }
    // Compute the winding number and "inside" flag for the new regions
    reg.windingNumber = regPrev.windingNumber - e.winding;
    reg.inside = isWindingInside(tess, reg.windingNumber);

    // Check for two outgoing edges with same slope -- process these
    // before any intersection tests (see example in tessComputeInterior)
    regPrev.dirty = true;
    if (!firstTime && checkForRightSplice(tess, regPrev)) {
      addWinding(e, ePrev);
      deleteRegion(tess, regPrev);
      tess.mesh.delete(ePrev);
    }
    firstTime = false;
    regPrev = reg;
    ePrev = e;
  }
  regPrev.dirty = true;

  if (cleanUp) {
    // Check for intersections between newly adjacent edges
    walkDirtyRegions(tess, regPrev);
  }
}

function callCombine(
  tess: GluTesselator,
  isect: Vertex,
  data: [unknown, unknown, unknown, unknown],
  weights: [number, number, number, number],
  needed: boolean
) {
  isect.data = null;

  if (tess.onCombine_) {
    scratchCoords[0] = isect.coords[0];
    scratchCoords[1] = isect.coords[1];
    scratchCoords[2] = isect.coords[2];
    isect.data = tess.onCombine_(scratchCoords, data, weights, tess.polygonData);
  }

  if (isect.data === null) {
    if (!needed) {
      isect.data = data[0];
    } else {
      tess.callErrorOrErrorData(100156); // GLU_TESS_NEED_COMBINE_CALLBACK
      tess.noEmit_ = true;
    }
  }
}

function spliceMergeVertices(tess: GluTesselator, e1: HalfEdge, e2: HalfEdge) {
  // Two vertices with identical coordinates are combined into one.
  // e1->Org is kept, while e2->Org is discarded.
  //
  if (tess.onCombine_) {
    scratchData[0] = e1.Org.data;
    scratchData[1] = e2.Org.data;
    scratchData[2] = null;
    scratchData[3] = null;
    scratchWeights[0] = 0.5;
    scratchWeights[1] = 0.5;
    scratchWeights[2] = 0.0;
    scratchWeights[3] = 0.0;
    callCombine(tess, e1.Org, scratchData, scratchWeights, false);
  }
  tess.mesh.splice(e1, e2);
}

function vertexWeights(
  isect: Vertex,
  org: Vertex,
  dst: Vertex,
  weights?: [number, number, number, number],
  weightIndex?: number
) {
  // Find some weights which describe how the intersection vertex is
  // a linear combination of "org" and "dest".  Each of the two edges
  // which generated "isect" is allocated 50% of the weight; each edge
  // splits the weight between its org and dst according to the
  // relative distance to "isect".
  //
  let t1 = vertL1dist(org, isect);
  let t2 = vertL1dist(dst, isect);
  let w0 = (0.5 * t2) / (t1 + t2);
  let w1 = (0.5 * t1) / (t1 + t2);

  if (weights !== undefined && weightIndex !== undefined) {
    weights[weightIndex] = w0;
    weights[weightIndex + 1] = w1;
  }

  isect.coords[0] += w0 * org.coords[0] + w1 * dst.coords[0];
  isect.coords[1] += w0 * org.coords[1] + w1 * dst.coords[1];
  isect.coords[2] += w0 * org.coords[2] + w1 * dst.coords[2];
}

function getIntersectData(
  tess: GluTesselator,
  isect: Vertex,
  orgUp: Vertex,
  dstUp: Vertex,
  orgLo: Vertex,
  dstLo: Vertex
) {
  // We've computed a new intersection point, now we need a "data" pointer
  // from the user so that we can refer to this new vertex in the
  // rendering callbacks.
  //
  scratchWeights[0] = 0;
  scratchWeights[1] = 0;
  scratchWeights[2] = 0;
  scratchWeights[3] = 0;
  scratchData[0] = orgUp.data;
  scratchData[1] = dstUp.data;
  scratchData[2] = orgLo.data;
  scratchData[3] = dstLo.data;

  isect.coords[0] = isect.coords[1] = isect.coords[2] = 0;

  vertexWeights(isect, orgUp, dstUp, scratchWeights, 0);
  vertexWeights(isect, orgLo, dstLo, scratchWeights, 2);

  callCombine(tess, isect, scratchData, scratchWeights, true);
}

function checkForRightSplice(tess: GluTesselator, regUp: DictNode) {
  // Check the upper and lower edge of "regUp", to make sure that the
  // eUp->Org is above eLo, or eLo->Org is below eUp (depending on which
  // origin is leftmost).
  //
  // The main purpose is to splice right-going edges with the same
  // dest vertex and nearly identical slopes (ie. we can't distinguish
  // the slopes numerically).  However the splicing can also help us
  // to recover from numerical errors.  For example, suppose at one
  // point we checked eUp and eLo, and decided that eUp->Org is barely
  // above eLo.  Then later, we split eLo into two edges (eg. from
  // a splice operation like this one).  This can change the result of
  // our test so that now eUp->Org is incident to eLo, or barely below it.
  // We must correct this condition to maintain the dictionary invariants.
  //
  // One possibility is to check these edges for intersection again
  // (ie. CheckForIntersect).  This is what we do if possible.  However
  // CheckForIntersect requires that tess->event lies between eUp and eLo,
  // so that it has something to fall back on when the intersection
  // calculation gives us an unusable answer.  So, for those cases where
  // we can't check for intersection, this routine fixes the problem
  // by just splicing the offending vertex into the other edge.
  // This is a guaranteed solution, no matter how degenerate things get.
  // Basically this is a combinatorial solution to a numerical problem.
  //
  let regLo = regionBelow(regUp);
  const eUp = regUp.eUp;
  const eLo = regLo.eUp;

  if (eUp.Org.s < eLo.Org.s || (eUp.Org.s === eLo.Org.s && eUp.Org.t <= eLo.Org.t)) {
    if (edgeSign(eLo.Sym.Org, eUp.Org, eLo.Org) > 0) return false;

    // eUp->Org appears to be below eLo
    if (!vertEq(eUp.Org, eLo.Org)) {
      // Splice eUp->Org into eLo
      tess.mesh.splitEdge(eLo.Sym);
      tess.mesh.splice(eUp, eLo.Sym.Lnext);
      regUp.dirty = regLo.dirty = true;
    } else if (eUp.Org !== eLo.Org) {
      // merge the two vertices, discarding eUp->Org
      tess.pq.delete(eUp.Org.pqHandle);
      spliceMergeVertices(tess, eLo.Sym.Lnext, eUp);
    }
  } else {
    if (edgeSign(eUp.Sym.Org, eLo.Org, eUp.Org) < 0) return false;

    // eLo->Org appears to be above eUp, so splice eLo->Org into eUp
    regionAbove(regUp).dirty = regUp.dirty = true;
    tess.mesh.splitEdge(eUp.Sym);
    tess.mesh.splice(eLo.Sym.Lnext, eUp);
  }
  return true;
}

function checkForLeftSplice(tess: GluTesselator, regUp: DictNode) {
  // Check the upper and lower edge of "regUp", to make sure that the
  // eUp->Dst is above eLo, or eLo->Dst is below eUp (depending on which
  // destination is rightmost).
  //
  // Theoretically, this should always be true.  However, splitting an edge
  // into two pieces can change the results of previous tests.  For example,
  // suppose at one point we checked eUp and eLo, and decided that eUp->Dst
  // is barely above eLo.  Then later, we split eLo into two edges (eg. from
  // a splice operation like this one).  This can change the result of
  // the test so that now eUp->Dst is incident to eLo, or barely below it.
  // We must correct this condition to maintain the dictionary invariants
  // (otherwise new edges might get inserted in the wrong place in the
  // dictionary, and bad stuff will happen).
  //
  // We fix the problem by just splicing the offending vertex into the
  // other edge.
  //
  let regLo = regionBelow(regUp);
  const eUp = regUp.eUp;
  const eLo = regLo.eUp;
  let e;

  if (eUp.Sym.Org.s < eLo.Sym.Org.s || (eUp.Sym.Org.s === eLo.Sym.Org.s && eUp.Sym.Org.t <= eLo.Sym.Org.t)) {
    if (edgeSign(eUp.Sym.Org, eLo.Sym.Org, eUp.Org) < 0) return false;

    // eLo->Dst is above eUp, so splice eLo->Dst into eUp
    regionAbove(regUp).dirty = regUp.dirty = true;
    e = tess.mesh.splitEdge(eUp);
    tess.mesh.splice(eLo.Sym, e);
    e.Lface.inside = regUp.inside;
  } else {
    if (edgeSign(eLo.Sym.Org, eUp.Sym.Org, eLo.Org) > 0) return false;

    // eUp->Dst is below eLo, so splice eUp->Dst into eLo
    regUp.dirty = regLo.dirty = true;
    e = tess.mesh.splitEdge(eLo);
    tess.mesh.splice(eUp.Lnext, eLo.Sym);
    e.Sym.Lface.inside = regUp.inside;
  }
  return true;
}

function checkForIntersect(tess: GluTesselator, regUp: DictNode) {
  // Check the upper and lower edges of the given region to see if
  // they intersect.  If so, create the intersection and add it
  // to the data structures.
  //
  // Returns TRUE if adding the new intersection resulted in a recursive
  // call to AddRightEdges(); in this case all "dirty" regions have been
  // checked for intersections, and possibly regUp has been deleted.
  //
  let regLo = regionBelow(regUp);
  let eUp = regUp.eUp;
  let eLo = regLo.eUp;
  const orgUp = eUp.Org;
  const orgLo = eLo.Org;
  let dstUp = eUp.Sym.Org;
  let dstLo = eLo.Sym.Org;
  let tMinUp, tMaxLo;
  const isect = isectScratch || (isectScratch = new Vertex());
  let orgMin;
  let e;

  if (orgUp === orgLo) return false; // right endpoints are the same

  tMinUp = Math.min(orgUp.t, dstUp.t);
  tMaxLo = Math.max(orgLo.t, dstLo.t);
  if (tMinUp > tMaxLo) return false; // t ranges do not overlap

  if (vertLeq(orgUp, orgLo)) {
    if (edgeSign(dstLo, orgUp, orgLo) > 0) return false;
  } else {
    if (edgeSign(dstUp, orgLo, orgUp) < 0) return false;
  }

  // At this point the edges intersect, at least marginally
  intersect(dstUp, orgUp, dstLo, orgLo, isect);
  if (isect.s < tess.event.s || (isect.s === tess.event.s && isect.t <= tess.event.t)) {
    // The intersection point lies slightly to the left of the sweep line,
    // so move it until it''s slightly to the right of the sweep line.
    // (If we had perfect numerical precision, this would never happen
    // in the first place).  The easiest and safest thing to do is
    // replace the intersection by tess->event.
    isect.s = tess.event.s;
    isect.t = tess.event.t;
  }
  // Similarly, if the computed intersection lies to the right of the
  // rightmost origin (which should rarely happen), it can cause
  // unbelievable inefficiency on sufficiently degenerate inputs.
  // (If you have the test program, try running test54.d with the
  // "X zoom" option turned on).
  orgMin = orgUp.s < orgLo.s || (orgUp.s === orgLo.s && orgUp.t <= orgLo.t) ? orgUp : orgLo;
  if (orgMin.s < isect.s || (orgMin.s === isect.s && orgMin.t <= isect.t)) {
    isect.s = orgMin.s;
    isect.t = orgMin.t;
  }

  if (vertEq(isect, orgUp) || vertEq(isect, orgLo)) {
    // Easy case -- intersection at one of the right endpoints
    checkForRightSplice(tess, regUp);
    return false;
  }

  if (
    (!vertEq(dstUp, tess.event) && edgeSign(dstUp, tess.event, isect) >= 0) ||
    (!vertEq(dstLo, tess.event) && edgeSign(dstLo, tess.event, isect) <= 0)
  ) {
    // Very unusual -- the new upper or lower edge would pass on the
    // wrong side of the sweep event, or through it.  This can happen
    // due to very small numerical errors in the intersection calculation
    if (dstLo === tess.event) {
      // Splice dstLo into eUp, and process the new region(s)
      tess.mesh.splitEdge(eUp.Sym);
      tess.mesh.splice(eLo.Sym, eUp);
      regUp = topLeftRegion(tess, regUp);
      eUp = regionBelow(regUp).eUp;
      finishLeftRegions(tess, regionBelow(regUp), regLo);
      addRightEdges(tess, regUp, eUp.Sym.Lnext, eUp, eUp, true);
      return true;
    }
    if (dstUp === tess.event) {
      // Splice dstUp into eLo, and process the new region(s)
      tess.mesh.splitEdge(eLo.Sym);
      tess.mesh.splice(eUp.Lnext, eLo.Sym.Lnext);
      regLo = regUp;
      regUp = topRightRegion(regUp);
      e = regionBelow(regUp).eUp.Sym.Onext;
      regLo.eUp = eLo.Sym.Lnext;
      eLo = finishLeftRegions(tess, regLo, null);
      addRightEdges(tess, regUp, eLo.Onext, eUp.Sym.Onext, e, true);
      return true;
    }
    // Special case: called from ConnectRightVertex.  If either
    // edge passes on the wrong side of tess->event, split it
    // (and wait for ConnectRightVertex to splice it appropriately)
    if (edgeSign(dstUp, tess.event, isect) >= 0) {
      regionAbove(regUp).dirty = regUp.dirty = true;
      tess.mesh.splitEdge(eUp.Sym);
      eUp.Org.s = tess.event.s;
      eUp.Org.t = tess.event.t;
    }
    if (edgeSign(dstLo, tess.event, isect) <= 0) {
      regUp.dirty = regLo.dirty = true;
      tess.mesh.splitEdge(eLo.Sym);
      eLo.Org.s = tess.event.s;
      eLo.Org.t = tess.event.t;
    }
    // leave the rest for ConnectRightVertex
    return false;
  }

  // General case -- split both edges, splice into new vertex.
  // When we do the splice operation, the order of the arguments is
  // arbitrary as far as correctness goes.  However, when the operation
  // creates a new face, the work done is proportional to the size of
  // the new face.  We expect the faces in the processed part of
  // the mesh (ie. eUp->Lface) to be smaller than the faces in the
  // unprocessed original contours (which will be eLo->Oprev->Lface).
  tess.mesh.splitEdge(eUp.Sym);
  tess.mesh.splitEdge(eLo.Sym);
  tess.mesh.splice(eLo.Sym.Lnext, eUp);
  eUp.Org.s = isect.s;
  eUp.Org.t = isect.t;
  eUp.Org.pqHandle = tess.pq.insert(eUp.Org);
  getIntersectData(tess, eUp.Org, orgUp, dstUp, orgLo, dstLo);
  regionAbove(regUp).dirty = regUp.dirty = regLo.dirty = true;
  return false;
}

function walkDirtyRegions(tess: GluTesselator, regUp: DictNode) {
  // When the upper or lower edge of any region changes, the region is
  // marked "dirty".  This routine walks through all the dirty regions
  // and makes sure that the dictionary invariants are satisfied
  // (see the comments at the beginning of this file).  Of course
  // new dirty regions can be created as we make changes to restore
  // the invariants.
  //
  let regLo = regionBelow(regUp);
  let eUp, eLo;

  while (true) {
    // Find the lowest dirty region (we walk from the bottom up)
    while (regLo.dirty) {
      regUp = regLo;
      regLo = regionBelow(regLo);
    }
    if (!regUp.dirty) {
      regLo = regUp;
      regUp = regionAbove(regUp);
      if (regUp === null || !regUp.dirty) {
        // We've walked all the dirty regions
        return;
      }
    }
    regUp.dirty = false;
    eUp = regUp.eUp;
    eLo = regLo.eUp;

    if (eUp.Sym.Org !== eLo.Sym.Org) {
      // Check that the edge ordering is obeyed at the Dst vertices
      if (checkForLeftSplice(tess, regUp)) {
        // If the upper or lower edge was marked fixUpperEdge, then
        // we no longer need it (since these edges are needed only for
        // vertices which otherwise have no right-going edges).
        if (regLo.fixUpperEdge) {
          deleteRegion(tess, regLo);
          tess.mesh.delete(eLo);
          regLo = regionBelow(regUp);
          eLo = regLo.eUp;
        } else if (regUp.fixUpperEdge) {
          deleteRegion(tess, regUp);
          tess.mesh.delete(eUp);
          regUp = regionAbove(regLo);
          eUp = regUp.eUp;
        }
      }
    }
    if (eUp.Org !== eLo.Org) {
      if (
        eUp.Sym.Org !== eLo.Sym.Org &&
        !regUp.fixUpperEdge &&
        !regLo.fixUpperEdge &&
        (eUp.Sym.Org === tess.event || eLo.Sym.Org === tess.event)
      ) {
        // When all else fails in CheckForIntersect(), it uses tess->event
        // as the intersection location.  To make this possible, it requires
        // that tess->event lie between the upper and lower edges, and also
        // that neither of these is marked fixUpperEdge (since in the worst
        // case it might splice one of these edges into tess->event, and
        // violate the invariant that fixable edges are the only right-going
        // edge from their associated vertex).
        if (checkForIntersect(tess, regUp)) {
          // WalkDirtyRegions() was called recursively; we're done
          return;
        }
      } else {
        // Even though we can't use CheckForIntersect(), the Org vertices
        // may violate the dictionary edge ordering -- check and correct this
        checkForRightSplice(tess, regUp);
      }
    }
    if (eUp.Org === eLo.Org && eUp.Sym.Org === eLo.Sym.Org) {
      // A degenerate loop consisting of only two edges -- delete it
      addWinding(eLo, eUp);
      deleteRegion(tess, regUp);
      tess.mesh.delete(eUp);
      regUp = regionAbove(regLo);
    }
  }
}

function connectRightVertex(tess: GluTesselator, regUp: DictNode, eBottomLeft: HalfEdge) {
  // Purpose: connect a "right" vertex vEvent (one where all edges go left)
  // to the unprocessed portion of the mesh.  Since there are no right-going
  // edges, two regions (one above vEvent and one below) are being merged
  // into one.  "regUp" is the upper of these two regions.
  //
  // There are two reasons for doing this (adding a right-going edge):
  // - if the two regions being merged are "inside", we must add an edge
  // to keep them separated (the combined region would not be monotone).
  // - in any case, we must leave some record of vEvent in the dictionary,
  // so that we can merge vEvent with features that we have not seen yet.
  // For example, maybe there is a vertical edge which passes just to
  // the right of vEvent; we would like to splice vEvent into this edge.
  //
  // However, we don't want to connect vEvent to just any vertex.  We don''t
  // want the new edge to cross any other edges; otherwise we will create
  // intersection vertices even when the input data had no self-intersections.
  // (This is a bad thing; if the user's input data has no intersections,
  // we don't want to generate any false intersections ourselves.)
  //
  // Our eventual goal is to connect vEvent to the leftmost unprocessed
  // vertex of the combined region (the union of regUp and regLo).
  // But because of unseen vertices with all right-going edges, and also
  // new vertices which may be created by edge intersections, we don''t
  // know where that leftmost unprocessed vertex is.  In the meantime, we
  // connect vEvent to the closest vertex of either chain, and mark the region
  // as "fixUpperEdge".  This flag says to delete and reconnect this edge
  // to the next processed vertex on the boundary of the combined region.
  // Quite possibly the vertex we connected to will turn out to be the
  // closest one, in which case we won''t need to make any changes.
  //
  let eNew;
  let eTopLeft = eBottomLeft.Onext;
  let regLo = regionBelow(regUp);
  let eUp = regUp.eUp;
  let eLo = regLo.eUp;
  let degenerate = false;

  if (eUp.Sym.Org !== eLo.Sym.Org) {
    checkForIntersect(tess, regUp);
  }

  // Possible new degeneracies: upper or lower edge of regUp may pass
  // through vEvent, or may coincide with new intersection vertex
  if (vertEq(eUp.Org, tess.event)) {
    tess.mesh.splice(eTopLeft.Sym.Lnext, eUp);
    regUp = topLeftRegion(tess, regUp);
    eTopLeft = regionBelow(regUp).eUp;
    finishLeftRegions(tess, regionBelow(regUp), regLo);
    degenerate = true;
  }
  if (vertEq(eLo.Org, tess.event)) {
    tess.mesh.splice(eBottomLeft, eLo.Sym.Lnext);
    eBottomLeft = finishLeftRegions(tess, regLo, null);
    degenerate = true;
  }
  if (degenerate) {
    addRightEdges(tess, regUp, eBottomLeft.Onext, eTopLeft, eTopLeft, true);
    return;
  }

  // Non-degenerate situation -- need to add a temporary, fixable edge
  // Connect to the closer of eLo->Org, eUp->Org
  if (vertLeq(eLo.Org, eUp.Org)) {
    eNew = eLo.Sym.Lnext;
  } else {
    eNew = eUp;
  }
  eNew = tess.mesh.connect(eBottomLeft.Onext.Sym, eNew);

  // Prevent cleanup, otherwise eNew might disappear before we've even
  // had a chance to mark it as a temporary edge
  addRightEdges(tess, regUp, eNew, eNew.Onext, eNew.Onext, false);
  eNew.Sym.activeRegion!.fixUpperEdge = true;
  walkDirtyRegions(tess, regUp);
}

function connectLeftDegenerate(tess: GluTesselator, regUp: DictNode, vEvent: Vertex) {
  // The event vertex lies exacty on an already-processed edge or vertex.
  // Adding the new vertex involves splicing it into the already-processed
  // part of the mesh.
  //
  let e, eTopLeft, eTopRight, eLast;
  let reg;

  e = regUp.eUp;
  if (vertEq(e.Org, vEvent)) {
    // e->Org is an unprocessed vertex - just combine them, and wait
    // for e->Org to be pulled from the queue

    spliceMergeVertices(tess, e, vEvent.anEdge);
    return;
  }

  if (!vertEq(e.Sym.Org, vEvent)) {
    // General case -- splice vEvent into edge e which passes through it
    tess.mesh.splitEdge(e.Sym);
    if (regUp.fixUpperEdge) {
      // This edge was fixable -- delete unused portion of original edge
      tess.mesh.delete(e.Onext);
      regUp.fixUpperEdge = false;
    }
    tess.mesh.splice(vEvent.anEdge, e);
    sweepEvent(tess, vEvent); // recurse
    return;
  }

  // vEvent coincides with e->Dst, which has already been processed.
  // Splice in the additional right-going edges.

  regUp = topRightRegion(regUp);
  reg = regionBelow(regUp);
  eTopRight = reg.eUp.Sym;
  eTopLeft = eLast = eTopRight.Onext;
  if (reg.fixUpperEdge) {
    // Here e->Dst has only a single fixable edge going right.
    // We can delete it since now we have some real right-going edges
    assert(eTopLeft !== eTopRight); // there are some left edges too
    deleteRegion(tess, reg);
    tess.mesh.delete(eTopRight);
    eTopRight = eTopLeft.Sym.Lnext;
  }
  tess.mesh.splice(vEvent.anEdge, eTopRight);
  if (!edgeGoesLeft(eTopLeft)) {
    // e->Dst had no left-going edges -- indicate this to AddRightEdges()
    eTopLeft = null;
  }
  addRightEdges(tess, regUp, eTopRight.Onext, eLast, eTopLeft, true);
}

function connectLeftVertex(tess: GluTesselator, vEvent: Vertex) {
  // Purpose: connect a "left" vertex (one where both edges go right)
  // to the processed portion of the mesh.  Let R be the active region
  // containing vEvent, and let U and L be the upper and lower edge
  // chains of R.  There are two possibilities:
  //
  // - the normal case: split R into two regions, by connecting vEvent to
  // the rightmost vertex of U or L lying to the left of the sweep line
  //
  // - the degenerate case: if vEvent is close enough to U or L, we
  // merge vEvent into that edge chain.  The subcases are:
  // - merging with the rightmost vertex of U or L
  // - merging with the active edge of U or L
  // - merging with an already-processed portion of U or L
  //
  let regUp, regLo, reg;
  let eUp, eLo, eNew;
  const tmp = tmpRegionScratch || (tmpRegionScratch = new DictNode());

  // Get a pointer to the active region containing vEvent
  tmp.eUp = vEvent.anEdge.Sym; // tessDictListSearch
  regUp = tess.dict.search(tmp);
  regLo = regionBelow(regUp);
  if (!regLo) {
    // This may happen if the input polygon is coplanar
    return;
  }
  eUp = regUp.eUp;
  eLo = regLo.eUp;

  // Try merging with U or L first
  if (edgeSign(eUp.Sym.Org, vEvent, eUp.Org) === 0.0) {
    connectLeftDegenerate(tess, regUp, vEvent);
    return;
  }

  // Connect vEvent to rightmost processed vertex of either chain.
  // e->Dst is the vertex that we will connect to vEvent.
  reg = vertLeq(eLo.Sym.Org, eUp.Sym.Org) ? regUp : regLo;

  if (regUp.inside || reg.fixUpperEdge) {
    if (reg === regUp) {
      eNew = tess.mesh.connect(vEvent.anEdge.Sym, eUp.Lnext);
    } else {
      let tempHalfEdge = tess.mesh.connect(eLo.Sym.Onext.Sym, vEvent.anEdge);
      eNew = tempHalfEdge.Sym;
    }
    if (reg.fixUpperEdge) {
      fixUpperEdge(tess, reg, eNew);
    } else {
      computeWinding(tess, addRegionBelow(tess, regUp, eNew));
    }
    sweepEvent(tess, vEvent);
  } else {
    // The new vertex is in a region which does not belong to the polygon.
    // We don''t need to connect this vertex to the rest of the mesh.
    addRightEdges(tess, regUp, vEvent.anEdge, vEvent.anEdge, null, true);
  }
}

function sweepEvent(tess: GluTesselator, vEvent: Vertex) {
  // Does everything necessary when the sweep line crosses a vertex.
  // Updates the mesh and the edge dictionary.
  //

  tess.event = vEvent;

  // Check if this vertex is the right endpoint of an edge that is
  // already in the dictionary.  In this case we don't need to waste
  // time searching for the location to insert new edges.
  let e = vEvent.anEdge;
  while (e.activeRegion === null) {
    e = e.Onext;
    if (e === vEvent.anEdge) {
      // All edges go right -- not incident to any processed edges
      connectLeftVertex(tess, vEvent);
      return;
    }
  }

  // Processing consists of two phases: first we "finish" all the
  // active regions where both the upper and lower edges terminate
  // at vEvent (ie. vEvent is closing off these regions).
  // We mark these faces "inside" or "outside" the polygon according
  // to their winding number, and delete the edges from the dictionary.
  // This takes care of all the left-going edges from vEvent.
  let regUp = topLeftRegion(tess, e.activeRegion!);

  let reg = regionBelow(regUp);
  const eTopLeft = reg.eUp;
  let eBottomLeft = finishLeftRegions(tess, reg, null);

  // Next we process all the right-going edges from vEvent.  This
  // involves adding the edges to the dictionary, and creating the
  // associated "active regions" which record information about the
  // regions between adjacent dictionary edges.
  if (eBottomLeft.Onext === eTopLeft) {
    // No right-going edges -- add a temporary "fixable" edge
    connectRightVertex(tess, regUp, eBottomLeft);
  } else {
    addRightEdges(tess, regUp, eBottomLeft.Onext, eTopLeft, eTopLeft, true);
  }
}

function addSentinel(tess: GluTesselator, smin: number, smax: number, t: number) {
  // We add two sentinel edges above and below all other edges,
  // to avoid special cases at the top and bottom.
  //
  const reg = new DictNode();
  let e = tess.mesh.makeEdge();

  e.Org.s = smax;
  e.Org.t = t;
  e.Sym.Org.s = smin;
  e.Sym.Org.t = t;
  tess.event = e.Sym.Org; // initialize it

  reg.eUp = e;
  reg.windingNumber = 0;
  reg.inside = false;
  reg.fixUpperEdge = false;
  reg.sentinel = true;
  reg.dirty = false;
  tess.dict.insert(reg);
}

function initEdgeDict(tess: GluTesselator) {
  // We maintain an ordering of edge intersections with the sweep line.
  // This order is maintained in a dynamic dictionary.
  //
  tess.dict = new Dict(tess);

  let w = tess.bmax[0] - tess.bmin[0];
  let h = tess.bmax[1] - tess.bmin[1];

  let smin = tess.bmin[0] - w;
  let smax = tess.bmax[0] + w;
  let tmin = tess.bmin[1] - h;
  let tmax = tess.bmax[1] + h;

  addSentinel(tess, smin, smax, tmin);
  addSentinel(tess, smin, smax, tmax);
}

function doneEdgeDict(tess: GluTesselator) {
  let reg;
  while ((reg = tess.dict.min()).eUp !== null) {
    deleteRegion(tess, reg);
  }
}

function removeDegenerateEdges(tess: GluTesselator) {
  // Remove zero-length edges, and contours with fewer than 3 vertices
  let e, eNext, eLnext;
  let eHead = tess.mesh.eHead;

  for (e = eHead.next; e !== eHead; e = eNext) {
    eNext = e.next;
    eLnext = e.Lnext;

    if (vertEq(e.Org, e.Sym.Org) && e.Lnext.Lnext !== e) {
      // Zero-length edge, contour has at least 3 edges
      spliceMergeVertices(tess, eLnext, e); // deletes e->Org
      tess.mesh.delete(e); // e is a self-loop
      e = eLnext;
      eLnext = e.Lnext;
    }
    if (eLnext.Lnext === e) {
      // Degenerate contour (one or two edges)
      if (eLnext !== e) {
        if (eLnext === eNext || eLnext === eNext.Sym) {
          eNext = eNext.next;
        }
        tess.mesh.delete(eLnext);
      }
      if (e === eNext || e === eNext.Sym) {
        eNext = eNext.next;
      }
      tess.mesh.delete(e);
    }
  }
}

function initPriorityQ(tess: GluTesselator) {
  // Insert all vertices into the priority queue which determines the
  // order in which vertices cross the sweep line.
  //
  let pq;
  let v, vHead;

  let vertexCount = tess.mesh.vertexCount + 8;

  if (tess.pq) {
    tess.pq.reset(vertexCount);
    pq = tess.pq;
  } else {
    pq = tess.pq = new PriorityQ(vertexCount);
  }

  vHead = tess.mesh.vHead;
  for (v = vHead.next; v !== vHead; v = v.next) {
    v.pqHandle = pq.insert(v);
  }

  if (v !== vHead) {
    return false;
  }

  pq.init();

  return true;
}

function donePriorityQ(_tess: GluTesselator) {
  // PQ is kept alive for reuse across calls
}

function removeDegenerateFaces(tess: GluTesselator, mesh: Mesh) {
  // Delete any degenerate faces with only two edges.  WalkDirtyRegions()
  // will catch almost all of these, but it won't catch degenerate faces
  // produced by splice operations on already-processed edges.
  // The two places this can happen are in FinishLeftRegions(), when
  // we splice in a "temporary" edge produced by ConnectRightVertex(),
  // and in CheckForLeftSplice(), where we splice already-processed
  // edges to ensure that our dictionary invariants are not violated
  // by numerical errors.
  //
  // In both these cases it is *very* dangerous to delete the offending
  // edge at the time, since one of the routines further up the stack
  // will sometimes be keeping a pointer to that edge.
  //
  let f, fNext;
  let e;

  for (f = mesh.fHead.next; f !== mesh.fHead; f = fNext) {
    fNext = f.next;
    e = f.anEdge;

    if (e.Lnext.Lnext === e) {
      // A face with only two edges
      addWinding(e.Onext, e);
      tess.mesh.delete(e);
    }
  }
  return true;
}

export function computeInterior(tess: GluTesselator, validate: boolean = true) {
  // tessComputeInterior( tess ) computes the planar arrangement specified
  // by the given contours, and further subdivides this arrangement
  // into regions.  Each region is marked "inside" if it belongs
  // to the polygon, according to the rule given by tess->windingRule.
  // Each interior region is guaranteed be monotone.
  //
  let v, vNext;

  // Each vertex defines an event for our sweep line.  Start by inserting
  // all the vertices in a priority queue.  Events are processed in
  // lexicographic order, ie.
  //
  // e1 < e2  iff  e1.x < e2.x || (e1.x == e2.x && e1.y < e2.y)
  removeDegenerateEdges(tess);

  // if error
  if (!initPriorityQ(tess)) {
    return false;
  }

  initEdgeDict(tess);

  while ((v = tess.pq.extractMin()) !== null) {
    while (true) {
      vNext = tess.pq.min();
      if (vNext === null || !vertEq(vNext, v)) break;

      // Merge together all vertices at exactly the same location.
      // This is more efficient than processing them one at a time,
      // simplifies the code (see ConnectLeftDegenerate), and is also
      // important for correct handling of certain degenerate cases.
      // For example, suppose there are two identical edges A and B
      // that belong to different contours (so without this code they would
      // be processed by separate sweep events).  Suppose another edge C
      // crosses A and B from above.  When A is processed, we split it
      // at its intersection point with C.  However this also splits C,
      // so when we insert B we may compute a slightly different
      // intersection point.  This might leave two edges with a small
      // gap between them.  This kind of error is especially obvious
      // when using boundary extraction (BOUNDARY_CONTOURS).
      vNext = tess.pq.extractMin();
      spliceMergeVertices(tess, v.anEdge, vNext!.anEdge);
    }
    sweepEvent(tess, v);
  }

  tess.event = tess.dict.min().eUp.Org;

  doneEdgeDict(tess);
  donePriorityQ(tess);

  if (!removeDegenerateFaces(tess, tess.mesh)) {
    return false;
  }

  if (validate) {
    tess.mesh.check();
  }

  return true;
}
