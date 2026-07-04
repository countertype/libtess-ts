import { WINDING, GLU_TESS, V3, V2, CombineCallback } from './types';
import { Mesh, HalfEdge, Vertex } from './Mesh';
import { computeInterior } from './Sweep';
import * as Normal from './Normal';
import { TessMono } from './TessMono';
import { PriorityQ } from './PriorityQ';
import { Dict } from './Dict';
import { DEBUG } from './Assert';
import { renderMesh, renderBoundary as renderBoundaryMesh, setWindingNumber, renderMonotoneDirect } from './Render';

// The begin/end calls must be properly nested
enum TessState {
  T_DORMANT,
  T_IN_POLYGON,
  T_IN_CONTOUR
}

export class GluTesselator {
  private state: TessState = TessState.T_DORMANT;
  private lastEdge: HalfEdge | null = null;
  private hasNonZeroZ: boolean = false;

  // When the normal is known at vertex time (2D, Z-axis normal),
  // s/t are set inline so projectPolygon can skip its vertex loop
  private projDone: boolean = false;
  private projTMul: number = 1;
  private projMinS: number = 0;
  private projMaxS: number = 0;
  private projMinT: number = 0;
  private projMaxT: number = 0;

  mesh!: Mesh;
  normal_: V3 = [0, 0, 0];
  sUnit!: V3;
  tUnit!: V3;
  bmin!: V2;
  bmax!: V2;
  windingRule_ = WINDING.ODD;
  windingRuleRaw_: number = WINDING.ODD;
  dict!: Dict;
  pq!: PriorityQ;
  event!: Vertex;

  private beginCallback?: (type: number, polygonData?: unknown) => void;
  private vertexCallback?: (data: unknown, polygonData?: unknown) => void;
  private endCallback?: (polygonData?: unknown) => void;
  private edgeFlagCallback?: (flag: boolean, polygonData?: unknown) => void;
  private errorCallback?: (errorNumber: number) => void;
  private errorDataCallback?: (errorNumber: number, polygonData?: unknown) => void;
  onCombine_?: CombineCallback;
  meshCallback_?: (mesh: Mesh) => void;
  polygonData: unknown = null;
  noEmit_ = false;

  gluTessCallback(which: GLU_TESS.BEGIN | GLU_TESS.BEGIN_DATA, fn?: (type: number, polygonData?: unknown) => void): void;
  gluTessCallback(which: GLU_TESS.VERTEX | GLU_TESS.VERTEX_DATA, fn?: (data: unknown, polygonData?: unknown) => void): void;
  gluTessCallback(which: GLU_TESS.END | GLU_TESS.END_DATA, fn?: (polygonData?: unknown) => void): void;
  gluTessCallback(which: GLU_TESS.ERROR, fn?: (errorNumber: number) => void): void;
  gluTessCallback(which: GLU_TESS.ERROR_DATA, fn?: (errorNumber: number, polygonData?: unknown) => void): void;
  gluTessCallback(which: GLU_TESS.EDGE_FLAG | GLU_TESS.EDGE_FLAG_DATA, fn?: (flag: boolean, polygonData?: unknown) => void): void;
  gluTessCallback(which: GLU_TESS.COMBINE | GLU_TESS.COMBINE_DATA, fn?: CombineCallback): void;
  gluTessCallback(which: number, fn?: (...args: any[]) => any): void;
  gluTessCallback(which: number, fn?: (...args: any[]) => any): void {
    const callback = fn || null;

    switch (which) {
      case 100100: // GLU_TESS_BEGIN
      case 100106: // GLU_TESS_BEGIN_DATA
        this.beginCallback = callback as typeof this.beginCallback;
        break;
      case 100104: // GLU_TESS_EDGE_FLAG
      case 100110: // GLU_TESS_EDGE_FLAG_DATA
        this.edgeFlagCallback = callback as typeof this.edgeFlagCallback;
        this.flagBoundary = true;
        break;
      case 100101: // GLU_TESS_VERTEX
      case 100107: // GLU_TESS_VERTEX_DATA
        this.vertexCallback = callback as typeof this.vertexCallback;
        break;
      case 100102: // GLU_TESS_END
      case 100108: // GLU_TESS_END_DATA
        this.endCallback = callback as typeof this.endCallback;
        break;
      case 100103: // GLU_TESS_ERROR
        this.errorCallback = callback as typeof this.errorCallback;
        break;
      case 100109: // GLU_TESS_ERROR_DATA
        this.errorDataCallback = callback as typeof this.errorDataCallback;
        break;
      case 100105: // GLU_TESS_COMBINE
      case 100111: // GLU_TESS_COMBINE_DATA
        this.onCombine_ = callback as typeof this.onCombine_;
        break;
      case 100112: // GLU_TESS_MESH
        this.meshCallback_ = callback as typeof this.meshCallback_;
        break;
      default:
        throw new Error('GLU_INVALID_ENUM');
    }
  }

  gluTessProperty(which: number, value: number | boolean): void {
    switch (which) {
      case 100140: {
        // GLU_TESS_WINDING_RULE
        // Accept both native (0-4) and libtess.js-style (100130-100134) values
        const v = value as number;
        const normalized = v >= 100130 ? v - 100130 : v;
        if (normalized < 0 || normalized > 4) {
          throw new Error('GLU_INVALID_VALUE');
        }
        this.windingRuleRaw_ = v;
        this.windingRule_ = normalized;
        break;
      }
      case 100141: // GLU_TESS_BOUNDARY_ONLY
        this.boundaryOnly_ = !!value;
        break;
      case 100142: // GLU_TESS_TOLERANCE
        // Accepted but ignored
        break;
      default:
        throw new Error('GLU_INVALID_ENUM');
    }
  }

  gluGetTessProperty(which: number): number | boolean {
    switch (which) {
      case 100140: // GLU_TESS_WINDING_RULE
        return this.windingRuleRaw_;
      case 100141: // GLU_TESS_BOUNDARY_ONLY
        return this.boundaryOnly_;
      case 100142: // GLU_TESS_TOLERANCE
        return 0;
      default:
        throw new Error('GLU_INVALID_ENUM');
    }
  }

  gluTessNormal(x: number, y: number, z: number): void {
    this.normal_[0] = x;
    this.normal_[1] = y;
    this.normal_[2] = z;
    if (z !== 0 && !x && !y) {
      this.projTMul = z > 0 ? 1 : -1;
    }
  }

  callBeginCallback(type: number): void {
    if (this.beginCallback) {
      this.beginCallback(type, this.polygonData);
    }
  }

  callVertexCallback(data: unknown): void {
    if (this.vertexCallback) {
      this.vertexCallback(data, this.polygonData);
    }
  }

  callEndCallback(): void {
    if (this.endCallback) {
      this.endCallback(this.polygonData);
    }
  }

  callEdgeFlagCallback(flag: boolean): void {
    if (this.edgeFlagCallback) {
      this.edgeFlagCallback(flag, this.polygonData);
    }
  }

  callErrorOrErrorData(errorNumber: number): void {
    if (this.errorDataCallback) {
      this.errorDataCallback(errorNumber, this.polygonData);
    } else if (this.errorCallback) {
      this.errorCallback(errorNumber);
    }
  }

  // GLU error recovery: walk state to target, auto-inserting missing calls
  private requireState(target: TessState): void {
    if (this.state === target) return;
    while (this.state !== target) {
      if (this.state < target) {
        if (this.state === TessState.T_DORMANT) {
          this.callErrorOrErrorData(100151); // GLU_TESS_MISSING_BEGIN_POLYGON
          this.gluTessBeginPolygon();
        } else if (this.state === TessState.T_IN_POLYGON) {
          this.callErrorOrErrorData(100152); // GLU_TESS_MISSING_BEGIN_CONTOUR
          this.gluTessBeginContour();
        }
      } else {
        if (this.state === TessState.T_IN_CONTOUR) {
          this.callErrorOrErrorData(100154); // GLU_TESS_MISSING_END_CONTOUR
          this.gluTessEndContour();
        } else if (this.state === TessState.T_IN_POLYGON) {
          this.callErrorOrErrorData(100153); // GLU_TESS_MISSING_END_POLYGON
          this.gluTessEndPolygon();
        }
      }
    }
  }

  boundaryOnly_: boolean = false;
  flagBoundary: boolean = false;

  // Determine the polygon normal and project vertices onto the sweep plane
  private projectPolygon() {
    const mesh = this.mesh!;
    const vHead = mesh.vHead;
    const nx = this.normal_[0];
    const ny = this.normal_[1];
    const nz = this.normal_[2];
    let sUnit, tUnit;

    if (!this.sUnit) this.sUnit = [0, 0, 0];
    if (!this.tUnit) this.tUnit = [0, 0, 0];
    if (!this.bmin) this.bmin = [0, 0];
    if (!this.bmax) this.bmax = [0, 0];

    sUnit = this.sUnit;
    tUnit = this.tUnit;

    if (this.projDone) {
      sUnit[0] = 1.0;
      sUnit[1] = 0.0;
      sUnit[2] = 0.0;
      const tMul = nz > 0 ? 1 : -1;
      tUnit[0] = 0.0;
      tUnit[1] = tMul;
      tUnit[2] = 0.0;
      this.bmin[0] = this.projMinS;
      this.bmin[1] = this.projMinT;
      this.bmax[0] = this.projMaxS;
      this.bmax[1] = this.projMaxT;
      return;
    }

    // Fast path for 2D input (all z=0, normal is z-aligned or auto)
    if (!this.hasNonZeroZ && !nx && !ny) {
      sUnit[0] = 1.0;
      sUnit[1] = 0.0;
      sUnit[2] = 0.0;

      // Determine t-axis sign: use explicit normal when available, otherwise
      // compute the normal (one O(n) pass) for the sign
      let tMul: number;
      let needOrientationCheck = false;
      if (nz) {
        tMul = nz > 0 ? 1 : -1;
      } else {
        const norm: V3 = [0, 0, 0];
        Normal.computeNormal(mesh, norm);
        tMul = norm[2] > 0 ? 1 : -1;
        needOrientationCheck = true;
      }
      tUnit[0] = 0.0;
      tUnit[1] = tMul;
      tUnit[2] = 0.0;

      let v = vHead.next!;
      let s = v.x;
      let t = v.y * tMul;
      v.s = s;
      v.t = t;
      let minS = s,
        maxS = s,
        minT = t,
        maxT = t;
      for (v = v.next!; v !== vHead; v = v!.next!) {
        s = v.x;
        t = v.y * tMul;
        v.s = s;
        v.t = t;
        if (s < minS) minS = s;
        else if (s > maxS) maxS = s;
        if (t < minT) minT = t;
        else if (t > maxT) maxT = t;
      }

      this.bmin[0] = minS;
      this.bmax[0] = maxS;

      if (needOrientationCheck) {
        Normal.checkOrientation(mesh, this.tUnit);
        // checkOrientation may have negated all t values; if so, the
        // t bounds flipped sign and swapped min/max
        if (tUnit[1] !== tMul) {
          this.bmin[1] = -maxT;
          this.bmax[1] = -minT;
        } else {
          this.bmin[1] = minT;
          this.bmax[1] = maxT;
        }
      } else {
        this.bmin[1] = minT;
        this.bmax[1] = maxT;
      }
      return;
    }

    // 3D / explicit-normal path
    let computedNormal = false;
    const norm: V3 = [nx, ny, nz];
    if (!nx && !ny && !nz) {
      Normal.computeNormal(mesh, norm);
      computedNormal = true;
    }

    const axis = Normal.longAxis(norm);

    // Project perpendicular to a coordinate axis -- better numerically
    sUnit[axis] = 0;
    sUnit[(axis + 1) % 3] = 1.0;
    sUnit[(axis + 2) % 3] = 0.0;

    tUnit[axis] = 0;
    tUnit[(axis + 1) % 3] = 0.0;
    tUnit[(axis + 2) % 3] = norm[axis] > 0 ? 1.0 : -1.0;

    // Project the vertices onto the sweep plane and compute bounds
    let v = vHead.next!;
    v.s = v.x * sUnit[0] + v.y * sUnit[1] + v.z * sUnit[2];
    v.t = v.x * tUnit[0] + v.y * tUnit[1] + v.z * tUnit[2];
    let minS = v.s,
      maxS = v.s,
      minT = v.t,
      maxT = v.t;
    for (v = v.next!; v !== vHead; v = v!.next!) {
      const s = v.x * sUnit[0] + v.y * sUnit[1] + v.z * sUnit[2];
      const t = v.x * tUnit[0] + v.y * tUnit[1] + v.z * tUnit[2];
      v.s = s;
      v.t = t;
      if (s < minS) minS = s;
      else if (s > maxS) maxS = s;
      if (t < minT) minT = t;
      else if (t > maxT) maxT = t;
    }

    if (computedNormal) {
      Normal.checkOrientation(mesh, this.tUnit);
    }

    // Bounds must reflect post-orientation-check values. checkOrientation
    // negates all t values when it flips, so detect that and fix bounds
    if (computedNormal && tUnit[(axis + 2) % 3] !== (norm[axis] > 0 ? 1.0 : -1.0)) {
      this.bmin[0] = minS;
      this.bmax[0] = maxS;
      this.bmin[1] = -maxT;
      this.bmax[1] = -minT;
    } else {
      this.bmin[0] = minS;
      this.bmax[0] = maxS;
      this.bmin[1] = minT;
      this.bmax[1] = maxT;
    }
  }

  gluTessBeginPolygon(data?: unknown): void {
    this.requireState(TessState.T_DORMANT);

    this.state = TessState.T_IN_POLYGON;
    this.noEmit_ = false;
    this.mesh = new Mesh();
    this.hasNonZeroZ = false;
    const nz = this.normal_[2];
    this.projDone = nz !== 0 && !this.normal_[0] && !this.normal_[1];
    this.projMinS = Infinity;
    this.projMaxS = -Infinity;
    this.projMinT = Infinity;
    this.projMaxT = -Infinity;
    this.polygonData = data;
  }

  gluTessBeginContour(): void {
    this.requireState(TessState.T_IN_POLYGON);

    this.state = TessState.T_IN_CONTOUR;
    this.lastEdge = null;
  }

  gluTessVertex(coords: [number, number] | [number, number, number], data?: unknown): void {
    this.requireState(TessState.T_IN_CONTOUR);

    // Clamp to GLU_TESS_MAX_COORD
    let x = coords[0];
    let y = coords[1];
    let z = coords.length > 2 ? (coords[2] as number) : 0;
    let tooLarge = false;
    if (x < -1e150) { x = -1e150; tooLarge = true; }
    else if (x > 1e150) { x = 1e150; tooLarge = true; }
    if (y < -1e150) { y = -1e150; tooLarge = true; }
    else if (y > 1e150) { y = 1e150; tooLarge = true; }
    if (z < -1e150) { z = -1e150; tooLarge = true; }
    else if (z > 1e150) { z = 1e150; tooLarge = true; }
    if (tooLarge) {
      this.callErrorOrErrorData(100155); // GLU_TESS_COORD_TOO_LARGE
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
    e.Org.x = x;
    e.Org.y = y;
    if (z !== 0) {
      e.Org.z = z;
      this.hasNonZeroZ = true;
      this.projDone = false; // can't use 2D fast-path
    } else {
      e.Org.z = 0.0;
    }

    if (this.projDone) {
      e.Org.s = x;
      const t = y * this.projTMul;
      e.Org.t = t;
      if (x < this.projMinS) this.projMinS = x;
      if (x > this.projMaxS) this.projMaxS = x;
      if (t < this.projMinT) this.projMinT = t;
      if (t > this.projMaxT) this.projMaxT = t;
    }

    // The winding of an edge says how the winding number changes as we
    // cross from the edge's right face to its left face. We add the
    // vertices in such an order that a CCW contour will add +1 to
    // the winding number of the region inside the contour
    e.winding = 1;
    e.Sym.winding = -1;

    this.lastEdge = e;
  }

  gluTessEndContour(): void {
    this.requireState(TessState.T_IN_CONTOUR);
    this.state = TessState.T_IN_POLYGON;
  }

  gluTessEndPolygon(): void {
    this.requireState(TessState.T_IN_POLYGON);

    this.state = TessState.T_DORMANT;

    this.compute(this.windingRule_, undefined, DEBUG);

    const mesh = this.mesh!;

    if (!this.noEmit_) {
      if (this.boundaryOnly_) {
        setWindingNumber(mesh, 1, true);
        renderBoundaryMesh(this, mesh);
      } else if (this.flagBoundary) {
        TessMono.tessellateInterior(mesh);
        renderMesh(this, mesh, true);
      } else {
        renderMonotoneDirect(this, mesh);
      }
    }

    if (this.meshCallback_) {
      this.meshCallback_(mesh);
    }

    this.mesh = null!;
    this.lastEdge = null;
    this.event = null!;
    this.polygonData = null;
    this.dict = null!;
  }

  gluDeleteTess(): void {
    this.requireState(TessState.T_DORMANT);
  }

  // Run the sweep-line algorithm, keeping the mesh for further queries
  compute(windingRule: WINDING = WINDING.ODD, normal?: V3, validate: boolean = DEBUG): void {
    if (this.state !== TessState.T_DORMANT) {
      if (this.state === TessState.T_IN_POLYGON) {
        this.state = TessState.T_DORMANT;
      }
    }

    if (!this.mesh) this.mesh = new Mesh();

    if (normal) {
      this.normal_[0] = normal[0];
      this.normal_[1] = normal[1];
      this.normal_[2] = normal[2];
    }

    this.windingRule_ = windingRule;

    this.projectPolygon();
    computeInterior(this, validate);
  }

  // Destructive -- deletes interior edges and merges faces into boundary
  // loops. If you need both triangles and boundaries, call renderTriangles
  // first
  renderBoundary(): void {
    if (!this.mesh) return;
    setWindingNumber(this.mesh, 1, true);
    renderBoundaryMesh(this, this.mesh);
  }

  // Tessellate interior and emit triangles
  renderTriangles(flagEdges: boolean = false): void {
    if (!this.mesh) return;
    if (flagEdges) {
      TessMono.tessellateInterior(this.mesh);
      renderMesh(this, this.mesh, true);
    } else {
      renderMonotoneDirect(this, this.mesh);
    }
  }
}
