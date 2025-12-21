/**
 * Render.ts - Callback-based rendering (OpenGL-compatible)
 * Based on libtess.js render.js (simplified from Veach's render.c)
 * 
 * Veach's original render.c optimizes for triangle fans/strips.
 * libtess.js simplified to just GL_TRIANGLES for consistency.
 * We follow libtess.js pattern for compatibility.
 */

import { Mesh, Face, HalfEdge, Vertex } from './Mesh';

const GL_TRIANGLES = 4;
const GL_LINE_LOOP = 2;

/**
 * Set winding numbers on edges for boundary extraction
 * Called when user wants BOUNDARY_CONTOURS
 */
export function setWindingNumber(mesh: Mesh, value: number, keepOnlyBoundary: boolean): void {
  let eNext: HalfEdge | null;
  
  for (let e: HalfEdge | null = mesh.eHead.next; e !== mesh.eHead; e = eNext) {
    eNext = e!.next;
    if (e!.Sym!.Lface!.inside !== e!.Lface!.inside) {
      // This is a boundary edge (one side is interior, one is exterior)
      e!.winding = e!.Lface!.inside ? value : -value;
    } else {
      // Both regions are interior, or both are exterior
      if (!keepOnlyBoundary) {
        e!.winding = 0;
      } else {
        mesh.delete(e!);
      }
    }
  }
}

/**
 * __gl_renderMesh (simplified version from libtess.js)
 * Walks mesh and invokes callbacks for each triangle
 */
export function renderMesh(
  tess: any,
  mesh: Mesh, 
  flagEdges: boolean
): void {
  let beginCallbackCalled = false;
  let edgeState = -1;
  
  // Walk faces backwards to match libtess.js/original triangle order
  for (let f: Face | null = mesh.fHead.prev; f !== mesh.fHead; f = f!.prev) {
    if (!f!.inside) continue;
    
    // Call begin callback once (GL_TRIANGLES)
    if (!beginCallbackCalled) {
      tess.callBeginCallback(GL_TRIANGLES);
      beginCallbackCalled = true;
    }
    
    // Loop once for each edge (there will always be 3 edges after TessMono)
    let e: HalfEdge | null = f!.anEdge;
    do {
      if (flagEdges) {
        // Set the "edge state" to true just before we output the
        // first vertex of each edge on the polygon boundary
        const newState = (!e!.Sym || !e!.Sym.Lface || !e!.Sym.Lface.inside) ? 1 : 0;
        if (edgeState !== newState) {
          edgeState = newState;
          tess.callEdgeFlagCallback(!!edgeState);
        }
      }
      
      // Emit vertex
      tess.callVertexCallback(e!.Org!.data);
      
      e = e!.Lnext;
    } while (e !== f!.anEdge);
  }
  
  // Only call end callback if begin was called
  if (beginCallbackCalled) {
    tess.callEndCallback();
  }
}

/**
 * __gl_renderBoundary
 * Output boundary contours as LINE_LOOPs
 */
export function renderBoundary(tess: any, mesh: Mesh): void {
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

/**
 * Helper to collect mesh output into arrays for tests
 * Creates a mapping of vertices and extracts data
 */
export function collectArrayOutput(
  mesh: Mesh,
  vertexSize: number
): { vertices: number[], vertexIndices: number[], vertexCount: number, elements: number[], elementCount: number, vertexData: unknown[] } {
  
  // Assign indices to vertices
  let vertexIdx = 0;
  for (let v: Vertex | null = mesh.vHead.next; v !== mesh.vHead; v = v!.next) {
    (v as any).outputIndex = vertexIdx++;
  }
  
  const vertexCount = vertexIdx;
  const vertices = new Array(vertexCount * vertexSize);
  const vertexIndices = new Array(vertexCount);
  const vertexData: unknown[] = [];
  
  // Fill vertex arrays
  for (let v: Vertex | null = mesh.vHead.next; v !== mesh.vHead; v = v!.next) {
    const idx = (v as any).outputIndex;
    vertices[idx * vertexSize + 0] = v!.coords[0];
    vertices[idx * vertexSize + 1] = v!.coords[1];
    if (vertexSize > 2) {
      vertices[idx * vertexSize + 2] = v!.coords[2];
    }
    vertexIndices[idx] = idx;
    if (v!.data !== null) {
      vertexData[idx] = v!.data;
    }
  }
  
  // Collect elements (triangle indices)
  const elements: number[] = [];
  let elementCount = 0;
  
  for (let f: Face | null = mesh.fHead.prev; f !== mesh.fHead; f = f!.prev) {
    if (!f!.inside) continue;
    
    let e: HalfEdge | null = f!.anEdge;
    do {
      elements.push((e!.Org as any).outputIndex);
      e = e!.Lnext;
    } while (e !== f!.anEdge);
    
    elementCount++;
  }
  
  return {
    vertices,
    vertexIndices,
    vertexCount,
    elements,
    elementCount,
    vertexData
  };
}
