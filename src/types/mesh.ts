export type Vec3 = [number, number, number];

export type ParsedMesh = {
  name: string;
  originalFileName: string;
  positions: Float32Array;
  faceCount: number;
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

export type MaterialRecipe = {
  name: string;
  color: string;
  components?: { extruderId: number; ratio: number }[];
};
