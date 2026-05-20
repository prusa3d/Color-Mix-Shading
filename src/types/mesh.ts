export type Vec3 = [number, number, number];

export type ParsedMesh = {
  name: string;
  positions: Float32Array;
  faceCount: number;
};

export type PreviewMesh = ParsedMesh & {
  sourceFaceIndices: Uint32Array;
  faceLimit: number;
  sampled: boolean;
};

export type FaceMetrics = {
  normal: Vec3;
  centroid: Vec3;
};

export type PaletteMaterial = {
  id: string;
  name: string;
  color: string;
};

export type AssignmentMode = 'directional' | 'height';
export type Axis = 'x' | 'y' | 'z';
export type PreviewQuality = 'low' | 'medium' | 'high' | 'full';
export type PreviewMode = 'surface' | 'points' | 'sampled-triangles';
