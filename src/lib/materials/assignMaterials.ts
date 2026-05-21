import type { AssignmentMode, Axis, ParsedMesh, Vec3 } from '../../types/mesh';
import { getMeshCentroidRange, getTriangleCentroidComponent, getTriangleNormal } from '../geometry/analyzeMesh';
import { normalize } from '../mesh/vector';

const AXIS_INDEX: Record<Axis, number> = { x: 0, y: 1, z: 2 };
const ASSIGNMENT_CHUNK_SIZE = 50_000;

const yieldToBrowser = (): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, 0));

function quantize(value: number, materialCount: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return Math.min(materialCount - 1, Math.floor(clamped * materialCount));
}

function bandToMaterialIndex(band: number, materialCount: number): number {
  if (materialCount <= 1) {
    return 0;
  }
  if (band <= 0) {
    return 1;
  }
  if (band >= materialCount - 1) {
    return 0;
  }
  return band + 1;
}

export type AssignmentParams = {
  mode: AssignmentMode;
  lightDirection: Vec3;
  axis: Axis;
  materialCount: number;
};

export async function computeAssignments(mesh: ParsedMesh, params: AssignmentParams): Promise<Uint8Array> {
  const assignments = new Uint8Array(mesh.faceCount);
  const { materialCount } = params;

  if (params.mode === 'directional') {
    const light = normalize(params.lightDirection);
    for (let chunkStart = 0; chunkStart < mesh.faceCount; chunkStart += ASSIGNMENT_CHUNK_SIZE) {
      await yieldToBrowser();
      const chunkEnd = Math.min(chunkStart + ASSIGNMENT_CHUNK_SIZE, mesh.faceCount);
      for (let faceIndex = chunkStart; faceIndex < chunkEnd; faceIndex += 1) {
        const normal = getTriangleNormal(mesh.positions, faceIndex);
        const brightness = Math.max(0, normal[0] * light[0] + normal[1] * light[1] + normal[2] * light[2]);
        const band = quantize(brightness, materialCount);
        assignments[faceIndex] = bandToMaterialIndex(band, materialCount);
      }
    }
    return assignments;
  }

  await yieldToBrowser();
  const axisIndex = AXIS_INDEX[params.axis];
  const [min, max] = getMeshCentroidRange(mesh, axisIndex);
  const span = max === min ? 1 : max - min;

  for (let chunkStart = 0; chunkStart < mesh.faceCount; chunkStart += ASSIGNMENT_CHUNK_SIZE) {
    await yieldToBrowser();
    const chunkEnd = Math.min(chunkStart + ASSIGNMENT_CHUNK_SIZE, mesh.faceCount);
    for (let faceIndex = chunkStart; faceIndex < chunkEnd; faceIndex += 1) {
      const value = getTriangleCentroidComponent(mesh.positions, faceIndex, axisIndex);
      const band = quantize((value - min) / span, materialCount);
      assignments[faceIndex] = bandToMaterialIndex(band, materialCount);
    }
  }
  return assignments;
}
