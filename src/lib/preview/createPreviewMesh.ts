import type { ParsedMesh, PreviewMesh } from '../../types/mesh';

export const PREVIEW_FACE_LIMITS = {
  low: 25_000,
  medium: 75_000,
  high: 150_000,
  full: Number.POSITIVE_INFINITY,
} as const;

export function createFullPreviewMesh(originalMesh: ParsedMesh): PreviewMesh {
  return {
    ...originalMesh,
    sourceFaceIndices: Uint32Array.from({ length: originalMesh.faceCount }, (_, index) => index),
    faceLimit: Number.POSITIVE_INFINITY,
    sampled: false,
  };
}

export function createSampledPreviewMesh(originalMesh: ParsedMesh, faceLimit: number): PreviewMesh {
  if (!Number.isFinite(faceLimit) || originalMesh.faceCount <= faceLimit) {
    return createFullPreviewMesh(originalMesh);
  }

  const targetFaceCount = Math.max(1, Math.floor(faceLimit));
  const sourceFaceIndices = new Uint32Array(targetFaceCount);
  const positions = new Float32Array(targetFaceCount * 9);

  for (let previewFaceIndex = 0; previewFaceIndex < targetFaceCount; previewFaceIndex += 1) {
    const sourceFaceIndex = Math.min(
      originalMesh.faceCount - 1,
      Math.floor((previewFaceIndex / targetFaceCount) * originalMesh.faceCount),
    );
    positions.set(
      originalMesh.positions.subarray(sourceFaceIndex * 9, sourceFaceIndex * 9 + 9),
      previewFaceIndex * 9,
    );
    sourceFaceIndices[previewFaceIndex] = sourceFaceIndex;
  }

  return {
    name: `${originalMesh.name} preview`,
    positions,
    faceCount: targetFaceCount,
    sourceFaceIndices,
    faceLimit,
    sampled: true,
  };
}
