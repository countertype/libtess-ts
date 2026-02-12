// Priority queue of vertices, ordered by vertLeq. Combines a sorted
// array (for initial vertices) with a heap (for intersections
// discovered during the sweep)

import { Vertex } from './Mesh';
import { PriorityQHeap } from './PriorityQHeap';
import { vertLeq } from './Geom';

// Below this vertex count, use heap-only mode to avoid the overhead
// of sorted-array allocation + Array.sort for small polygons
const HEAP_ONLY_THRESHOLD = 128;

export class PriorityQ {
  private heap: PriorityQHeap;
  private keys!: Array<Vertex>;
  private order: Array<number> | null = null;
  private size: number = 0;
  private max: number = 0;
  private initialized: boolean = false;
  private heapOnly: boolean;

  constructor(size: number) {
    this.max = size;
    this.size = 0;
    this.initialized = false;
    this.heapOnly = size <= HEAP_ONLY_THRESHOLD;

    this.heap = new PriorityQHeap(size);

    if (!this.heapOnly) {
      this.keys = new Array<Vertex>(size).fill(null as any);
    }
  }

  reset(size: number) {
    this.heap.reset(size);
    this.heapOnly = size <= HEAP_ONLY_THRESHOLD;
    if (!this.heapOnly) {
      if (!this.keys || size > this.max) {
        this.keys = new Array<Vertex>(size).fill(null as any);
      }
    }
    if (size > this.max) this.max = size;
    this.size = 0;
    this.initialized = false;
    this.order = null;
  }

  insert(keyNew: Vertex): number {
    if (this.heapOnly || this.initialized) {
      return this.heap.insert(keyNew);
    }

    const curr = this.size;
    if (++this.size >= this.max) {
      const oldMax = this.max;
      this.max *= 2;
      const newKeys = new Array<Vertex>(this.max).fill(null as any);
      for (let i = 0; i < oldMax; i++) {
        newKeys[i] = this.keys[i];
      }
      this.keys = newKeys;
    }

    this.keys[curr] = keyNew;

    // Negative handles index into the sorted array
    return -(curr + 1);
  }

  // Sort keys and initialize the heap. O(n log n) for sorted+heap mode,
  // O(n) heapify for heap-only mode
  init(): boolean {
    if (this.heapOnly) {
      this.initialized = true;
      this.heap.init();
      return true;
    }

    this.order = new Array(this.size);

    for (let i = 0; i < this.size; i++) {
      this.order[i] = i;
    }

    // Sort indirect pointers in descending order so extractMin pops from the end
    const keys = this.keys;
    this.order.sort((a, b) => {
      const va = keys[a];
      const vb = keys[b];
      if (va.s < vb.s) return 1;
      if (va.s > vb.s) return -1;
      return va.t <= vb.t ? 1 : -1;
    });

    this.max = this.size;
    this.initialized = true;
    this.heap.init();

    return true;
  }

  extractMin(): Vertex | null {
    if (this.heapOnly || this.size === 0) {
      return this.heap.extractMin();
    }

    const sortMin = this.keys[this.order![this.size - 1]];
    if (!this.heap.isEmpty()) {
      const heapMin = this.heap.min();
      if (heapMin && vertLeq(heapMin, sortMin)) {
        return this.heap.extractMin();
      }
    }

    do {
      --this.size;
    } while (this.size > 0 && this.keys[this.order![this.size - 1]] === null);

    return sortMin;
  }

  min(): Vertex | null {
    if (this.heapOnly || this.size === 0) {
      return this.heap.min();
    }

    const sortMin = this.keys[this.order![this.size - 1]];
    if (!this.heap.isEmpty()) {
      const heapMin = this.heap.min();
      if (heapMin && vertLeq(heapMin, sortMin)) {
        return heapMin;
      }
    }

    return sortMin;
  }

  delete(handle: number): void {
    if (handle >= 0) {
      this.heap.delete(handle);
    } else {
      const curr = -(handle + 1);
      this.keys[curr] = null as any;
    }
  }

  isEmpty(): boolean {
    if (this.heapOnly) return this.heap.isEmpty();
    return this.size === 0 && this.heap.isEmpty();
  }
}
