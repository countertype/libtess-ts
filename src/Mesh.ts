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

// mesh.ts - Half-edge mesh data structure
// Based on libtess (SGI OpenGL) mesh.c/h by Eric Veach (1994)

import { V3 } from "./types";
import { DictNode } from "./Dict";
import { Geom } from "./Geom";
import { assert, DEBUG } from "./Assert";

// HalfEdge

export class HalfEdge {
  next: HalfEdge | null = null;
  Org: Vertex | null = null;
  Sym: HalfEdge | null = null;
  Onext: HalfEdge | null = null;
  Lnext: HalfEdge | null = null;
  Lface: Face | null = null;
  activeRegion: ActiveRegion | null = null;
  winding: number = 0;
}

// Vertex

export class Vertex {
  next: Vertex | null = null;
  prev: Vertex | null = null;
  anEdge: HalfEdge | null = null;
  coords: V3 = [0, 0, 0];
  s: number = 0.0;
  t: number = 0.0;
  pqHandle: number = 0;
  /** User-provided vertex data (for combine callback interpolation) */
  data: unknown = null;
}

// Face

export class Face {
  next: Face | null = null;
  prev: Face | null = null;
  anEdge: HalfEdge | null = null;
  inside: boolean = false;
}

// ActiveRegion (sweep line)

export class ActiveRegion {
  eUp: HalfEdge | null = null;
  nodeUp: DictNode | null = null;
  windingNumber: number = 0;
  inside: boolean = false;
  sentinel: boolean = false;
  dirty: boolean = false;
  fixUpperEdge: boolean = false;
}

// Mesh

// The mesh operations below have three motivations: completeness,
// convenience, and efficiency.  The basic mesh operations are makeEdge,
// splice, and delete.  All the other edge operations can be implemented
// in terms of these.  The other operations are provided for convenience
// and/or efficiency.
//
// When a face is split or a vertex is added, they are inserted into the
// global list *before* the existing vertex or face (ie. e.Org or e.Lface).
// This makes it easier to process all vertices or faces in the global lists
// without worrying about processing the same data twice.  As a convenience,
// when a face is split, the "inside" flag is copied from the old face.
// Other internal data (v.data, v.activeRegion, f.data, f.marked,
// f.trail, e.winding) is set to zero.
//
// Basic Edge Operations:
//
// makeEdge() creates one edge, two vertices, and a loop (face).
// The loop consists of the two new half-edges.
//
// splice(eOrg, eDst) is the basic operation for changing the
// mesh connectivity and topology.  It changes the mesh so that
//  eOrg.Onext <- OLD(eDst.Onext)
//  eDst.Onext <- OLD(eOrg.Onext)
// where OLD(...) means the value before the splice operation.
//
// This can have two effects on the vertex structure:
//  - if eOrg.Org != eDst.Org, the two vertices are merged together
//  - if eOrg.Org == eDst.Org, the origin is split into two vertices
// In both cases, eDst.Org is changed and eOrg.Org is untouched.
//
// Similarly (and independently) for the face structure:
//  - if eOrg.Lface == eDst.Lface, one loop is split into two
//  - if eOrg.Lface != eDst.Lface, two distinct loops are joined into one
// In both cases, eDst.Lface is changed and eOrg.Lface is unaffected.
//
// delete(eDel) removes the edge eDel.  There are several cases:
// if (eDel.Lface != eDel.Sym.Lface), we join two loops into one; the loop
// eDel.Lface is deleted.  Otherwise, we are splitting one loop into two;
// the newly created loop will contain eDel.Sym.Org.  If the deletion of eDel
// would create isolated vertices, those are deleted as well.
//
// Other Edge Operations:
//
// addEdgeVertex(eOrg) creates a new edge eNew such that
// eNew == eOrg.Lnext, and eNew.Sym.Org is a newly created vertex.
// eOrg and eNew will have the same left face.
//
// splitEdge(eOrg) splits eOrg into two edges eOrg and eNew,
// such that eNew == eOrg.Lnext.  The new vertex is eOrg.Sym.Org == eNew.Org.
// eOrg and eNew will have the same left face.
//
// connect(eOrg, eDst) creates a new edge from eOrg.Sym.Org
// to eDst.Org, and returns the corresponding half-edge eNew.
// If eOrg.Lface == eDst.Lface, this splits one loop into two,
// and the newly created loop is eNew.Lface.  Otherwise, two disjoint
// loops are merged into one, and the loop eDst.Lface is destroyed.
//
// Other Operations:
//
// zapFace(fZap) destroys a face and removes it from the
// global face list.  All edges of fZap will have a null pointer as their
// left face.  Any edges which also have a null pointer as their right face
// are deleted entirely (along with any isolated vertices this produces).
// An entire mesh can be deleted by zapping its faces, one at a time,
// in any order.  Zapped faces cannot be used in further mesh operations!
//
// check() checks a mesh for self-consistency.
export class Mesh {
  vHead: Vertex; // dummy header for vertex list
  fHead: Face; // dummy header for face list
  eHead: HalfEdge; // dummy header for edge list
  eHeadSym: HalfEdge; // and its symmetric counterpart

  constructor() {
    const v = new Vertex();
    const f = new Face();
    const e = new HalfEdge();
    const eSym = new HalfEdge();

    v.next = v.prev = v;
    v.anEdge = null;

    f.next = f.prev = f;

    e.next = e;
    e.Sym = eSym;

    eSym.next = eSym;
    eSym.Sym = e;

    this.vHead = v;
    this.fHead = f;
    this.eHead = e;
    this.eHeadSym = eSym;
  }

  // makeEdgeInternal creates a new pair of half-edges which form their own loop.
  // No vertex or face structures are allocated, but these must be assigned
  // before the current edge operation is completed.
  private makeEdgeInternal(eNext: HalfEdge) {
    const e = new HalfEdge();
    const eSym = new HalfEdge();

    // Make sure eNext points to the first edge of the edge pair
    // if (eNext.Sym.side < eNext.side) { eNext = eNext.Sym; }

    // Insert in circular doubly-linked list before eNext.
    // Note that the prev pointer is stored in Sym.next.
    const ePrev = eNext.Sym.next;
    eSym.next = ePrev;
    ePrev.Sym.next = e;
    e.next = eNext;
    eNext.Sym.next = eSym;

    e.Sym = eSym;
    e.Onext = e;
    e.Lnext = eSym;
    e.Org = null;
    e.Lface = null;
    e.winding = 0;
    e.activeRegion = null;

    eSym.Sym = e;
    eSym.Onext = eSym;
    eSym.Lnext = e;
    eSym.Org = null;
    eSym.Lface = null;
    eSym.winding = 0;
    eSym.activeRegion = null;

    return e;
  }

  // splice is best described by the Guibas/Stolfi paper or the
  // CS348a notes (see mesh.h).  Basically it modifies the mesh so that
  // a.Onext and b.Onext are exchanged.  This can have various effects
  // depending on whether a and b belong to different face or vertex rings.
  // For more explanation see public splice() method below.
  private spliceInternal(a: HalfEdge, b: HalfEdge) {
    const aOnext = a.Onext;
    const bOnext = b.Onext;
    aOnext.Sym.Lnext = b;
    bOnext.Sym.Lnext = a;
    a.Onext = bOnext;
    b.Onext = aOnext;
  }

  // makeVertex attaches a new vertex and makes it the
  // origin of all edges in the vertex loop to which eOrig belongs. "vNext" gives
  // a place to insert the new vertex in the global vertex list.  We insert
  // the new vertex *before* vNext so that algorithms which walk the vertex
  // list will not see the newly created vertices.
  private makeVertex(newVertex: Vertex, eOrig: HalfEdge, vNext: Vertex) {
    const vNew = newVertex;

    // insert in circular doubly-linked list before vNext
    const vPrev = vNext.prev;
    vNew.prev = vPrev;
    vPrev.next = vNew;
    vNew.next = vNext;
    vNext.prev = vNew;

    vNew.anEdge = eOrig;
    // leave coords, s, t undefined

    // fix other edges on this vertex loop
    let e = eOrig;
    do {
      e.Org = vNew;
      e = e.Onext;
    } while (e !== eOrig);
  }

  // makeFace attaches a new face and makes it the left
  // face of all edges in the face loop to which eOrig belongs.  "fNext" gives
  // a place to insert the new face in the global face list.  We insert
  // the new face *before* fNext so that algorithms which walk the face
  // list will not see the newly created faces.
  private makeFace(newFace: Face, eOrig: HalfEdge, fNext: Face) {
    const fNew = newFace;

    // insert in circular doubly-linked list before fNext
    const fPrev = fNext.prev;
    fNew.prev = fPrev;
    fPrev.next = fNew;
    fNew.next = fNext;
    fNext.prev = fNew;

    fNew.anEdge = eOrig;

    // The new face is marked "inside" if the old one was.  This is a
    // convenience for the common case where a face has been split in two.
    fNew.inside = fNext.inside;

    // fix other edges on this face loop
    let e = eOrig;
    do {
      e.Lface = fNew;
      e = e.Lnext;
    } while (e !== eOrig);
  }

  // killEdge destroys an edge (the half-edges eDel and eDel.Sym),
  // and removes from the global edge list.
  private killEdge(eDel: HalfEdge) {
    // Half-edges are allocated in pairs, see EdgePair above
    // if (eDel.Sym.side < eDel.side) { eDel = eDel.Sym; }

    // delete from circular doubly-linked list
    const eNext = eDel.next;
    const ePrev = eDel.Sym.next;
    eNext.Sym.next = ePrev;
    ePrev.Sym.next = eNext;
  }

  // killVertex destroys a vertex and removes it from the global
  // vertex list.  It updates the vertex loop to point to a given new vertex.
  private killVertex(vDel: Vertex, newOrg: Vertex | null) {
    const eStart = vDel.anEdge;
    // change the origin of all affected edges
    let e = eStart;
    do {
      e.Org = newOrg;
      e = e.Onext;
    } while (e !== eStart);

    // delete from circular doubly-linked list
    const vPrev = vDel.prev;
    const vNext = vDel.next;
    vNext.prev = vPrev;
    vPrev.next = vNext;
  }

  // killFace destroys a face and removes it from the global face
  // list.  It updates the face loop to point to a given new face.
  private killFace(fDel: Face, newLface: Face | null) {
    const eStart = fDel.anEdge;

    // change the left face of all affected edges
    let e = eStart;
    do {
      e.Lface = newLface;
      e = e.Lnext;
    } while (e !== eStart);

    // delete from circular doubly-linked list
    const fPrev = fDel.prev;
    const fNext = fDel.next;
    fNext.prev = fPrev;
    fPrev.next = fNext;
  }

  // Basic edge operations

  // makeEdge creates one edge, two vertices, and a loop (face).
  // The loop consists of the two new half-edges.
  makeEdge() {
    const newVertex1 = new Vertex();
    const newVertex2 = new Vertex();
    const newFace = new Face();
    const e = this.makeEdgeInternal(this.eHead);
    this.makeVertex(newVertex1, e, this.vHead);
    this.makeVertex(newVertex2, e.Sym, this.vHead);
    this.makeFace(newFace, e, this.fHead);
    return e;
  }

  // splice is the basic operation for changing the
  // mesh connectivity and topology.  It changes the mesh so that
  //  eOrg.Onext <- OLD(eDst.Onext)
  //  eDst.Onext <- OLD(eOrg.Onext)
  // where OLD(...) means the value before the splice operation.
  //
  // This can have two effects on the vertex structure:
  //  - if eOrg.Org != eDst.Org, the two vertices are merged together
  //  - if eOrg.Org == eDst.Org, the origin is split into two vertices
  // In both cases, eDst.Org is changed and eOrg.Org is untouched.
  //
  // Similarly (and independently) for the face structure:
  //  - if eOrg.Lface == eDst.Lface, one loop is split into two
  //  - if eOrg.Lface != eDst.Lface, two distinct loops are joined into one
  // In both cases, eDst.Lface is changed and eOrg.Lface is unaffected.
  //
  // Some special cases:
  // If eDst == eOrg, the operation has no effect.
  // If eDst == eOrg.Lnext, the new face will have a single edge.
  // If eDst == eOrg.Lprev, the old face will have a single edge.
  // If eDst == eOrg.Onext, the new vertex will have a single edge.
  // If eDst == eOrg.Oprev, the old vertex will have a single edge.
  splice(eOrg: HalfEdge, eDst: HalfEdge) {
    let joiningLoops = false;
    let joiningVertices = false;

    if (eOrg === eDst) return;

    if (eDst.Org !== eOrg.Org) {
      // We are merging two disjoint vertices -- destroy eDst.Org
      joiningVertices = true;
      this.killVertex(eDst.Org, eOrg.Org);
    }
    if (eDst.Lface !== eOrg.Lface) {
      // We are connecting two disjoint loops -- destroy eDst.Lface
      joiningLoops = true;
      this.killFace(eDst.Lface, eOrg.Lface);
    }

    // Change the edge structure
    this.spliceInternal(eDst, eOrg);

    if (!joiningVertices) {
      const newVertex = new Vertex();

      // We split one vertex into two -- the new vertex is eDst.Org.
      // Make sure the old vertex points to a valid half-edge.
      this.makeVertex(newVertex, eDst, eOrg.Org);
      eOrg.Org.anEdge = eOrg;
    }
    if (!joiningLoops) {
      const newFace = new Face();

      // We split one loop into two -- the new loop is eDst.Lface.
      // Make sure the old face points to a valid half-edge.
      this.makeFace(newFace, eDst, eOrg.Lface);
      eOrg.Lface.anEdge = eOrg;
    }
  }

  // delete removes the edge eDel.  There are several cases:
  // if (eDel.Lface != eDel.Sym.Lface), we join two loops into one; the loop
  // eDel.Lface is deleted.  Otherwise, we are splitting one loop into two;
  // the newly created loop will contain eDel.Sym.Org.  If the deletion of eDel
  // would create isolated vertices, those are deleted as well.
  //
  delete(eDel: HalfEdge) {
    const eDelSym = eDel.Sym;
    let joiningLoops = false;

    // First step: disconnect the origin vertex eDel.Org.  We make all
    // changes to get a consistent mesh in this "intermediate" state.
    if (eDel.Lface !== eDel.Sym.Lface) {
      // We are joining two loops into one -- remove the left face
      joiningLoops = true;
      this.killFace(eDel.Lface, eDel.Sym.Lface);
    }

    if (eDel.Onext === eDel) {
      this.killVertex(eDel.Org, null);
    } else {
      // Make sure that eDel.Org and eDel.Sym.Lface point to valid half-edges
      eDel.Sym.Lface.anEdge = eDel.Sym.Lnext;
      eDel.Org.anEdge = eDel.Onext;

      this.spliceInternal(eDel, eDel.Sym.Lnext);
      if (!joiningLoops) {
        const newFace = new Face();

        // We are splitting one loop into two -- create a new loop for eDel.
        this.makeFace(newFace, eDel, eDel.Lface);
      }
    }

    // Claim: the mesh is now in a consistent state, except that eDel.Org
    // may have been deleted.  Now we disconnect eDel.Sym.Org.
    if (eDelSym.Onext === eDelSym) {
      this.killVertex(eDelSym.Org, null);
      this.killFace(eDelSym.Lface, null);
    } else {
      // Make sure that eDel.Sym.Org and eDel.Lface point to valid half-edges
      eDel.Lface.anEdge = eDelSym.Sym.Lnext;
      eDelSym.Org.anEdge = eDelSym.Onext;
      this.spliceInternal(eDelSym, eDelSym.Sym.Lnext);
    }

    // Any isolated vertices or faces have already been freed.
    this.killEdge(eDel);
  }

  // Other edge operations

  // All these routines can be implemented with the basic edge
  // operations above.  They are provided for convenience and efficiency.

  // addEdgeVertex creates a new edge eNew such that
  // eNew == eOrg.Lnext, and eNew.Sym.Org is a newly created vertex.
  // eOrg and eNew will have the same left face.
  addEdgeVertex(eOrg: HalfEdge) {
    const eNew = this.makeEdgeInternal(eOrg);
    const eNewSym = eNew.Sym;

    // Connect the new edge appropriately
    this.spliceInternal(eNew, eOrg.Lnext);

    // Set the vertex and face information
    eNew.Org = eOrg.Sym.Org;

    const newVertex = new Vertex();
    this.makeVertex(newVertex, eNewSym, eNew.Org);

    eNew.Lface = eNewSym.Lface = eOrg.Lface;

    return eNew;
  }

  // splitEdge splits eOrg into two edges eOrg and eNew,
  // such that eNew == eOrg.Lnext.  The new vertex is eOrg.Sym.Org == eNew.Org.
  // eOrg and eNew will have the same left face.
  splitEdge(eOrg: HalfEdge) {
    const tempHalfEdge = this.addEdgeVertex(eOrg);
    const eNew = tempHalfEdge.Sym;

    // Disconnect eOrg from eOrg.Sym.Org and connect it to eNew.Org
    this.spliceInternal(eOrg.Sym, eOrg.Sym.Sym.Lnext);
    this.spliceInternal(eOrg.Sym, eNew);

    // Set the vertex and face information
    eOrg.Sym.Org = eNew.Org;
    eNew.Sym.Org.anEdge = eNew.Sym; // may have pointed to eOrg.Sym
    eNew.Sym.Lface = eOrg.Sym.Lface;
    eNew.winding = eOrg.winding; // copy old winding information
    eNew.Sym.winding = eOrg.Sym.winding;

    return eNew;
  }

  // connect creates a new edge from eOrg.Sym.Org
  // to eDst.Org, and returns the corresponding half-edge eNew.
  // If eOrg.Lface == eDst.Lface, this splits one loop into two,
  // and the newly created loop is eNew.Lface.  Otherwise, two disjoint
  // loops are merged into one, and the loop eDst.Lface is destroyed.
  //
  // If (eOrg == eDst), the new face will have only two edges.
  // If (eOrg.Lnext == eDst), the old face is reduced to a single edge.
  // If (eOrg.Lnext.Lnext == eDst), the old face is reduced to two edges.
  connect(eOrg: HalfEdge, eDst: HalfEdge) {
    let joiningLoops = false;
    const eNew = this.makeEdgeInternal(eOrg);
    const eNewSym = eNew.Sym;

    if (eDst.Lface !== eOrg.Lface) {
      // We are connecting two disjoint loops -- destroy eDst.Lface
      joiningLoops = true;
      this.killFace(eDst.Lface, eOrg.Lface);
    }

    // Connect the new edge appropriately
    this.spliceInternal(eNew, eOrg.Lnext);
    this.spliceInternal(eNewSym, eDst);

    // Set the vertex and face information
    eNew.Org = eOrg.Sym.Org;
    eNewSym.Org = eDst.Org;
    eNew.Lface = eNewSym.Lface = eOrg.Lface;

    // Make sure the old face points to a valid half-edge
    eOrg.Lface.anEdge = eNewSym;

    if (!joiningLoops) {
      const newFace = new Face();
      // We split one loop into two -- the new loop is eNew.Lface
      this.makeFace(newFace, eNew, eOrg.Lface);
    }
    return eNew;
  }

  // zapFace destroys a face and removes it from the
  // global face list.  All edges of fZap will have a null pointer as their
  // left face.  Any edges which also have a null pointer as their right face
  // are deleted entirely (along with any isolated vertices this produces).
  // An entire mesh can be deleted by zapping its faces, one at a time,
  // in any order.  Zapped faces cannot be used in further mesh operations!
  zapFace(fZap: Face) {
    const eStart = fZap.anEdge;
    let e, eNext, eSym;
    let fPrev, fNext;

    // walk around face, deleting edges whose right face is also null
    eNext = eStart.Lnext;
    do {
      e = eNext;
      eNext = e.Lnext;

      e.Lface = null;
      if (e.Sym.Lface === null) {
        // delete the edge -- see delete() method above

        if (e.Onext === e) {
          this.killVertex(e.Org, null);
        } else {
          // Make sure that e.Org points to a valid half-edge
          e.Org.anEdge = e.Onext;
          this.spliceInternal(e, e.Sym.Lnext);
        }
        eSym = e.Sym;
        if (eSym.Onext === eSym) {
          this.killVertex(eSym.Org, null);
        } else {
          // Make sure that eSym.Org points to a valid half-edge
          eSym.Org.anEdge = eSym.Onext;
          this.spliceInternal(eSym, eSym.Sym.Lnext);
        }
        this.killEdge(e);
      }
    } while (e != eStart);

    // delete from circular doubly-linked list
    fPrev = fZap.prev;
    fNext = fZap.next;
    fNext.prev = fPrev;
    fPrev.next = fNext;
  }

  countFaceVerts(f: Face) {
    let eCur = f.anEdge;
    let n = 0;
    do {
      n++;
      eCur = eCur.Lnext;
    } while (eCur !== f.anEdge);
    return n;
  }

  // mergeConvexFaces removed - not in libtess.js, adds overhead, not tested

  // check checks a mesh for self-consistency (from original libtess)
  check() {
    // In production builds `DEBUG` is false and assertions are stripped.
    // Without this guard, the check loops still run and become pure overhead.
    if (!DEBUG) return;

    const fHead = this.fHead;
    const vHead = this.vHead;
    const eHead = this.eHead;
    let f, fPrev, v, vPrev, e, ePrev;

    fPrev = fHead;
    for (fPrev = fHead; (f = fPrev.next) !== fHead; fPrev = f) {
      assert(f.prev === fPrev);
      e = f.anEdge;
      do {
        assert(e.Sym !== e);
        assert(e.Sym.Sym === e);
        assert(e.Lnext.Onext.Sym === e);
        assert(e.Onext.Sym.Lnext === e);
        assert(e.Lface === f);
        e = e.Lnext;
      } while (e !== f.anEdge);
    }
    assert(f.prev === fPrev && f.anEdge === null);

    vPrev = vHead;
    for (vPrev = vHead; (v = vPrev.next) !== vHead; vPrev = v) {
      assert(v.prev === vPrev);
      e = v.anEdge;
      do {
        assert(e.Sym !== e);
        assert(e.Sym.Sym === e);
        assert(e.Lnext.Onext.Sym === e);
        assert(e.Onext.Sym.Lnext === e);
        assert(e.Org === v);
        e = e.Onext;
      } while (e !== v.anEdge);
    }
    assert(v.prev === vPrev && v.anEdge === null);

    ePrev = eHead;
    for (ePrev = eHead; (e = ePrev.next) !== eHead; ePrev = e) {
      assert(e.Sym.next === ePrev.Sym);
      assert(e.Sym !== e);
      assert(e.Sym.Sym === e);
      assert(e.Org !== null);
      assert(e.Sym.Org !== null);
      assert(e.Lnext.Onext.Sym === e);
      assert(e.Onext.Sym.Lnext === e);
    }
    assert(
      e.Sym.next === ePrev.Sym &&
        e.Sym === this.eHeadSym &&
        e.Sym.Sym === e &&
        e.Org === null
    );
  }
}
