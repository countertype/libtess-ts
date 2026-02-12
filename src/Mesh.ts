// Half-edge mesh data structure

import { assert, DEBUG } from './Assert';
import { V3 } from './types';

// DictNode doubles as the sweep-line active region, which avoids
// the node->key->region indirection chain
export class DictNode {
  next!: DictNode;
  prev!: DictNode;
  eUp: HalfEdge = null!; // null on sentinel head; always set on active regions
  windingNumber: number = 0;
  inside: boolean = false;
  sentinel: boolean = false;
  dirty: boolean = false;
  fixUpperEdge: boolean = false;
}

export class HalfEdge {
  next!: HalfEdge;
  Org!: Vertex;
  Sym!: HalfEdge;
  Onext!: HalfEdge;
  Lnext!: HalfEdge;
  Lface!: Face;
  activeRegion: DictNode | null = null;
  winding: number = 0;
}

export class Vertex {
  next!: Vertex;
  prev!: Vertex;
  anEdge!: HalfEdge;
  coords: V3 = [0, 0, 0];
  s: number = 0.0;
  t: number = 0.0;
  pqHandle: number = 0;
  data: unknown = null;
}

export class Face {
  next!: Face;
  prev!: Face;
  anEdge!: HalfEdge;
  inside: boolean = false;
}

// The mesh operations below have three motivations: completeness,
// convenience, and efficiency. The basic mesh operations are makeEdge,
// splice, and delete. All the other edge operations can be implemented
// in terms of these. The other operations are provided for convenience
// and/or efficiency
//
// When a face is split or a vertex is added, they are inserted into the
// global list *before* the existing vertex or face (ie. e.Org or e.Lface).
// This makes it easier to process all vertices or faces in the global lists
// without worrying about processing the same data twice. As a convenience,
// when a face is split, the "inside" flag is copied from the old face.
// Other internal data (v.data, v.activeRegion, f.data, f.marked,
// f.trail, e.winding) is set to zero
//
// makeEdge() creates one edge, two vertices, and a loop (face).
// The loop consists of the two new half-edges
//
// splice(eOrg, eDst) is the basic operation for changing the
// mesh connectivity and topology. It changes the mesh so that
//  eOrg.Onext <- OLD(eDst.Onext)
//  eDst.Onext <- OLD(eOrg.Onext)
// where OLD(...) means the value before the splice operation
//
// This can have two effects on the vertex structure:
//  - if eOrg.Org != eDst.Org, the two vertices are merged together
//  - if eOrg.Org == eDst.Org, the origin is split into two vertices
// In both cases, eDst.Org is changed and eOrg.Org is untouched
//
// Similarly (and independently) for the face structure:
//  - if eOrg.Lface == eDst.Lface, one loop is split into two
//  - if eOrg.Lface != eDst.Lface, two distinct loops are joined into one
// In both cases, eDst.Lface is changed and eOrg.Lface is unaffected
//
// delete(eDel) removes the edge eDel. There are several cases:
// if (eDel.Lface != eDel.Sym.Lface), we join two loops into one; the loop
// eDel.Lface is deleted. Otherwise, we are splitting one loop into two;
// the newly created loop will contain eDel.Sym.Org. If the deletion of eDel
// would create isolated vertices, those are deleted as well
//
// addEdgeVertex(eOrg) creates a new edge eNew such that
// eNew == eOrg.Lnext, and eNew.Sym.Org is a newly created vertex.
// eOrg and eNew will have the same left face
//
// splitEdge(eOrg) splits eOrg into two edges eOrg and eNew,
// such that eNew == eOrg.Lnext. The new vertex is eOrg.Sym.Org == eNew.Org.
// eOrg and eNew will have the same left face
//
// connect(eOrg, eDst) creates a new edge from eOrg.Sym.Org
// to eDst.Org, and returns the corresponding half-edge eNew.
// If eOrg.Lface == eDst.Lface, this splits one loop into two,
// and the newly created loop is eNew.Lface. Otherwise, two disjoint
// loops are merged into one, and the loop eDst.Lface is destroyed
//
// zapFace(fZap) destroys a face and removes it from the
// global face list. All edges of fZap will have a null pointer as their
// left face. Any edges which also have a null pointer as their right face
// are deleted entirely (along with any isolated vertices this produces).
// An entire mesh can be deleted by zapping its faces, one at a time,
// in any order. Zapped faces cannot be used in further mesh operations
export class Mesh {
  vHead: Vertex;
  fHead: Face;
  eHead: HalfEdge;
  eHeadSym: HalfEdge;
  vertexCount: number = 0;

  constructor() {
    const v = new Vertex();
    const f = new Face();
    const e = new HalfEdge();
    const eSym = new HalfEdge();

    v.next = v.prev = v;

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

  // Create a new pair of half-edges which form their own loop
  private makeEdgeInternal(eNext: HalfEdge) {
    const e = new HalfEdge();
    const eSym = new HalfEdge();

    // Insert in circular doubly-linked list before eNext
    // (prev pointer is stored in Sym.next)
    const ePrev = eNext.Sym.next;
    eSym.next = ePrev;
    ePrev.Sym.next = e;
    e.next = eNext;
    eNext.Sym.next = eSym;

    e.Sym = eSym;
    e.Onext = e;
    e.Lnext = eSym;
    e.winding = 0;
    e.activeRegion = null;

    eSym.Sym = e;
    eSym.Onext = eSym;
    eSym.Lnext = e;
    eSym.winding = 0;
    eSym.activeRegion = null;

    return e;
  }

  // Exchange a.Onext and b.Onext (see Guibas/Stolfi paper)
  private spliceInternal(a: HalfEdge, b: HalfEdge) {
    const aOnext = a.Onext;
    const bOnext = b.Onext;
    aOnext.Sym.Lnext = b;
    bOnext.Sym.Lnext = a;
    a.Onext = bOnext;
    b.Onext = aOnext;
  }

  // Attach a new vertex as the origin of all edges in eOrig's vertex loop
  private makeVertex(newVertex: Vertex, eOrig: HalfEdge, vNext: Vertex) {
    const vNew = newVertex;

    const vPrev = vNext.prev;
    vNew.prev = vPrev;
    vPrev.next = vNew;
    vNew.next = vNext;
    vNext.prev = vNew;

    vNew.anEdge = eOrig;
    ++this.vertexCount;

    let e = eOrig;
    do {
      e.Org = vNew;
      e = e.Onext;
    } while (e !== eOrig);
  }

  // Attach a new face as the left face of all edges in eOrig's face loop
  private makeFace(newFace: Face, eOrig: HalfEdge, fNext: Face) {
    const fNew = newFace;

    const fPrev = fNext.prev;
    fNew.prev = fPrev;
    fPrev.next = fNew;
    fNew.next = fNext;
    fNext.prev = fNew;

    fNew.anEdge = eOrig;
    fNew.inside = fNext.inside;

    let e = eOrig;
    do {
      e.Lface = fNew;
      e = e.Lnext;
    } while (e !== eOrig);
  }

  // Destroy an edge (both half-edges) and remove from the global edge list
  private killEdge(eDel: HalfEdge) {
    const eNext = eDel.next;
    const ePrev = eDel.Sym.next;
    eNext.Sym.next = ePrev;
    ePrev.Sym.next = eNext;
  }

  // Destroy a vertex and update its edge loop to point to newOrg
  // newOrg is null when the vertex is being destroyed (edges are about to be killed)
  private killVertex(vDel: Vertex, newOrg: Vertex | null) {
    const eStart = vDel.anEdge;
    let e = eStart;
    do {
      e.Org = newOrg!;
      e = e.Onext;
    } while (e !== eStart);

    const vPrev = vDel.prev;
    const vNext = vDel.next;
    vNext.prev = vPrev;
    vPrev.next = vNext;
    --this.vertexCount;
  }

  // newLface is null when the face is being destroyed (edges are about to be killed)
  private killFace(fDel: Face, newLface: Face | null) {
    const eStart = fDel.anEdge;

    let e = eStart;
    do {
      e.Lface = newLface!;
      e = e.Lnext;
    } while (e !== eStart);

    const fPrev = fDel.prev;
    const fNext = fDel.next;
    fNext.prev = fPrev;
    fPrev.next = fNext;
  }

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

  splice(eOrg: HalfEdge, eDst: HalfEdge) {
    let joiningLoops = false;
    let joiningVertices = false;

    if (eOrg === eDst) return;

    if (eDst.Org !== eOrg.Org) {
      joiningVertices = true;
      this.killVertex(eDst.Org, eOrg.Org);
    }
    if (eDst.Lface !== eOrg.Lface) {
      joiningLoops = true;
      this.killFace(eDst.Lface, eOrg.Lface);
    }

    this.spliceInternal(eDst, eOrg);

    if (!joiningVertices) {
      const newVertex = new Vertex();
      this.makeVertex(newVertex, eDst, eOrg.Org);
      eOrg.Org.anEdge = eOrg;
    }
    if (!joiningLoops) {
      const newFace = new Face();
      this.makeFace(newFace, eDst, eOrg.Lface);
      eOrg.Lface.anEdge = eOrg;
    }
  }

  delete(eDel: HalfEdge) {
    const eDelSym = eDel.Sym;
    let joiningLoops = false;

    if (eDel.Lface !== eDel.Sym.Lface) {
      joiningLoops = true;
      this.killFace(eDel.Lface, eDel.Sym.Lface);
    }

    if (eDel.Onext === eDel) {
      this.killVertex(eDel.Org, null);
    } else {
      eDel.Sym.Lface.anEdge = eDel.Sym.Lnext;
      eDel.Org.anEdge = eDel.Onext;

      this.spliceInternal(eDel, eDel.Sym.Lnext);
      if (!joiningLoops) {
        const newFace = new Face();
        this.makeFace(newFace, eDel, eDel.Lface);
      }
    }

    if (eDelSym.Onext === eDelSym) {
      this.killVertex(eDelSym.Org, null);
      this.killFace(eDelSym.Lface, null);
    } else {
      eDel.Lface.anEdge = eDelSym.Sym.Lnext;
      eDelSym.Org.anEdge = eDelSym.Onext;
      this.spliceInternal(eDelSym, eDelSym.Sym.Lnext);
    }

    this.killEdge(eDel);
  }

  addEdgeVertex(eOrg: HalfEdge) {
    const eNew = this.makeEdgeInternal(eOrg);
    const eNewSym = eNew.Sym;

    this.spliceInternal(eNew, eOrg.Lnext);

    eNew.Org = eOrg.Sym.Org;

    const newVertex = new Vertex();
    this.makeVertex(newVertex, eNewSym, eNew.Org);

    eNew.Lface = eNewSym.Lface = eOrg.Lface;

    return eNew;
  }

  splitEdge(eOrg: HalfEdge) {
    const tempHalfEdge = this.addEdgeVertex(eOrg);
    const eNew = tempHalfEdge.Sym;

    this.spliceInternal(eOrg.Sym, eOrg.Sym.Sym.Lnext);
    this.spliceInternal(eOrg.Sym, eNew);

    eOrg.Sym.Org = eNew.Org;
    eNew.Sym.Org.anEdge = eNew.Sym;
    eNew.Sym.Lface = eOrg.Sym.Lface;
    eNew.winding = eOrg.winding;
    eNew.Sym.winding = eOrg.Sym.winding;

    return eNew;
  }

  connect(eOrg: HalfEdge, eDst: HalfEdge) {
    let joiningLoops = false;
    const eNew = this.makeEdgeInternal(eOrg);
    const eNewSym = eNew.Sym;

    if (eDst.Lface !== eOrg.Lface) {
      joiningLoops = true;
      this.killFace(eDst.Lface, eOrg.Lface);
    }

    this.spliceInternal(eNew, eOrg.Lnext);
    this.spliceInternal(eNewSym, eDst);

    eNew.Org = eOrg.Sym.Org;
    eNewSym.Org = eDst.Org;
    eNew.Lface = eNewSym.Lface = eOrg.Lface;

    eOrg.Lface.anEdge = eNewSym;

    if (!joiningLoops) {
      const newFace = new Face();
      this.makeFace(newFace, eNew, eOrg.Lface);
    }
    return eNew;
  }

  zapFace(fZap: Face) {
    const eStart = fZap.anEdge;
    let e, eNext, eSym;
    let fPrev, fNext;

    eNext = eStart.Lnext;
    do {
      e = eNext;
      eNext = e.Lnext;

      e.Lface = null!;
      if (!(e.Sym.Lface as Face | null)) {
        if (e.Onext === e) {
          this.killVertex(e.Org, null);
        } else {
          e.Org.anEdge = e.Onext;
          this.spliceInternal(e, e.Sym.Lnext);
        }
        eSym = e.Sym;
        if (eSym.Onext === eSym) {
          this.killVertex(eSym.Org, null);
        } else {
          eSym.Org.anEdge = eSym.Onext;
          this.spliceInternal(eSym, eSym.Sym.Lnext);
        }
        this.killEdge(e);
      }
    } while (e != eStart);

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

  // Mesh self-consistency check (only runs when DEBUG is true)
  check() {
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
    assert(f.prev === fPrev && !f.anEdge); // sentinel face has no edge

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
    assert(v.prev === vPrev && !v.anEdge); // sentinel vertex has no edge

    ePrev = eHead;
    for (ePrev = eHead; (e = ePrev.next) !== eHead; ePrev = e) {
      assert(e.Sym.next === ePrev.Sym);
      assert(e.Sym !== e);
      assert(e.Sym.Sym === e);
      assert(e.Org);
      assert(e.Sym.Org);
      assert(e.Lnext.Onext.Sym === e);
      assert(e.Onext.Sym.Lnext === e);
    }
    assert(e.Sym.next === ePrev.Sym && e.Sym === this.eHeadSym && e.Sym.Sym === e && !e.Org); // sentinel
  }
}
