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

// Based on libtess priorityq.c by Eric Veach (1994)
// Combines sorted array (for initial vertices) + heap (for intersections)
//
// This is a priority queue of vertices, ordered by vertLeq.
// The queue is implemented as a sorted array plus a heap.
// Initial vertices are stored and sorted, then intersections use the heap

import { Vertex } from "./Mesh";
import { PriorityQHeap } from "./PriorityQHeap";
import { Geom } from "./Geom";

export class PriorityQ {
  private heap: PriorityQHeap;
  private keys: Array<Vertex> = [];
  private order: Array<number> | null = null;
  private size: number = 0;
  private max: number = 0;
  private initialized: boolean = false;
  
  // Removed dynamic leq callback for performance
  // It's always Geom.vertLeq in this library

  constructor(size: number) {
    this.max = size;
    this.size = 0;
    this.initialized = false;
    
    // Create heap for dynamic intersections
    this.heap = new PriorityQHeap(size);
    
    // Allocate keys array for initial vertices
    this.keys = new Array(size);
  }

  // Insert a key into the priority queue
  insert(keyNew: Vertex): number {
    if (this.initialized) {
      return this.heap.insert(keyNew);
    }
    
    const curr = this.size;
    if (++this.size >= this.max) {
      // If the array overflows, double its size
      const oldMax = this.max;
      this.max *= 2;
      const newKeys = new Array(this.max);
      for (let i = 0; i < oldMax; i++) {
        newKeys[i] = this.keys[i];
      }
      this.keys = newKeys;
    }
    
    this.keys[curr] = keyNew;
    
    // Negative handles index the sorted array
    return -(curr + 1);
  }

  // Sort the keys array and initialize the heap
  // Uses native Array.sort() for speed!
  init(): boolean {
    // Create an array of indirect pointers to the keys
    this.order = new Array(this.size + 1);
    
    for (let i = 0; i < this.size; i++) {
      this.order[i] = i;
    }
    
    // Sort the indirect pointers in descending order
    // Use native Array.sort() - highly optimized!
    const keys = this.keys;
    // DIRECT CALL to Geom.vertLeq - allows inlining
    this.order.sort((a, b) => {
      return Geom.vertLeq(keys[a], keys[b]) ? 1 : -1;
    });
    
    this.max = this.size;
    this.initialized = true;
    this.heap.init();
    
    return true;
  }

  // Extract and return the minimum key
  extractMin(): Vertex | null {
    if (this.size === 0) {
      return this.heap.extractMin();
    }
    
    const sortMin = this.keys[this.order![this.size - 1]];
    if (!this.heap.isEmpty()) {
      const heapMin = this.heap.min();
      // Direct call
      if (heapMin && Geom.vertLeq(heapMin, sortMin)) {
        return this.heap.extractMin();
      }
    }
    
    // Remove from sorted array
    do {
      --this.size;
    } while (this.size > 0 && this.keys[this.order![this.size - 1]] === null);
    
    return sortMin;
  }

  // Return the minimum key without removing it
  min(): Vertex | null {
    if (this.size === 0) {
      return this.heap.min();
    }
    
    const sortMin = this.keys[this.order![this.size - 1]];
    if (!this.heap.isEmpty()) {
      const heapMin = this.heap.min();
      // Direct call
      if (heapMin && Geom.vertLeq(heapMin, sortMin)) {
        return heapMin;
      }
    }
    
    return sortMin;
  }

  // Remove a key from the queue (by handle)
  delete(handle: number): void {
    if (handle >= 0) {
      this.heap.delete(handle);
    } else {
      // Handle is in the sorted array
      const curr = -(handle + 1);
      this.keys[curr] = null as any;
    }
  }

  isEmpty(): boolean {
    return this.size === 0 && this.heap.isEmpty();
  }
}

