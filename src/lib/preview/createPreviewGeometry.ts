import { BufferAttribute, BufferGeometry } from 'three';
import type { PaletteMaterial, PreviewMesh } from '../../types/mesh';

function hexToRgb(color: string): [number, number, number] {
  const normalized = color.replace('#', '');
  return [
    Number.parseInt(normalized.slice(0, 2), 16) / 255,
    Number.parseInt(normalized.slice(2, 4), 16) / 255,
    Number.parseInt(normalized.slice(4, 6), 16) / 255,
  ];
}

function materialColor(assignments: Uint8Array, palette: PaletteMaterial[], sourceFaceIndex: number): [number, number, number] {
  const materialIndex = assignments[sourceFaceIndex] ?? 0;
  return hexToRgb(palette[materialIndex]?.color ?? palette[0]?.color ?? '#ffffff');
}

export function createColoredPreviewGeometry(
  previewMesh: PreviewMesh,
  assignments: Uint8Array,
  palette: PaletteMaterial[],
): BufferGeometry {
  const positions = previewMesh.positions.slice();
  const colors = new Float32Array(previewMesh.faceCount * 9);

  for (let faceIndex = 0; faceIndex < previewMesh.faceCount; faceIndex += 1) {
    const color = materialColor(assignments, palette, previewMesh.sourceFaceIndices[faceIndex] ?? faceIndex);

    for (let localIndex = 0; localIndex < 3; localIndex += 1) {
      const offset = faceIndex * 9 + localIndex * 3;
      colors[offset] = color[0];
      colors[offset + 1] = color[1];
      colors[offset + 2] = color[2];
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

export function createPointPreviewGeometry(
  previewMesh: PreviewMesh,
  assignments: Uint8Array,
  palette: PaletteMaterial[],
): BufferGeometry {
  const positions = new Float32Array(previewMesh.faceCount * 3);
  const colors = new Float32Array(previewMesh.faceCount * 3);

  for (let faceIndex = 0; faceIndex < previewMesh.faceCount; faceIndex += 1) {
    const faceOffset = faceIndex * 9;
    const color = materialColor(assignments, palette, previewMesh.sourceFaceIndices[faceIndex] ?? faceIndex);
    const offset = faceIndex * 3;

    positions[offset] = (previewMesh.positions[faceOffset] + previewMesh.positions[faceOffset + 3] + previewMesh.positions[faceOffset + 6]) / 3;
    positions[offset + 1] = (previewMesh.positions[faceOffset + 1] + previewMesh.positions[faceOffset + 4] + previewMesh.positions[faceOffset + 7]) / 3;
    positions[offset + 2] = (previewMesh.positions[faceOffset + 2] + previewMesh.positions[faceOffset + 5] + previewMesh.positions[faceOffset + 8]) / 3;
    colors[offset] = color[0];
    colors[offset + 1] = color[1];
    colors[offset + 2] = color[2];
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}
