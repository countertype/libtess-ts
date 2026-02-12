// Monotone region tessellation

import { Mesh, Face, HalfEdge } from './Mesh';
import { vertLeq, edgeGoesLeft, edgeGoesRight, edgeSign } from './Geom';

export class TessMono {
  static addWinding(eDst: HalfEdge, eSrc: HalfEdge): void {
    eDst.winding += eSrc.winding;
    eDst.Sym.winding += eSrc.Sym.winding;
  }

  // Tessellate a monotone region (single CCW loop of half-edges) into
  // triangles. "Monotone" means any vertical line intersects the interior
  // in a single interval.
  //
  // The algorithm (Preparata and Shamos) maintains two edge chains, upper
  // and lower, processing vertices right to left. After each vertex, the
  // untessellated region has one chain that is a single edge and another
  // that is concave. Each step adds the rightmost unprocessed vertex to
  // one chain and fans out as many triangles as possible, restoring the
  // invariant
  static tessellateMonoRegion(mesh: Mesh, face: Face): boolean {
    let up: HalfEdge, lo: HalfEdge;

    up = face.anEdge;
    if (!(up.Lnext !== up && up.Lnext.Lnext !== up)) {
      throw new Error('Monotone region has degenerate topology');
    }

    for (; vertLeq(up.Sym.Org, up.Org); up = up.Onext.Sym);
    for (; vertLeq(up.Org, up.Sym.Org); up = up.Lnext);

    lo = up.Onext.Sym;

    let tempHalfEdge!: HalfEdge;

    while (up.Lnext !== lo) {
      if (vertLeq(up.Sym.Org, lo.Org)) {
        // up.Sym.Org is on the left -- safe to fan triangles from lo.Org
        while (lo.Lnext !== up && (edgeGoesLeft(lo.Lnext) || edgeSign(lo.Org, lo.Sym.Org, lo.Lnext.Sym.Org) <= 0.0)) {
          tempHalfEdge = mesh.connect(lo.Lnext, lo);
          lo = tempHalfEdge.Sym;
        }
        lo = lo.Onext.Sym;
      } else {
        // lo.Org is on the left -- fan triangles from up.Sym.Org
        while (
          lo.Lnext !== up &&
          (edgeGoesRight(up.Onext.Sym) || edgeSign(up.Sym.Org, up.Org, up.Onext.Sym.Org) >= 0.0)
        ) {
          tempHalfEdge = mesh.connect(up, up.Onext.Sym);
          up = tempHalfEdge.Sym;
        }
        up = up.Lnext;
      }
    }

    // lo.Org == up.Sym.Org == the leftmost vertex; fan the remainder
    if (lo.Lnext === up) {
      throw new Error('Monotone region has insufficient vertices');
    }

    while (lo.Lnext.Lnext !== up) {
      tempHalfEdge = mesh.connect(lo.Lnext, lo);
      lo = tempHalfEdge.Sym;
    }

    return true;
  }

  // Tessellate all interior (monotone) regions
  static tessellateInterior(mesh: Mesh): boolean {
    let next: Face;

    for (let f = mesh.fHead.next; f !== mesh.fHead; f = next) {
      next = f!.next!;

      if (f!.inside) {
        if (!TessMono.tessellateMonoRegion(mesh, f!)) {
          return false;
        }
      }
    }

    return true;
  }
}
