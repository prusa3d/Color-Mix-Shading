import type { ParsedMesh, Vec3 } from '../../types/mesh';

export type WeldedMesh = {
  vertices: Vec3[];
  faces: Array<[number, number, number]>;
};

function vertexKey(x: number, y: number, z: number, precision: number): string {
  const scale = 10 ** precision;
  return `${Math.round(x * scale)},${Math.round(y * scale)},${Math.round(z * scale)}`;
}

export function weldMesh(mesh: ParsedMesh, precision = 5): WeldedMesh {
  const vertices: Vec3[] = [];
  const faces: Array<[number, number, number]> = [];
  const vertexMap = new Map<string, number>();

  const getWeldedIndex = (x: number, y: number, z: number): number => {
    const key = vertexKey(x, y, z, precision);
    const mapped = vertexMap.get(key);

    if (mapped !== undefined) {
      return mapped;
    }

    const nextIndex = vertices.length;
    vertices.push([x, y, z]);
    vertexMap.set(key, nextIndex);
    return nextIndex;
  };

  for (let faceIndex = 0; faceIndex < mesh.faceCount; faceIndex += 1) {
    const offset = faceIndex * 9;
    faces.push([
      getWeldedIndex(mesh.positions[offset], mesh.positions[offset + 1], mesh.positions[offset + 2]),
      getWeldedIndex(mesh.positions[offset + 3], mesh.positions[offset + 4], mesh.positions[offset + 5]),
      getWeldedIndex(mesh.positions[offset + 6], mesh.positions[offset + 7], mesh.positions[offset + 8]),
    ]);
  }

  return { vertices, faces };
}
