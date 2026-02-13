# libtess-ts

Optimized TypeScript port of [libtess.js](https://github.com/brendankenny/libtess.js) by Brendan Kenny, itself a port of the SGI GLU tessellator by Eric Veach

[![npm](https://img.shields.io/npm/v/libtess-ts)](https://www.npmjs.com/package/libtess-ts)
[![License](https://img.shields.io/badge/license-SGI--B--2.0-blue)](./LICENSE)

## Performance vs libtess.js

This library builds on libtess.js, which faithfully ported the GLU tessellator to JavaScript. The core sweep-line tessellation algorithm is unchanged here; the performance difference (typically 15-30% faster, sometimes more on large inputs) comes from implementation-level changes:

- Direct monotone rendering: triangulates monotone faces inline during the sweep, avoiding a separate mesh-modification pass
- 2D fast path: when you call `gluTessNormal(0, 0, 1)`, vertex projection is folded into `gluTessVertex` instead of requiring a separate loop over all vertices
- Reduced allocation: scratch buffers, priority queue storage, and temporary objects are reused across calls rather than re-allocated each time
- Typed arrays in the priority queue heap

See [changes from libtess.js](#changes-from-libtessjs) for the full list of API differences

### vs tess2.js

[libtess2](https://github.com/memononen/libtess2) by Mikko Mononen is a performance oriented adaptation of the original SGI GLU tessellator with a simpler API. It reports a 15-50x speedup in C. [tess2.js](https://github.com/memononen/tess2.js) is its JavaScript port

In JavaScript, though, the performance picture is different: libtess-ts is typically 40-90% faster than tess2.js on the same inputs. libtess2's key optimization is a bucketed memory allocator that replaces many small `malloc` calls; a significant win in C, but in JavaScript there is no `malloc` to avoid as the GC manages the heap, so the optimization doesn't carry over

See [benchmarks](#benchmarks) for numbers

## Installation

```bash
npm install libtess-ts
```

## Quick start

```typescript
import { GluTesselator, GLU_TESS } from 'libtess-ts'

const tess = new GluTesselator()

// Collect triangle indices
const indices: number[] = []
tess.gluTessCallback(GLU_TESS.VERTEX_DATA, (data: number) => {
  indices.push(data)
})

// If your input is 2D (and it probably is), set this
// Without it the tessellator auto-detects the projection
// plane, which costs an extra pass over the vertices
tess.gluTessNormal(0, 0, 1)

tess.gluTessBeginPolygon()

tess.gluTessBeginContour()
tess.gluTessVertex([0, 0], 0)
tess.gluTessVertex([10, 0], 1)
tess.gluTessVertex([10, 10], 2)
tess.gluTessVertex([0, 10], 3)
tess.gluTessEndContour()

// Holes are additional contours with opposite winding
tess.gluTessBeginContour()
tess.gluTessVertex([2, 2], 4)
tess.gluTessVertex([2, 8], 5)
tess.gluTessVertex([8, 8], 6)
tess.gluTessVertex([8, 2], 7)
tess.gluTessEndContour()

tess.gluTessEndPolygon()

// indices now contains triangle vertex indices
```

## API

### Core methods

| Method | Description |
|---|---|
| `gluTessBeginPolygon(data?)` | Start a new polygon. Optional data is passed to `_DATA` callbacks |
| `gluTessBeginContour()` | Start a new contour (outer boundary or hole) |
| `gluTessVertex(coords, data?)` | Add a vertex. `coords` is `[x, y]` or `[x, y, z]` |
| `gluTessEndContour()` | Close the current contour |
| `gluTessEndPolygon()` | Tessellate and emit results via callbacks |
| `gluTessNormal(x, y, z)` | Set the projection plane normal. Call `(0, 0, 1)` for 2D input, it's faster |
| `gluTessProperty(which, value)` | Set a tessellation property (winding rule, boundary-only mode) |

### Properties via `gluTessProperty`

| Enum | Value | Description |
|---|---|---|
| `GLU_TESS.WINDING_RULE` | 0=ODD, 1=NONZERO, 2=POSITIVE, 3=NEGATIVE, 4=ABS_GEQ_TWO | Winding rule for interior detection |
| `GLU_TESS.BOUNDARY_ONLY` | 0 or 1 | If 1, emit boundary contours instead of triangles |
| `GLU_TESS.TOLERANCE` | number | Accepted but ignored (for compatibility) |

### Callbacks

Register via `gluTessCallback(type, fn)`:

| Type | Callback signature | Description |
|---|---|---|
| `GLU_TESS.BEGIN` | `(type: number) => void` | Start of a primitive (`GL_TRIANGLES`) |
| `GLU_TESS.VERTEX` | `(data: unknown) => void` | Vertex data (the value passed to `gluTessVertex`) |
| `GLU_TESS.END` | `() => void` | End of a primitive |
| `GLU_TESS.COMBINE` | `(coords, data, weights) => unknown` | Vertex interpolation at intersections (see below) |
| `GLU_TESS.EDGE_FLAG` | `(flag: boolean) => void` | Edge boundary flag. Registering this forces individual triangle output |
| `GLU_TESS.ERROR` | `(errorNumber: number) => void` | Tessellation error (e.g. missing combine callback) |
| `GLU_TESS.BEGIN_DATA` | `(type: number, polygonData: unknown) => void` | Like `BEGIN`, with polygon data from `gluTessBeginPolygon` |
| `GLU_TESS.VERTEX_DATA` | `(data: unknown, polygonData: unknown) => void` | Like `VERTEX`, with polygon data |
| `GLU_TESS.END_DATA` | `(polygonData: unknown) => void` | Like `END`, with polygon data |
| `GLU_TESS.COMBINE_DATA` | `(coords, data, weights, polygonData) => unknown` | Like `COMBINE`, with polygon data |
| `GLU_TESS.EDGE_FLAG_DATA` | `(flag: boolean, polygonData: unknown) => void` | Like `EDGE_FLAG`, with polygon data |
| `GLU_TESS.ERROR_DATA` | `(errorNumber: number, polygonData: unknown) => void` | Like `ERROR`, with polygon data |

### Separate sweep and render

If you need both triangles and boundary contours from the same input, use `compute()` to run the sweep once, then call the render methods separately:

```typescript
import { GluTesselator, WINDING } from 'libtess-ts'

const tess = new GluTesselator()

tess.gluTessBeginPolygon()
// ... add contours ...
// Don't call gluTessEndPolygon(), use compute() instead

tess.compute(WINDING.NONZERO)

// Extract triangles first
tess.renderTriangles()

// Then extract boundary contours (destructive: call after renderTriangles)
tess.renderBoundary()
```

### Combine callback

When contours self-intersect, the tessellator needs to create new vertices at the intersection points. Supply a combine callback to interpolate vertex attributes:

```typescript
tess.gluTessCallback(GLU_TESS.COMBINE, (coords, data, weights) => {
  // coords: [x, y, z] of the new vertex
  // data: [v0, v1, v2, v3] -- up to 4 neighboring vertex data values
  // weights: [w0, w1, w2, w3] -- interpolation weights (sum to 1.0)
  return interpolatedData
})
```

### Changes from libtess.js

The core algorithm and `gluTess*` method signatures are identical. If you have working libtess.js code, migration is mostly import changes. Here's what's different:

**Imports and enums:** ESM only, shorter enum names:

```javascript
// libtess.js
const libtess = require('libtess');
const tess = new libtess.GluTesselator();
tess.gluTessCallback(libtess.gluEnum.GLU_TESS_VERTEX, fn);

// libtess-ts
import { GluTesselator, GLU_TESS } from 'libtess-ts';
const tess = new GluTesselator();
tess.gluTessCallback(GLU_TESS.VERTEX, fn);
```

**New exports:**

| Export | Purpose |
|---|---|
| `WINDING` | Type-safe winding rule values (`WINDING.ODD`, `WINDING.NONZERO`, etc.) |
| `GLU_TESS_ERROR` | Error codes passed to the `ERROR` callback (`NEED_COMBINE_CALLBACK`, `COORD_TOO_LARGE`, etc.) |
| `GL_TRIANGLES`, `GL_LINE_LOOP` | Primitive type constants passed to the `BEGIN` callback |

**New capabilities:**

- `gluTessVertex` accepts `[x, y]` in addition to `[x, y, z]` (z defaults to 0)
- `compute()`, `renderTriangles()`, and `renderBoundary()` let you run the sweep once and extract multiple output formats (see [separate sweep and render](#separate-sweep-and-render))

## Benchmarks

All measurements use paired testing with 200 warmup iterations, 500 samples, and Welch's t-test for significance. All runners accumulate output arrays (vertices + elements) for a fair comparison. Run `node benchmarks/benchmark.mjs` to reproduce

### Cold path (new instance per call)

| Workload | libtess.js | libtess-ts | tess2.js | JS vs TS | JS vs T2 |
|---|---|---|---|---|---|
| Glyph, 60v | 24 us | 23 us | 30 us | -5% | +23% |
| Self-intersecting glyph, 224v | 86 us | 78 us | 114 us | -9% | +34% |
| Star, 1K vertices | 412 us | 399 us | 625 us | -3% | +52% |
| Star, 7K vertices | 3451 us | 3028 us | 5350 us | -12% | +55% |
| poly2tri dude, 104v | 44 us | 38 us | 49 us | -14% | +13% |
| OSM building, 22v | 16 us | 10 us | 15 us | -36% | -3% |
| OSM NYC z14, 475v | 341 us | 289 us | 550 us | -15% | +61% |
| Dense intersections, 40v | 1070 us | 919 us | 1287 us | -14% | +20% |

### Warm path (reused instance, libtess.js vs libtess-ts)

| Workload | libtess.js | libtess-ts | Diff | Significance |
|---|---|---|---|---|
| Glyph, 60v | 28 us | 19 us | -33% | p < 0.0001 |
| Self-intersecting glyph, 224v | 92 us | 82 us | -10% | p < 0.0001 |
| Star, 1K vertices | 434 us | 391 us | -10% | p < 0.0001 |
| Star, 7K vertices | 4651 us | 3960 us | -15% | p < 0.0001 |
| poly2tri dude, 104v | 44 us | 33 us | -25% | p < 0.0001 |
| OSM NYC z14, 475v | 218 us | 187 us | -15% | p < 0.0001 |
| Dense intersections, 40v | 831 us | 706 us | -15% | p < 0.0001 |

Negative percentages mean the second library is faster

## License

[SGI Free Software License B (Version 2.0)](./LICENSE)

Some test data is derived from [poly2tri](https://github.com/jhasse/poly2tri) (BSD-3-Clause). See [LICENSE_THIRD_PARTY](./LICENSE_THIRD_PARTY)

Maintained by [@jpt](https://github.com/jpt)