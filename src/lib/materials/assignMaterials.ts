import type { Axis, ParsedMesh, Vec3 } from '../../types/mesh';
import { getMeshCentroidRange, getTriangleCentroidComponent, getTriangleNormal } from '../geometry/analyzeMesh';
import { normalize } from '../mesh/vector';

const AXIS_INDEX: Record<Axis, number> = { x: 0, y: 1, z: 2 };

function quantize(value: number, materialCount: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return Math.min(materialCount - 1, Math.floor(clamped * materialCount));
}

export function assignByDirectionalLight(mesh: ParsedMesh, lightDirection: Vec3, materialCount: number): Uint8Array {
  const normalizedLight = normalize(lightDirection);
  const assignments = new Uint8Array(mesh.faceCount);

  for (let faceIndex = 0; faceIndex < mesh.faceCount; faceIndex += 1) {
    const normal = getTriangleNormal(mesh.positions, faceIndex);
    const brightness = Math.max(
      0,
      normal[0] * normalizedLight[0] + normal[1] * normalizedLight[1] + normal[2] * normalizedLight[2],
    );
    assignments[faceIndex] = quantize(brightness, materialCount);
  }

  return assignments;
}

export function assignByHeight(mesh: ParsedMesh, axis: Axis, materialCount: number): Uint8Array {
  const axisIndex = AXIS_INDEX[axis];
  const [min, max] = getMeshCentroidRange(mesh, axisIndex);
  const span = max - min;
  const assignments = new Uint8Array(mesh.faceCount);

  for (let faceIndex = 0; faceIndex < mesh.faceCount; faceIndex += 1) {
    assignments[faceIndex] = quantize((getTriangleCentroidComponent(mesh.positions, faceIndex, axisIndex) - min) / span, materialCount);
  }

  return assignments;
}
