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

import { WINDING, ELEMENT, V3, V2, CombineCallback } from "./types";
import { Mesh, Face, HalfEdge, Vertex } from "./Mesh";
import { Geom } from "./Geom";
import { Sweep } from "./Sweep";
import * as Normal from "./Normal";
import { TessMono } from "./TessMono";
import { PriorityQ } from "./PriorityQ"; // 2-structure wrapper (sorted + heap)
import { Dict } from "./Dict";
import { DEBUG } from "./Assert";
import { renderMesh, renderBoundary, collectArrayOutput, setWindingNumber } from "./Render";

/* The begin/end calls must be properly nested. We keep track of
 * the current state to enforce the ordering.
 */
enum TessState {
  T_DORMANT,
  T_IN_POLYGON,
  T_IN_CONTOUR
}

type Edge = any;

export class Tessellator {
  // *** state needed for collecting the input data ***
  
  // what begin/end calls have we seen?
  private state: TessState = TessState.T_DORMANT;
  
  // lastEdge->Org is the most recent vertex
  private lastEdge: HalfEdge | null = null;
  
  // stores the input contours, and eventually the tessellation itself
  mesh: Mesh | null = null;

  // *** state needed for projecting onto the sweep plane ***
  
  normal: V3 = [0, 0, 0]; // user-specified normal (if provided) - only array allocated in constructor
  sUnit!: V3; // allocated in projectPolygon
  tUnit!: V3; // allocated in projectPolygon

  bmin!: V2; // allocated in projectPolygon
  bmax!: V2; // allocated in projectPolygon

  // *** state needed for the line sweep ***
  
  windingRule = WINDING.ODD; // rule for determining polygon interior

  dict!: Dict; // edge dictionary for sweep line
  pq: PriorityQ | null = null; // priority queue of vertex events
  event!: Vertex; // current sweep event being processed

  vertexIndexCounter: number = 0;

  // *** callbacks (OpenGL-compatible) ***
  private beginCallback?: (type: number, polygonData?: unknown) => void;
  private vertexCallback?: (data: unknown, polygonData?: unknown) => void;
  private endCallback?: (polygonData?: unknown) => void;
  private edgeFlagCallback?: (flag: boolean, polygonData?: unknown) => void;
  onCombine?: CombineCallback;
  
  // polygon data passed through callbacks (for _DATA variants)
  private polygonData: unknown = null;
  
  // gluTessCallback - OpenGL-compatible callback registration
  gluTessCallback(which: number, fn?: Function): void {
    const callback = fn || null;
    
    switch (which) {
      case 100100: // GLU_TESS_BEGIN
      case 100106: // GLU_TESS_BEGIN_DATA
        this.beginCallback = callback as any;
        break;
      case 100104: // GLU_TESS_EDGE_FLAG
      case 100110: // GLU_TESS_EDGE_FLAG_DATA
        this.edgeFlagCallback = callback as any;
        break;
      case 100101: // GLU_TESS_VERTEX
      case 100107: // GLU_TESS_VERTEX_DATA
        this.vertexCallback = callback as any;
        break;
      case 100102: // GLU_TESS_END
      case 100108: // GLU_TESS_END_DATA
        this.endCallback = callback as any;
        break;
      case 100105: // GLU_TESS_COMBINE
      case 100111: // GLU_TESS_COMBINE_DATA
        this.onCombine = callback as any;
        break;
    }
  }
  
  // Convenience alias for simpler API
  setCallback(which: number, fn?: Function): void {
    // 0=begin, 1=edgeFlag, 2=vertex, 3=end, 4=combine
    const mapping = [100100, 100104, 100101, 100102, 100105];
    this.gluTessCallback(mapping[which], fn);
  }
  
  // Internal callback invokers (match libtess.js)
  private callBeginCallback(type: number): void {
    if (this.beginCallback) {
      this.beginCallback(type, this.polygonData);
    }
  }
  
  private callVertexCallback(data: unknown): void {
    if (this.vertexCallback) {
      this.vertexCallback(data, this.polygonData);
    }
  }
  
  private callEndCallback(): void {
    if (this.endCallback) {
      this.endCallback(this.polygonData);
    }
  }
  
  private callEdgeFlagCallback(flag: boolean): void {
    if (this.edgeFlagCallback) {
      this.edgeFlagCallback(flag, this.polygonData);
    }
  }
  
  // *** rendering configuration (for endPolygon) ***
  elementType: ELEMENT = ELEMENT.POLYGONS;
  polySize: number = 3;
  vertexSize: 2 | 3 = 2;
  boundaryOnly: boolean = false;
  flagBoundary: boolean = false;

  // Determine the polygon normal and project vertices onto the plane
  // of the polygon.
  projectPolygon() {
    let v,
      vHead = this.mesh.vHead;
    let norm: V3 = [0, 0, 0];
    let sUnit, tUnit;
    let computedNormal = false;

    norm[0] = this.normal[0];
    norm[1] = this.normal[1];
    norm[2] = this.normal[2];

    if (!norm[0] && !norm[1] && !norm[2]) {
      Normal.computeNormal(this.mesh, norm);
      computedNormal = true;
    }

    // Allocate on first use
    if (!this.sUnit) this.sUnit = [0, 0, 0];
    if (!this.tUnit) this.tUnit = [0, 0, 0];
    if (!this.bmin) this.bmin = [0, 0];
    if (!this.bmax) this.bmax = [0, 0];
    
    sUnit = this.sUnit;
    tUnit = this.tUnit;

    let axis = Normal.longAxis(norm);

    // Project perpendicular to a coordinate axis -- better numerically
    sUnit[axis] = 0;
    sUnit[(axis + 1) % 3] = 1.0;
    sUnit[(axis + 2) % 3] = 0.0;

    tUnit[axis] = 0;
    tUnit[(axis + 1) % 3] = 0.0;
    tUnit[(axis + 2) % 3] = norm[axis] > 0 ? 1.0 : -1.0;

    // Project the vertices onto the sweep plane
    for (let v = vHead.next!; v !== vHead; v = v!.next!) {
      v.s = Normal.dot(v.coords, sUnit);
      v.t = Normal.dot(v.coords, tUnit);
    }

    if (computedNormal) {
      Normal.checkOrientation(this.mesh, this.tUnit);
    }

    // Compute ST bounds.
    let first = true;

    for (let v = vHead.next; v !== vHead; v = v!.next!) {
      if (first) {
        this.bmin[0] = this.bmax[0] = v!.s;
        this.bmin[1] = this.bmax[1] = v!.t;

        first = false;
      } else {
        if (v!.s! < this.bmin[0]) this.bmin[0] = v!.s;
        if (v!.s! > this.bmax[0]) this.bmax[0] = v!.s;
        if (v!.t! < this.bmin[1]) this.bmin[1] = v!.t;
        if (v!.t! > this.bmax[1]) this.bmax[1] = v!.t;
      }
    }
  }



  // =============================================================================
  // C-STYLE API (OpenGL gluTess* compatible)
  // =============================================================================

  // void GLAPI gluTessBeginPolygon( GLUtesselator *tess, void *data )
  beginPolygon(data?: unknown): void {
    if (this.state !== TessState.T_DORMANT) {
      throw new Error('beginPolygon called while already in polygon');
    }

    this.state = TessState.T_IN_POLYGON;
    this.mesh = null;
    this.polygonData = data;
  }

  // void GLAPI gluTessBeginContour( GLUtesselator *tess )
  beginContour(): void {
    if (this.state !== TessState.T_IN_POLYGON) {
      throw new Error('beginContour must be called after beginPolygon');
    }

    this.state = TessState.T_IN_CONTOUR;
    this.lastEdge = null;
  }

  // void GLAPI gluTessVertex( GLUtesselator *tess, GLdouble coords[3], void *data )
  addVertex(coords: [number, number] | [number, number, number], data?: unknown): void {
    if (this.state !== TessState.T_IN_CONTOUR) {
      throw new Error('addVertex must be called between beginContour and endContour');
    }

    if (this.mesh === null) {
      this.mesh = new Mesh();
    }

    let e = this.lastEdge;
    
    if (e === null) {
      // Make a self-loop (one vertex, one edge)
      e = this.mesh.makeEdge();
      this.mesh.splice(e, e.Sym);
    } else {
      // Create a new vertex and edge which immediately follow e
      // in the ordering around the left face
      this.mesh.splitEdge(e);
      e = e.Lnext!;
    }

    // The new vertex is now e->Org
    e.Org.data = data || null;
    e.Org.coords[0] = coords[0];
    e.Org.coords[1] = coords[1];
    e.Org.coords[2] = coords.length > 2 ? coords[2] : 0.0;
    
    // The winding of an edge says how the winding number changes as we
    // cross from the edge's right face to its left face. We add the
    // vertices in such an order that a CCW contour will add +1 to
    // the winding number of the region inside the contour
    e.winding = 1;
    e.Sym.winding = -1;

    this.lastEdge = e;
  }

  // void GLAPI gluTessEndContour( GLUtesselator *tess )
  endContour(): void {
    if (this.state !== TessState.T_IN_CONTOUR) {
      throw new Error('endContour called without matching beginContour');
    }
    this.state = TessState.T_IN_POLYGON;
  }

  // void GLAPI gluTessEndPolygon( GLUtesselator *tess )
  endPolygon(): void {
    if (this.state !== TessState.T_IN_POLYGON) {
      throw new Error('endPolygon called without matching beginPolygon');
    }
    this.state = TessState.T_DORMANT;

    if (this.mesh === null) {
      this.mesh = new Mesh();
    }

    // Determine the polygon normal and project vertices onto the plane
    // of the polygon
    this.projectPolygon();

    // __gl_computeInterior( tess ) computes the planar arrangement specified
    // by the given contours, and further subdivides this arrangement
    // into regions. Each region is marked "inside" if it belongs
    // to the polygon, according to the rule given by tess->windingRule.
    // Each interior region is guaranteed be monotone
    Sweep.computeInterior(this, true);

    const mesh = this.mesh;

    // If the user wants only the boundary contours, we throw away all edges
    // except those which separate the interior from the exterior.
    // Otherwise we tessellate all the regions marked "inside"
    if (this.boundaryOnly || this.elementType === ELEMENT.BOUNDARY_CONTOURS) {
      setWindingNumber(mesh, 1, true);
    } else {
      TessMono.tessellateInterior(mesh);
    }

    // mesh.check() disabled for production performance
    if (false) {
      mesh.check();
    }

    // Render mesh via callbacks (OpenGL-compatible)
    if (this.boundaryOnly) {
      renderBoundary(this, mesh);
    } else {
      renderMesh(this, mesh, this.flagBoundary);
    }
  }

}
