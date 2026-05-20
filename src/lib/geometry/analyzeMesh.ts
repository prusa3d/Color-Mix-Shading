import type { ParsedMesh, Vec3 } from '../../types/mesh';

export function getTriangleNormal(positions: Float32Array, faceIndex: number): Vec3 {
  const offset = faceIndex * 9;
  const ax = positions[offset];
  const ay = positions[offset + 1];
  const az = positions[offset + 2];
  const bx = positions[offset + 3];
  const by = positions[offset + 4];
  const bz = positions[offset + 5];
  const cx = positions[offset + 6];
  const cy = positions[offset + 7];
  const cz = positions[offset + 8];
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  const length = Math.hypot(nx, ny, nz) || 1;
  return [nx / length, ny / length, nz / length];
}

export function getTriangleCentroidComponent(positions: Float32Array, faceIndex: number, axisIndex: number): number {
  const offset = faceIndex * 9 + axisIndex;
  return (positions[offset] + positions[offset + 3] + positions[offset + 6]) / 3;
}

export function getMeshCentroidRange(mesh: ParsedMesh, axisIndex: number): [number, number] {
  if (!mesh.faceCount) {
    return [0, 1];
  }

  let min = getTriangleCentroidComponent(mesh.positions, 0, axisIndex);
  let max = min;

  for (let faceIndex = 1; faceIndex < mesh.faceCount; faceIndex += 1) {
    const value = getTriangleCentroidComponent(mesh.positions, faceIndex, axisIndex);
    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  return min === max ? [min, min + 1] : [min, max];
}
