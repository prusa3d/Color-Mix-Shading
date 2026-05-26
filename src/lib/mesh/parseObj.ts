import { stripExtension } from '../export/download';
import type { ParsedMesh, Vec3 } from '../../types/mesh';

function parseObjIndex(token: string, vertexCount: number): number {
  const raw = Number(token.split('/')[0]);
  if (!Number.isFinite(raw) || raw === 0) {
    throw new Error(`Invalid OBJ face index: ${token}`);
  }

  return raw > 0 ? raw - 1 : vertexCount + raw;
}

export function parseObj(source: string, name: string): ParsedMesh {
  const vertices: Vec3[] = [];
  const positions: number[] = [];

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const parts = trimmed.split(/\s+/);
    if (parts[0] === 'v') {
      vertices.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
    }

    if (parts[0] === 'f') {
      const indices = parts.slice(1).map((token) => parseObjIndex(token, vertices.length));
      if (indices.length < 3) {
        continue;
      }

      for (let index = 1; index < indices.length - 1; index += 1) {
        const a = vertices[indices[0]];
        const b = vertices[indices[index]];
        const c = vertices[indices[index + 1]];
        positions.push(...a, ...b, ...c);
      }
    }
  }

  if (!vertices.length || !positions.length) {
    throw new Error('OBJ did not contain usable vertices and triangular faces.');
  }

  return {
    name,
    originalFileName: stripExtension(name),
    positions: new Float32Array(positions),
    faceCount: positions.length / 9,
  };
}
