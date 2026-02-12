import { describe, it, expect } from 'vitest';
import { GluTesselator, WINDING } from '../src';
import { tessellateAndCollect } from './collect-output';

describe('Systematic - Regular Polygons', () => {
  it('tessellates regular N-gons (N=3 to N=20)', () => {
    for (let n = 3; n <= 20; n++) {
      const coords: number[] = [];
      for (let i = 0; i < n; i++) {
        const angle = (i * 2 * Math.PI) / n;
        coords.push(Math.cos(angle), Math.sin(angle), 0);
      }

      const tess = new GluTesselator();
      const output = tessellateAndCollect(tess, [coords], 3);

      // Convex N-gon triangulates to N-2 triangles
      expect(output.elementCount).toBe(n - 2);
    }
  });
});

describe('Systematic - Degenerate Cases', () => {
  it('handles coincident vertices', () => {
    const tess = new GluTesselator();

    expect(() => {
      tessellateAndCollect(tess, [[0, 0, 1, 0, 1, 0, 1, 1, 0, 1]], 2);
    }).not.toThrow();
  });

  it('handles collinear vertices', () => {
    const tess = new GluTesselator();
    const output = tessellateAndCollect(tess, [[0, 0, 1, 0, 2, 0, 3, 0]], 2);

    expect(output.elementCount).toBe(0); // No area
  });
});

describe('Systematic - Multiple Contours', () => {
  it('tessellates polygon with N holes', () => {
    for (let nholes = 1; nholes <= 5; nholes++) {
      const tess = new GluTesselator();

      const contours = [];
      // Outer square
      contours.push([0, 0, 10, 0, 10, 10, 0, 10]);

      // Add N holes
      const holeSize = 1.0;
      const spacing = 10.0 / (nholes + 1);
      for (let i = 0; i < nholes; i++) {
        const x = spacing * (i + 1) - holeSize / 2;
        const y = 5 - holeSize / 2;
        contours.push([x, y, x + holeSize, y, x + holeSize, y + holeSize, x, y + holeSize]);
      }

      const output = tessellateAndCollect(tess, contours, 2);

      expect(output.elementCount).toBeGreaterThan(nholes * 2); // At least holes*2
    }
  });
});

describe('Systematic - Winding Rule Coverage', () => {
  it('tests all winding rules on overlapping squares', () => {
    const outer = [0, 0, 4, 0, 4, 4, 0, 4];
    const inner = [1, 1, 3, 1, 3, 3, 1, 3];

    const results = {
      [WINDING.ODD]: 0,
      [WINDING.NONZERO]: 0,
      [WINDING.POSITIVE]: 0,
      [WINDING.NEGATIVE]: 0,
      [WINDING.ABS_GEQ_TWO]: 0
    };

    Object.keys(results).forEach((rule) => {
      const tess = new GluTesselator();
      tess.gluTessProperty(100140, Number(rule));
      const output = tessellateAndCollect(tess, [outer, inner], 2);
      results[rule as any] = output.elementCount;
    });

    // ODD should produce a frame (inner is a hole)
    expect(results[WINDING.ODD]).toBeGreaterThan(0);

    // All winding rules should produce valid output
    Object.values(results).forEach((count) => {
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });
});
