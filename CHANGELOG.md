# Changelog

## [0.0.1] - 2026-02-11

Initial release. TypeScript port of the SGI GLU tessellator, API-compatible with libtess.js

### Features

- Full GLU tessellator: all 5 winding rules, boundary extraction, combine callbacks
- `GluTesselator` class with standard `gluTess*` API matching libtess.js
- GLU error recovery: out-of-order calls fire error callbacks and auto-correct
- `gluTessNormal(0, 0, 1)` fast path for 2D inputs (skips normal computation)
- `WINDING` and `ELEMENT` enums for type-safe property values
- Debug assertions stripped at build time

### Performance

15-30% faster than libtess.js on typical inputs:

- Zero-allocation `computeNormal` (scalar locals, no temp arrays)
- `ActiveRegion` merged into `DictNode` (~120 fewer allocations per call)
- `Int32Array`-backed priority queue with inlined comparators
- 2D projection shortcut when normal is axis-aligned
- Module-level functions (no class dispatch overhead)
