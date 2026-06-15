import { BufferAttribute, BufferGeometry } from 'three';
import type { ParsedMesh } from '../../types/mesh';

export function createSurfaceGeometry(mesh: ParsedMesh): BufferGeometry {
  const geometry = new BufferGeometry();
  const positions = mesh.positions.slice();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));

  // Per-face centroid, identical for a triangle's three vertices, so the
  // height-mode shader can band per face the same way the exporter does
  // (the exporter assigns one band per triangle from its centroid).
  const centroids = new Float32Array(positions.length);
  for (let offset = 0; offset < positions.length; offset += 9) {
    const cx = (positions[offset] + positions[offset + 3] + positions[offset + 6]) / 3;
    const cy = (positions[offset + 1] + positions[offset + 4] + positions[offset + 7]) / 3;
    const cz = (positions[offset + 2] + positions[offset + 5] + positions[offset + 8]) / 3;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      centroids[offset + vertex * 3] = cx;
      centroids[offset + vertex * 3 + 1] = cy;
      centroids[offset + vertex * 3 + 2] = cz;
    }
  }
  geometry.setAttribute('aFaceCentroid', new BufferAttribute(centroids, 3));

  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
