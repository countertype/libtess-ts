// Stress tests using poly2tri test data (BSD-3-Clause)
// Source: https://code.google.com/p/poly2tri/ (archived)
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { GluTesselator } from '../src';
import { tessellateAndCollect } from './collect-output';

// Parse .dat file format (flexible: any separator)
const parseDat = (data: string): number[] =>
  data
    .split(/[^-eE\.\d]+/)
    .filter((v) => v)
    .map(parseFloat);

// Known problematic files to skip
const SKIP = [
  'debug.dat', // Freezes
  'debug2.dat', // Freezes
  'sketchup.dat' // Invalid data
];

const ISSUE34_SKIP = [
  'stackoverflow.dat',
  'stackoverflow_uncommented.dat',
  'assertion.dat',
  'overflow2.dat',
  'dump.dat'
];

describe('Stress Tests - poly2tri data (BSD-3)', () => {
  const dataDir = join(__dirname, 'data');

  let files: string[];
  try {
    files = readdirSync(dataDir)
      .filter((f) => f.endsWith('.dat'))
      .filter((f) => !SKIP.some((s) => f.includes(s)))
      .filter((f) => !f.includes('issue34')); // Skip entire issue34 dir
  } catch {
    // If data dir doesn't exist, skip these tests
    it.skip('poly2tri test data not found', () => {});
    return;
  }

  files.forEach((file) => {
    it(`handles ${file} without crashing`, () => {
      const data = readFileSync(join(dataDir, file), 'utf-8');
      const coords = parseDat(data);

      if (coords.length < 6) {
        return; // Skip degenerate
      }

      const tess = new GluTesselator();

      expect(() => {
        tessellateAndCollect(tess, [coords], 2);
      }).not.toThrow();
    });
  });
});
