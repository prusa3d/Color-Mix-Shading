import type { AssignmentMode, Axis, MaterialRecipe, PaletteMaterial, ParsedMesh, Vec3 } from '../../types/mesh';
import { getMeshCentroidRange, getTriangleCentroidComponent, getTriangleNormal } from '../geometry/analyzeMesh';
import { normalize } from '../mesh/vector';
import { mixFilamentsCached } from '../preview/mixCache';

const AXIS_INDEX: Record<Axis, number> = { x: 0, y: 1, z: 2 };
const ASSIGNMENT_CHUNK_SIZE = 50_000;

const yieldToBrowser = (): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, 0));

function quantize(value: number, materialCount: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return Math.min(materialCount - 1, Math.floor(clamped * materialCount));
}

function bandToMaterial(band: number, materialCount: number): number {
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

function roundRatio(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function paletteToMaterials(palette: PaletteMaterial[]): MaterialRecipe[] {
  const total = palette.length;
  return palette.map((entry, paletteIndex) => {
    if (paletteIndex < 2 || total <= 2) {
      return { name: entry.name, color: entry.color };
    }
    const highlightRatio = (paletteIndex - 1) / (total - 1);
    const shadowRatio = (total - paletteIndex) / (total - 1);
    return {
      name: entry.name,
      color: entry.color,
      components: [
        { extruderId: 1, ratio: roundRatio(highlightRatio) },
        { extruderId: 2, ratio: roundRatio(shadowRatio) },
      ].filter((c) => c.ratio > 0),
    };
  });
}

export type AssignmentParams = {
  mode: AssignmentMode;
  lightDirection: Vec3;
  axis: Axis;
  materialCount: number;
  palette: PaletteMaterial[];
  secondLight?: { direction: Vec3; color: string } | null;
};

export type AssignmentResult = {
  assignments: Uint8Array;
  materials: MaterialRecipe[];
};

export async function computeAssignments(
  mesh: ParsedMesh,
  params: AssignmentParams,
): Promise<AssignmentResult> {
  const { materialCount } = params;
  const assignments = new Uint8Array(mesh.faceCount);

  // Height (axis) mode — single-axis assignment, no lights.
  if (params.mode === 'height') {
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
        assignments[faceIndex] = bandToMaterial(band, materialCount);
      }
    }
    return { assignments, materials: paletteToMaterials(params.palette) };
  }

  // Directional, single-light — legacy palette.
  if (!params.secondLight) {
    const light = normalize(params.lightDirection);
    for (let chunkStart = 0; chunkStart < mesh.faceCount; chunkStart += ASSIGNMENT_CHUNK_SIZE) {
      await yieldToBrowser();
      const chunkEnd = Math.min(chunkStart + ASSIGNMENT_CHUNK_SIZE, mesh.faceCount);
      for (let faceIndex = chunkStart; faceIndex < chunkEnd; faceIndex += 1) {
        const normal = getTriangleNormal(mesh.positions, faceIndex);
        const brightness = Math.max(0, normal[0] * light[0] + normal[1] * light[1] + normal[2] * light[2]);
        const band = quantize(brightness, materialCount);
        assignments[faceIndex] = bandToMaterial(band, materialCount);
      }
    }
    return { assignments, materials: paletteToMaterials(params.palette) };
  }

  // Directional, two-light — 3-way mix of highlight + shadow + secondLight.
  const light1 = normalize(params.lightDirection);
  const light2 = normalize(params.secondLight.direction);
  const highlightHex = params.palette[0].color;
  const shadowHex = params.palette[1].color;
  const secondHex = params.secondLight.color;

  const materials: MaterialRecipe[] = [
    { name: 'Highlight', color: highlightHex },
    { name: 'Shadow', color: shadowHex },
    { name: 'Second light', color: secondHex },
  ];

  const bandToIndex = new Map<number, number>();

  for (let band1 = 0; band1 < materialCount; band1 += 1) {
    const v1 = materialCount > 1 ? band1 / (materialCount - 1) : 0;
    for (let band2 = 0; band2 < materialCount; band2 += 1) {
      const v2 = materialCount > 1 ? band2 / (materialCount - 1) : 0;
      const total = v1 + v2;
      const l1 = total > 1 ? v1 / total : v1;
      const l2 = total > 1 ? v2 / total : v2;
      const sh = total > 1 ? 0 : 1 - total;

      let materialIndex: number;
      if (l1 >= 0.9999) {
        materialIndex = 0;
      } else if (sh >= 0.9999) {
        materialIndex = 1;
      } else if (l2 >= 0.9999) {
        materialIndex = 2;
      } else {
        const mixed = mixFilamentsCached([
          { hex: highlightHex, ratio: l1 },
          { hex: shadowHex, ratio: sh },
          { hex: secondHex, ratio: l2 },
        ]);
        const components = [
          { extruderId: 1, ratio: roundRatio(l1) },
          { extruderId: 2, ratio: roundRatio(sh) },
          { extruderId: 3, ratio: roundRatio(l2) },
        ].filter((c) => c.ratio > 0);
        materialIndex = materials.length;
        materials.push({
          name: `Mix L1 ${Math.round(l1 * 100)}% / S ${Math.round(sh * 100)}% / L2 ${Math.round(l2 * 100)}%`,
          color: mixed.hex,
          components,
        });
      }

      bandToIndex.set(band1 * materialCount + band2, materialIndex);
    }
  }

  for (let chunkStart = 0; chunkStart < mesh.faceCount; chunkStart += ASSIGNMENT_CHUNK_SIZE) {
    await yieldToBrowser();
    const chunkEnd = Math.min(chunkStart + ASSIGNMENT_CHUNK_SIZE, mesh.faceCount);
    for (let faceIndex = chunkStart; faceIndex < chunkEnd; faceIndex += 1) {
      const normal = getTriangleNormal(mesh.positions, faceIndex);
      const v1 = Math.max(0, normal[0] * light1[0] + normal[1] * light1[1] + normal[2] * light1[2]);
      const v2 = Math.max(0, normal[0] * light2[0] + normal[1] * light2[1] + normal[2] * light2[2]);
      const band1 = quantize(v1, materialCount);
      const band2 = quantize(v2, materialCount);
      assignments[faceIndex] = bandToIndex.get(band1 * materialCount + band2) ?? 1;
    }
  }

  return { assignments, materials };
}
