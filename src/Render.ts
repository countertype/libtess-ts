// Callback-based rendering (OpenGL-compatible)
//
// Veach's original render.c optimizes for triangle fans/strips.
// libtess.js simplified to GL_TRIANGLES only; we follow that for compatibility

import { Mesh, Face, HalfEdge, Vertex } from './Mesh';
import { vertLeq } from './Geom';
import { TessCallbacks } from './types';

const GL_TRIANGLES = 4;
const GL_LINE_LOOP = 2;

// Fused monotone triangulation + rendering
//
// Walks every interior (monotone) face, triangulates with a stack algorithm
// (Garey et al. / de Berg et al.), and emits triangles directly through
// callbacks. The mesh is never modified -- no connect() calls, no allocations

// Scratch arrays reused across all faces and calls
let _verts: Vertex[] = [];
let _chain: Int8Array = new Int8Array(64);
let _merged: Int32Array = new Int32Array(64);
let _stack: Int32Array = new Int32Array(64);

function ensureTyped(n: number) {
  if (n > _chain.length) {
    const sz = n * 2;
    _chain = new Int8Array(sz);
    _merged = new Int32Array(sz);
    _stack = new Int32Array(sz);
  }
}

export function renderMonotoneDirect(tess: TessCallbacks, mesh: Mesh): void {
  let began = false;

  for (let f: Face | null = mesh.fHead.next; f !== mesh.fHead; f = f!.next) {
    if (!f!.inside) continue;

    if (!began) {
      tess.callBeginCallback(GL_TRIANGLES);
      began = true;
    }

    emitMonotoneFace(f!, tess);
  }

  if (began) {
    tess.callEndCallback();
  }
}

function emitTri(tess: TessCallbacks, a: Vertex, b: Vertex, c: Vertex) {
  // Ensure CCW winding via signed area
  const cross = a.s * (b.t - c.t) + b.s * (c.t - a.t) + c.s * (a.t - b.t);
  if (cross >= 0) {
    tess.callVertexCallback(a.data);
    tess.callVertexCallback(b.data);
    tess.callVertexCallback(c.data);
  } else {
    tess.callVertexCallback(a.data);
    tess.callVertexCallback(c.data);
    tess.callVertexCallback(b.data);
  }
}

function emitMonotoneFace(face: Face, tess: TessCallbacks): void {
  // Collect boundary vertices
  let n = 0;
  let e = face.anEdge;
  do {
    _verts[n++] = e.Org;
    e = e.Lnext;
  } while (e !== face.anEdge);

  if (n < 3) return;

  if (n === 3) {
    emitTri(tess, _verts[0], _verts[1], _verts[2]);
    return;
  }

  ensureTyped(n);

  // Find rightmost and leftmost vertices
  let rightIdx = 0;
  let leftIdx = 0;
  for (let i = 1; i < n; i++) {
    if (!vertLeq(_verts[i], _verts[rightIdx])) rightIdx = i;
    if (vertLeq(_verts[i], _verts[leftIdx])) leftIdx = i;
  }
  if (rightIdx === leftIdx) return;

  // Build merged right-to-left sequence with chain labels
  // Upper chain: forward  (rightIdx -> leftIdx)
  // Lower chain: backward (rightIdx -> leftIdx)
  let m = 0;
  _merged[m] = rightIdx;
  _chain[m] = 1;
  m++;

  let ui = (rightIdx + 1) % n;
  let li = (rightIdx + n - 1) % n;

  while (ui !== leftIdx || li !== leftIdx) {
    let takeUpper: boolean;
    if (ui === leftIdx) {
      takeUpper = false;
    } else if (li === leftIdx) {
      takeUpper = true;
    } else {
      takeUpper = !vertLeq(_verts[ui], _verts[li]);
    }

    if (takeUpper) {
      _merged[m] = ui;
      _chain[m] = 1;
      m++;
      ui = (ui + 1) % n;
    } else {
      _merged[m] = li;
      _chain[m] = 0;
      m++;
      li = (li + n - 1) % n;
    }
  }

  _merged[m] = leftIdx;
  _chain[m] = 1;
  m++;

  // Stack-based monotone triangulation
  let sp = 0;
  _stack[sp++] = 0;
  _stack[sp++] = 1;

  for (let j = 2; j < m - 1; j++) {
    if (_chain[j] !== _chain[_stack[sp - 1]]) {
      // Different chain: pop all, emit fan
      while (sp > 1) {
        const v = _stack[--sp];
        emitTri(tess, _verts[_merged[j]], _verts[_merged[v]], _verts[_merged[_stack[sp - 1]]]);
      }
      --sp;
      _stack[sp++] = j - 1;
      _stack[sp++] = j;
    } else {
      // Same chain: pop while diagonal is inside polygon
      let last = _stack[--sp];
      while (sp > 0) {
        const a = _verts[_merged[j]];
        const b = _verts[_merged[last]];
        const c = _verts[_merged[_stack[sp - 1]]];
        const cross = a.s * (b.t - c.t) + b.s * (c.t - a.t) + c.s * (a.t - b.t);
        const valid = _chain[j] === 1 ? cross <= 0 : cross >= 0;
        if (!valid) break;

        emitTri(tess, a, b, c);
        last = _stack[--sp];
      }
      _stack[sp++] = last;
      _stack[sp++] = j;
    }
  }

  // Last vertex (leftmost) connects to remaining stack
  while (sp > 1) {
    const v = _stack[--sp];
    emitTri(tess, _verts[_merged[m - 1]], _verts[_merged[v]], _verts[_merged[_stack[sp - 1]]]);
  }
}

// Set winding numbers on edges for boundary extraction
export function setWindingNumber(mesh: Mesh, value: number, keepOnlyBoundary: boolean): void {
  let eNext: HalfEdge | null;

  for (let e: HalfEdge | null = mesh.eHead.next; e !== mesh.eHead; e = eNext) {
    eNext = e!.next;
    if (e!.Sym!.Lface!.inside !== e!.Lface!.inside) {
      // Boundary edge (one side interior, one exterior)
      e!.winding = e!.Lface!.inside ? value : -value;
    } else {
      if (!keepOnlyBoundary) {
        e!.winding = 0;
      } else {
        mesh.delete(e!);
      }
    }
  }
}

// Walk mesh faces and invoke callbacks for each triangle
export function renderMesh(tess: TessCallbacks, mesh: Mesh, flagEdges: boolean): void {
  let beginCallbackCalled = false;
  let edgeState = -1;

  for (let f: Face | null = mesh.fHead.prev; f !== mesh.fHead; f = f!.prev) {
    if (!f!.inside) continue;

    if (!beginCallbackCalled) {
      tess.callBeginCallback(GL_TRIANGLES);
      beginCallbackCalled = true;
    }

    let e: HalfEdge | null = f!.anEdge;
    do {
      if (flagEdges) {
        const newState = !e!.Sym || !e!.Sym.Lface || !e!.Sym.Lface.inside ? 1 : 0;
        if (edgeState !== newState) {
          edgeState = newState;
          tess.callEdgeFlagCallback(!!edgeState);
        }
      }

      tess.callVertexCallback(e!.Org!.data);
      e = e!.Lnext;
    } while (e !== f!.anEdge);
  }

  if (beginCallbackCalled) {
    tess.callEndCallback();
  }
}

// Output boundary contours as LINE_LOOPs
export function renderBoundary(tess: TessCallbacks, mesh: Mesh): void {
  for (let f: Face | null = mesh.fHead.next; f !== mesh.fHead; f = f!.next) {
    if (!f!.inside) continue;

    tess.callBeginCallback(GL_LINE_LOOP);

    let e: HalfEdge | null = f!.anEdge;
    do {
      tess.callVertexCallback(e!.Org!.data);
      e = e!.Lnext;
    } while (e !== f!.anEdge);

    tess.callEndCallback();
  }
}
