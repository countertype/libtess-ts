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

import { ActiveRegion } from './Mesh';
import { Tessellator } from './Tessellator';

export class DictNode {
  key: ActiveRegion | null = null;
  next: DictNode | null = null;
  prev: DictNode | null = null;
}

export class Dict {
	head: DictNode = new DictNode();
	
	constructor(public frame: Tessellator, public leq: (frame: Tessellator, a: ActiveRegion, b: ActiveRegion) => boolean) {
		this.head.next = this.head;
		this.head.prev = this.head;
	}

	min() {
		return this.head.next;
	}

	max() {
		return this.head.prev;
	}

	insert(k: ActiveRegion) {
		return this.insertBefore(this.head, k);
	}

	search(key: ActiveRegion) {
		/* Search returns the node with the smallest key greater than or equal
		 * to the given key.  If there is no such key, returns a node whose
		 * key is NULL.  Similarly, Succ(Max(d)) has a NULL key, etc.
		 */
		let node = this.head;
		do {
			node = node.next;
		} while (node.key !== null && !this.leq(this.frame, key, node.key));

		return node;
	}

	insertBefore(node: DictNode, key: ActiveRegion) {
		do {
			node = node.prev;
		} while (node.key !== null && !this.leq(this.frame, node.key, key));

		const newNode = new DictNode();
		newNode.key = key;
		newNode.next = node.next;
		node.next.prev = newNode;
		newNode.prev = node;
		node.next = newNode;

		return newNode;
	}

	delete(node:DictNode) {
		node.next.prev = node.prev;
		node.prev.next = node.next;
	}
}
