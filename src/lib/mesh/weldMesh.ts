import type { ParsedMesh, Vec3 } from '../../types/mesh';

export type WeldedMesh = {
  vertices: Vec3[];
  faces: Array<[number, number, number]>;
};

const WELD_CHUNK_SIZE = 50_000;

function vertexKey(x: number, y: number, z: number, precision: number): string {
  const scale = 10 ** precision;
  return `${Math.round(x * scale)},${Math.round(y * scale)},${Math.round(z * scale)}`;
}

const yieldToBrowser = (): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, 0));

export async function weldMesh(mesh: ParsedMesh, precision = 5): Promise<WeldedMesh> {
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

  for (let chunkStart = 0; chunkStart < mesh.faceCount; chunkStart += WELD_CHUNK_SIZE) {
    await yieldToBrowser();
    const chunkEnd = Math.min(chunkStart + WELD_CHUNK_SIZE, mesh.faceCount);
    for (let faceIndex = chunkStart; faceIndex < chunkEnd; faceIndex += 1) {
      const offset = faceIndex * 9;
      faces.push([
        getWeldedIndex(mesh.positions[offset], mesh.positions[offset + 1], mesh.positions[offset + 2]),
        getWeldedIndex(mesh.positions[offset + 3], mesh.positions[offset + 4], mesh.positions[offset + 5]),
        getWeldedIndex(mesh.positions[offset + 6], mesh.positions[offset + 7], mesh.positions[offset + 8]),
      ]);
    }
  }

  return { vertices, faces };
}
