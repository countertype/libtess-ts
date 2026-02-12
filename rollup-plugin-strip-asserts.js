// Rollup plugin to strip assert() calls from production builds.
// Replaces assert calls with void 0 to avoid breaking AST.
export default function stripAsserts() {
  return {
    name: 'strip-asserts',

    renderChunk(code) {
      let result = code;

      // Single-line asserts
      result = result.replace(/(^|[;\n]\s*)assert\([^)]+\);?/gm, '$1void 0;');

      // Multi-line asserts with nested parens
      let changed = true;
      let iterations = 0;
      while (changed && iterations < 5) {
        iterations++;
        const before = result;
        result = result.replace(
          /(^|[;\n]\s*)assert\((?:[^()]|\([^()]*\)|\([^()]*\([^()]*\)[^()]*\))*\);?/gm,
          '$1void 0;'
        );
        changed = result !== before;
      }

      // Remove the unused assert function definition
      result = result.replace(/function assert\([^)]*\)\s*\{[^}]*\}/g, '');

      return {
        code: result,
        map: null
      };
    }
  };
}
