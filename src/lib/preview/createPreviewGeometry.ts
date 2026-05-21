import { BufferAttribute, BufferGeometry } from 'three';
import type { ParsedMesh } from '../../types/mesh';

export function createSurfaceGeometry(mesh: ParsedMesh): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(mesh.positions.slice(), 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
