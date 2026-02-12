import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import stripAsserts from './rollup-plugin-strip-asserts.js';

const banner = `/**
 * @license
 * libtess-ts - TypeScript port of the SGI GLU tessellator
 * Original Code: OpenGL Sample Implementation, Version 1.2.1,
 *   released January 26, 2000. Copyright (c) 1991-2000 Silicon Graphics, Inc.
 * Copyright 2012, Google Inc. All Rights Reserved.
 * Copyright 2026, Countertype LLC. All Rights Reserved.
 * SGI Free Software License B (Version 2.0)
 * http://oss.sgi.com/projects/FreeB/
 */`;

const minifyConfig = {
  compress: {
    dead_code: true,
    conditionals: true,
    evaluate: true,
    booleans: true,
    loops: true,
    unused: true,
    hoist_funs: true,
    keep_fargs: false,
    passes: 2,
    pure_getters: true,
    unsafe: true,
    unsafe_comps: true,
    unsafe_math: true,
    unsafe_proto: true,
    unsafe_arrows: true,
    unsafe_methods: true,
    unsafe_undefined: true,
    unsafe_Function: true,
    unsafe_regexp: true,
    unsafe_symbols: true,
    inline: 3,
    collapse_vars: true,
    reduce_vars: true,
    reduce_funcs: true,
    hoist_props: true,
    join_vars: true,
    side_effects: true,
    switches: true,
    typeofs: true,
    arrows: true,
    computed_props: true,
    negate_iife: true,
    keep_fnames: false,
    keep_classnames: false,
    arguments: true,
    booleans_as_integers: true,
    keep_infinity: false,
    sequences: true,
    if_return: true,
    toplevel: true,
    module: true,
    ecma: 2020,
    drop_console: true,
    drop_debugger: true
  },
  mangle: {
    toplevel: true,
    eval: true,
    properties: {
      reserved: [
        'GluTesselator',
        'WINDING',
        'ODD',
        'NONZERO',
        'POSITIVE',
        'NEGATIVE',
        'ABS_GEQ_TWO',
        'GLU_TESS',
        'BEGIN',
        'VERTEX',
        'END',
        'ERROR',
        'EDGE_FLAG',
        'COMBINE',
        'BEGIN_DATA',
        'VERTEX_DATA',
        'END_DATA',
        'ERROR_DATA',
        'EDGE_FLAG_DATA',
        'COMBINE_DATA',
        'gluTessBeginPolygon',
        'gluTessEndPolygon',
        'gluTessBeginContour',
        'gluTessEndContour',
        'gluTessVertex',
        'gluTessProperty',
        'gluGetTessProperty',
        'gluTessNormal',
        'gluTessCallback',
        'gluDeleteTess',
        'compute',
        'renderBoundary',
        'renderTriangles',
        'tessellateInterior',
        'vertices',
        'vertexIndices',
        'vertexCount',
        'elements',
        'elementCount',
        'edgeFlags',
        'vertexData',
        'flagBoundary',
        'WINDING_RULE',
        'BOUNDARY_ONLY',
        'TOLERANCE',
        'contours',
        'validate',
        'x',
        'y',
        'z',
        'contourEnds',
        'length',
        'prototype',
        'constructor',
        'exports'
      ],
      keep_quoted: false,
      builtins: false,
      debug: false
    },
    safari10: false
  },
  format: {
    comments: 'some',
    ecma: 2020,
    safari10: false
  },
  ecma: 2020,
  module: true,
  toplevel: true
};

export default {
  input: './src/index.ts',
  plugins: [
    typescript({
      declaration: false,
      declarationDir: null
    })
  ],
  output: [
    {
      file: './dist/libtess.es.js',
      format: 'esm',
      sourcemap: true,
      banner,
      plugins: [stripAsserts()]
    },
    {
      file: './dist/libtess.min.js',
      format: 'esm',
      sourcemap: true,
      banner,
      plugins: [terser(minifyConfig)]
    }
  ]
};
