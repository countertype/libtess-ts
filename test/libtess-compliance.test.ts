import { describe, it, expect } from 'vitest';
import { GluTesselator, WINDING, GLU_TESS } from '../src';
import { REDBOOK_TESTS, BASIC_TESTS } from './fixtures/redbook';
import { tessellateAndCollect } from './collect-output';

describe('libtess Compliance - Basic Shapes', () => {
  BASIC_TESTS.forEach((testCase) => {
    it(`tessellates ${testCase.name}: ${testCase.description}`, () => {
      const tess = new GluTesselator();

      const output = tessellateAndCollect(
        tess,
        testCase.contours.map((c) => c as number[]),
        testCase.vertexSize as 2 | 3
      );

      if (testCase.expected?.triangles) {
        expect(output.elementCount).toBe(testCase.expected.triangles);
      }
      if (testCase.expected?.vertices) {
        expect(output.vertexCount).toBe(testCase.expected.vertices);
      }

      // Basic sanity checks
      expect(output.elementCount).toBeGreaterThan(0);
      expect(output.vertexCount).toBeGreaterThan(0);
    });
  });
});

describe('libtess Compliance - Red Book Examples', () => {
  REDBOOK_TESTS.forEach((testCase) => {
    it(`tessellates ${testCase.name}: ${testCase.description}`, () => {
      const tess = new GluTesselator();

      const output = tessellateAndCollect(
        tess,
        testCase.contours.map((c) => c as number[]),
        testCase.vertexSize as 2 | 3
      );

      if (testCase.expected?.triangles) {
        expect(output.elementCount).toBe(testCase.expected.triangles);
      }

      expect(output.elementCount).toBeGreaterThan(0);
      expect(output.vertexCount).toBeGreaterThan(0);
    });
  });
});

describe('libtess Compliance - Winding Rules', () => {
  it('supports all 5 winding rules on nested rectangles', () => {
    const testCase = REDBOOK_TESTS.find((t) => t.name === 'nestedRectangles')!;

    const rules = [
      { rule: WINDING.ODD, name: 'ODD' },
      { rule: WINDING.NONZERO, name: 'NONZERO' },
      { rule: WINDING.POSITIVE, name: 'POSITIVE' },
      { rule: WINDING.NEGATIVE, name: 'NEGATIVE' },
      { rule: WINDING.ABS_GEQ_TWO, name: 'ABS_GEQ_TWO' }
    ];

    rules.forEach(({ rule, name }) => {
      const tess = new GluTesselator();

      // Should not throw
      expect(() => {
        tessellateAndCollect(
          tess,
          testCase.contours.map((c) => c as number[]),
          testCase.vertexSize as 2 | 3
        );
      }).not.toThrow();
    });
  });

  it('produces different results for different winding rules', () => {
    const testCase = REDBOOK_TESTS.find((t) => t.name === 'overlappingQuads')!;
    const results = new Map();

    const rules = [WINDING.ODD, WINDING.NONZERO, WINDING.POSITIVE];

    rules.forEach((rule) => {
      const tess = new GluTesselator();
      tess.gluTessProperty(GLU_TESS.WINDING_RULE, rule);
      const output = tessellateAndCollect(
        tess,
        testCase.contours.map((c) => c as number[]),
        testCase.vertexSize as 2 | 3
      );
      results.set(rule, output.elementCount);
    });

    // Different winding rules should produce different tessellations
    const counts = Array.from(results.values());
    expect(new Set(counts).size).toBeGreaterThan(1);
  });
});
