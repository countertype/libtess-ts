/*
 * Copyright 2000, Silicon Graphics, Inc. All Rights Reserved.
 * Copyright 2025, Countertype LLC. All Rights Reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice including the dates of first publication and
 * either this permission notice or a reference to http://oss.sgi.com/projects/FreeB/
 * shall be included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * SILICON GRAPHICS, INC. BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 * WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
 * IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * Original Code. The Original Code is: OpenGL Sample Implementation,
 * Version 1.2.1, released January 26, 2000, developed by Silicon Graphics,
 * Inc. The Original Code is Copyright (c) 1991-2000 Silicon Graphics, Inc.
 * Copyright in any portions created by third parties is as indicated
 * elsewhere herein. All Rights Reserved.
 */

// Based on libtess priorityq-heap.c by Eric Veach (1994)
// Binary heap (actually 4-ary heap) for dynamic priority queue operations
// Optimized with flat typed arrays instead of object arrays

import { assert } from "./Assert";
import { Vertex } from "./Mesh";
import { Geom } from "./Geom";

export class PriorityQHeap {
  max: number = 0;
  // Flat arrays instead of array of objects - better cache locality, fewer allocations
  nodeHandles: Int32Array; // nodes[i].handle
  handleKeys: Array<Vertex | null>; // handles[i].key
  handleNodes: Int32Array; // handles[i].node
  initialized: boolean = false;
  freeList: number = 0;
  size: number = 0;

  constructor(size: number) {
    this.max = size;
    
    // Allocate flat arrays - single allocation vs 2*(size+1) object allocations
    this.nodeHandles = new Int32Array(size + 1);
    this.handleKeys = new Array(size + 1);
    this.handleNodes = new Int32Array(size + 1);

    this.initialized = false;

    // so that Minimum() returns NULL
    this.nodeHandles[1] = 1;
    this.handleKeys[1] = null;
  }

  floatDown(curr: number) {
    const nodeHandles = this.nodeHandles;
    const handleKeys = this.handleKeys;
    const handleNodes = this.handleNodes;
    let hCurr, hChild;
    let child, minChild;

    hCurr = nodeHandles[curr];
    while (true) {
      // 4-ary heap: first child at 4*i - 2 (for 1-indexed)
      child = (curr << 2) - 2;

      if (child > this.size) {
        nodeHandles[curr] = hCurr;
        handleNodes[hCurr] = curr;
        break;
      }

      // Find minimum among up to 4 children
      minChild = child;
      let minHandle = nodeHandles[child];

      if (child + 1 <= this.size) {
        let h1 = nodeHandles[child + 1];
        if (Geom.vertLeq(handleKeys[h1]!, handleKeys[minHandle]!)) {
          minChild = child + 1;
          minHandle = h1;
        }
      }

      if (child + 2 <= this.size) {
        let h2 = nodeHandles[child + 2];
        if (Geom.vertLeq(handleKeys[h2]!, handleKeys[minHandle]!)) {
          minChild = child + 2;
          minHandle = h2;
        }
      }

      if (child + 3 <= this.size) {
        let h3 = nodeHandles[child + 3];
        if (Geom.vertLeq(handleKeys[h3]!, handleKeys[minHandle]!)) {
          minChild = child + 3;
          minHandle = h3;
        }
      }

      hChild = minHandle;
      if (Geom.vertLeq(handleKeys[hCurr]!, handleKeys[hChild]!)) {
        nodeHandles[curr] = hCurr;
        handleNodes[hCurr] = curr;
        break;
      }
      nodeHandles[curr] = hChild;
      handleNodes[hChild] = curr;
      curr = minChild;
    }
  }

  floatUp(curr: number) {
    const nodeHandles = this.nodeHandles;
    const handleKeys = this.handleKeys;
    const handleNodes = this.handleNodes;
    let hCurr, hParent;
    let parent;

    hCurr = nodeHandles[curr];
    while (true) {
      // 4-ary heap: parent = floor((child + 2) / 4)
      parent = (curr + 2) >> 2;
      if (parent === 0) {
        nodeHandles[curr] = hCurr;
        handleNodes[hCurr] = curr;
        break;
      }
      hParent = nodeHandles[parent];
      if (Geom.vertLeq(handleKeys[hParent]!, handleKeys[hCurr]!)) {
        nodeHandles[curr] = hCurr;
        handleNodes[hCurr] = curr;
        break;
      }
      nodeHandles[curr] = hParent;
      handleNodes[hParent] = curr;
      curr = parent;
    }
  }

  init() {
    // This method of building a heap is O(n), rather than O(n lg n).
    for (let i = this.size; i >= 1; --i) {
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

  // really pqHeapInsert
  // returns INV_HANDLE iff out of memory
  //PQhandle pqHeapInsert( Allocator* alloc, PriorityQHeap *pq, PQkey keyNew )
  insert(keyNew: Vertex) {
    let curr;
    let free;

    curr = ++this.size;
    if (curr * 2 > this.max) {
      this.max *= 2;
      // Resize flat arrays
      const newNodeHandles = new Int32Array(this.max + 1);
      const newHandleNodes = new Int32Array(this.max + 1);
      const newHandleKeys = new Array(this.max + 1);
      
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

  //PQkey pqHeapExtractMin( PriorityQHeap *pq )
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
      if (
        curr <= 1 ||
        Geom.vertLeq(handleKeys[nodeHandles[curr >> 2]]!, handleKeys[nodeHandles[curr]]!)
      ) {
        this.floatDown(curr);
      } else {
        this.floatUp(curr);
      }
    }
    handleKeys[hCurr] = null;
    handleNodes[hCurr] = this.freeList;
    this.freeList = hCurr;
  }
}
