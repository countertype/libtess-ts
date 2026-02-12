export type V3 = [number, number, number | 0];
export type V2 = [number, number];

export type CombineCallback = (
  coords: [number, number, number],
  data: [unknown, unknown, unknown, unknown],
  weights: [number, number, number, number],
  polygonData?: unknown
) => unknown;

export enum WINDING {
  ODD = 0,
  NONZERO = 1,
  POSITIVE = 2,
  NEGATIVE = 3,
  ABS_GEQ_TWO = 4
}

export enum ELEMENT {
  POLYGONS = 0,
  CONNECTED_POLYGONS = 1,
  BOUNDARY_CONTOURS = 2
}

// OpenGL callback types (for gluTessCallback)
export enum GLU_TESS {
  BEGIN = 100100,
  EDGE_FLAG = 100104,
  VERTEX = 100101,
  END = 100102,
  ERROR = 100103,
  COMBINE = 100105,
  BEGIN_DATA = 100106,
  EDGE_FLAG_DATA = 100110,
  VERTEX_DATA = 100107,
  END_DATA = 100108,
  ERROR_DATA = 100109,
  COMBINE_DATA = 100111,

  WINDING_RULE = 100140,
  BOUNDARY_ONLY = 100141,
  TOLERANCE = 100142
}

// Error codes passed to the GLU_TESS.ERROR callback
export enum GLU_TESS_ERROR {
  MISSING_BEGIN_POLYGON = 100151,
  MISSING_BEGIN_CONTOUR = 100152,
  MISSING_END_POLYGON = 100153,
  MISSING_END_CONTOUR = 100154,
  COORD_TOO_LARGE = 100155,
  NEED_COMBINE_CALLBACK = 100156
}

export const GL_TRIANGLES = 4;
export const GL_LINE_LOOP = 2;

// Minimal interface for the callback methods Render.ts needs from
// GluTesselator, avoiding a circular import
export interface TessCallbacks {
  callBeginCallback(type: number): void;
  callVertexCallback(data: unknown): void;
  callEndCallback(): void;
  callEdgeFlagCallback(flag: boolean): void;
}
