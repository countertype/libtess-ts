// Binary heap for dynamic priority queue operations, using flat typed
// arrays for node/handle indirection

import { assert } from './Assert';
import { Vertex } from './Mesh';

export class PriorityQHeap {
  max: number = 0;
  nodeHandles: Int32Array;
  handleKeys: Array<Vertex | null>;
  handleNodes: Int32Array;
  initialized: boolean = false;
  freeList: number = 0;
  size: number = 0;

  constructor(size: number) {
    this.max = size;

    this.nodeHandles = new Int32Array(size + 1);
    this.handleKeys = new Array<Vertex | null>(size + 1).fill(null);
    this.handleNodes = new Int32Array(size + 1);

    this.initialized = false;

    // So that min() returns null on empty heap
    this.nodeHandles[1] = 1;
    this.handleKeys[1] = null;
  }

  // Reset for reuse on warm calls (grows arrays if needed, nulls old
  // vertex refs so the previous mesh can be collected)
  reset(size: number) {
    if (size + 1 > this.max) {
      this.max = size;
      this.nodeHandles = new Int32Array(size + 1);
      this.handleKeys = new Array<Vertex | null>(size + 1).fill(null);
      this.handleNodes = new Int32Array(size + 1);
    } else {
      const keys = this.handleKeys;
      for (let i = 1; i <= this.size; i++) keys[i] = null;
    }
    this.size = 0;
    this.freeList = 0;
    this.initialized = false;
    this.nodeHandles[1] = 1;
    this.handleKeys[1] = null;
  }

  floatDown(curr: number) {
    const nodeHandles = this.nodeHandles;
    const handleKeys = this.handleKeys;
    const handleNodes = this.handleNodes;
    let hCurr = nodeHandles[curr];
    while (true) {
      let child = curr << 1;
      if (child > this.size) break;

      let minChild = child;
      let hChild = nodeHandles[child];
      if (child + 1 <= this.size) {
        const hRight = nodeHandles[child + 1];
        const kRight = handleKeys[hRight]!;
        const kChild = handleKeys[hChild]!;
        if (kRight.s < kChild.s || (kRight.s === kChild.s && kRight.t <= kChild.t)) {
          minChild = child + 1;
          hChild = hRight;
        }
      }

      const kCurr = handleKeys[hCurr]!;
      const kMin = handleKeys[hChild]!;
      if (kCurr.s < kMin.s || (kCurr.s === kMin.s && kCurr.t <= kMin.t)) break;

      nodeHandles[curr] = hChild;
      handleNodes[hChild] = curr;
      curr = minChild;
    }
    nodeHandles[curr] = hCurr;
    handleNodes[hCurr] = curr;
  }

  floatUp(curr: number) {
    const nodeHandles = this.nodeHandles;
    const handleKeys = this.handleKeys;
    const handleNodes = this.handleNodes;
    let hCurr = nodeHandles[curr];
    while (true) {
      const parent = curr >> 1;
      if (parent === 0) break;
      const hParent = nodeHandles[parent];
      const kParent = handleKeys[hParent]!;
      const kCurr = handleKeys[hCurr]!;
      if (kParent.s < kCurr.s || (kParent.s === kCurr.s && kParent.t <= kCurr.t)) break;

      nodeHandles[curr] = hParent;
      handleNodes[hParent] = curr;
      curr = parent;
    }
    nodeHandles[curr] = hCurr;
    handleNodes[hCurr] = curr;
  }

  // O(n) heap construction (vs O(n log n) for repeated insert)
  init() {
    for (let i = this.size >> 1; i >= 1; --i) {
      this.floatDown(i);
    }
    this.initialized = true;
  }

  isEmpty(): boolean {
    return this.size === 0;
  }

  min(): Vertex | null {
    if (this.size === 0) return null;
    return this.handleKeys[this.nodeHandles[1]];
  }

  insert(keyNew: Vertex) {
    let curr;
    let free;

    curr = ++this.size;
    if (curr * 2 > this.max) {
      this.max *= 2;
      const newNodeHandles = new Int32Array(this.max + 1);
      const newHandleNodes = new Int32Array(this.max + 1);
      const newHandleKeys = new Array<Vertex | null>(this.max + 1).fill(null);

      newNodeHandles.set(this.nodeHandles);
      newHandleNodes.set(this.handleNodes);
      for (let i = 0; i < this.handleKeys.length; i++) {
        newHandleKeys[i] = this.handleKeys[i];
      }

      this.nodeHandles = newNodeHandles;
      this.handleNodes = newHandleNodes;
      this.handleKeys = newHandleKeys;
    }

    if (this.freeList === 0) {
      free = curr;
    } else {
      free = this.freeList;
      this.freeList = this.handleNodes[free];
    }

    this.nodeHandles[curr] = free;
    this.handleNodes[free] = curr;
    this.handleKeys[free] = keyNew;

    if (this.initialized) {
      this.floatUp(curr);
    }
    return free;
  }

  extractMin() {
    const nodeHandles = this.nodeHandles;
    const handleKeys = this.handleKeys;
    const handleNodes = this.handleNodes;
    let hMin = nodeHandles[1];
    let min = handleKeys[hMin];

    if (this.size > 0) {
      nodeHandles[1] = nodeHandles[this.size];
      handleNodes[nodeHandles[1]] = 1;

      handleKeys[hMin] = null;
      handleNodes[hMin] = this.freeList;
      this.freeList = hMin;

      --this.size;
      if (this.size > 0) {
        this.floatDown(1);
      }
    }
    return min;
  }

  delete(hCurr: number) {
    const nodeHandles = this.nodeHandles;
    const handleKeys = this.handleKeys;
    const handleNodes = this.handleNodes;
    let curr;

    assert(hCurr >= 1 && hCurr <= this.max && handleKeys[hCurr] !== null);

    curr = handleNodes[hCurr];
    nodeHandles[curr] = nodeHandles[this.size];
    handleNodes[nodeHandles[curr]] = curr;

    --this.size;
    if (curr <= this.size) {
      if (curr <= 1) {
        this.floatDown(curr);
      } else {
        const parent = curr >> 1;
        const kParent = handleKeys[nodeHandles[parent]]!;
        const kCurr = handleKeys[nodeHandles[curr]]!;
        if (kParent.s < kCurr.s || (kParent.s === kCurr.s && kParent.t <= kCurr.t)) {
          this.floatDown(curr);
        } else {
          this.floatUp(curr);
        }
      }
    }
    handleKeys[hCurr] = null;
    handleNodes[hCurr] = this.freeList;
    this.freeList = hCurr;
  }
}
