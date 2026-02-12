import { DictNode } from './Mesh';
import { GluTesselator } from './GluTesselator';
import { vertLeq, edgeSign, edgeEval } from './Geom';

// edgeLeq lives here (rather than in Sweep) so Dict's search/insertBefore
// hot loops call it directly without indirection
function edgeLeq(tess: GluTesselator, reg1: DictNode, reg2: DictNode): boolean {
  const ev = tess.event;
  const e1 = reg1.eUp;
  const e2 = reg2.eUp;

  if (e1.Sym.Org === ev) {
    if (e2.Sym.Org === ev) {
      if (vertLeq(e1.Org, e2.Org)) {
        return edgeSign(e2.Sym.Org, e1.Org, e2.Org) <= 0;
      }
      return edgeSign(e1.Sym.Org, e2.Org, e1.Org) >= 0;
    }
    return edgeSign(e2.Sym.Org, ev, e2.Org) <= 0;
  }
  if (e2.Sym.Org === ev) {
    return edgeSign(e1.Sym.Org, ev, e1.Org) >= 0;
  }

  const t1 = edgeEval(e1.Sym.Org, ev, e1.Org);
  const t2 = edgeEval(e2.Sym.Org, ev, e2.Org);
  return t1 >= t2;
}

export class Dict {
  head: DictNode = new DictNode();
  frame: GluTesselator;

  constructor(frame: GluTesselator) {
    this.frame = frame;
    this.head.next = this.head;
    this.head.prev = this.head;
  }

  min() {
    return this.head.next;
  }

  max() {
    return this.head.prev;
  }

  insert(newNode: DictNode) {
    return this.insertBefore(this.head, newNode);
  }

  // Returns the node with the smallest key >= the given key,
  // or the head node (whose eUp is null) if no such key exists
  search(key: DictNode) {
    let node = this.head;
    do {
      node = node.next;
    } while (node.eUp !== null && !edgeLeq(this.frame, key, node));

    return node;
  }

  insertBefore(node: DictNode, newNode: DictNode) {
    do {
      node = node.prev;
    } while (node.eUp !== null && !edgeLeq(this.frame, node, newNode));

    newNode.next = node.next;
    node.next.prev = newNode;
    newNode.prev = node;
    node.next = newNode;

    return newNode;
  }

  delete(node: DictNode) {
    node.next.prev = node.prev;
    node.prev.next = node.next;
  }
}
