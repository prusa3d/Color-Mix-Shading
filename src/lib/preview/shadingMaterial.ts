import { ShaderMaterial, Vector3 } from 'three';
import type { AssignmentMode, Axis, PaletteMaterial, Vec3 } from '../../types/mesh';

const MAX_PALETTE = 8;
const AXIS_INDEX: Record<Axis, number> = { x: 0, y: 1, z: 2 };

const VERTEX_SHADER = /* glsl */ `
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vWorldNormal = mat3(modelMatrix) * normal;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec3 vWorldNormal;
varying vec3 vWorldPos;

uniform vec3 uLightDir;
uniform vec3 uPalette[${MAX_PALETTE}];
uniform int uMaterialCount;
uniform int uMode;
uniform float uHeightMin;
uniform float uHeightMax;
uniform int uHeightAxis;

int bandToMaterial(int band, int mc) {
  if (mc <= 1) return 0;
  if (band <= 0) return 1;
  if (band >= mc - 1) return 0;
  return band + 1;
}

float axisComponent(vec3 v, int i) {
  if (i == 0) return v.x;
  if (i == 1) return v.y;
  return v.z;
}

void main() {
  float value;
  if (uMode == 0) {
    vec3 N = normalize(vWorldNormal);
    value = max(0.0, dot(N, normalize(uLightDir)));
  } else {
    float span = max(uHeightMax - uHeightMin, 1e-6);
    value = clamp((axisComponent(vWorldPos, uHeightAxis) - uHeightMin) / span, 0.0, 1.0);
  }

  float fmc = float(uMaterialCount);
  int band = int(clamp(floor(value * fmc), 0.0, fmc - 1.0));
  int materialIndex = bandToMaterial(band, uMaterialCount);

  vec3 color = uPalette[0];
  for (int i = 0; i < ${MAX_PALETTE}; i++) {
    if (i == materialIndex) color = uPalette[i];
  }
  gl_FragColor = vec4(color, 1.0);
}
`;

export type ShadingParams = {
  lightDirection: Vec3;
  palette: PaletteMaterial[];
  mode: AssignmentMode;
  axis: Axis;
  heightMin: number;
  heightMax: number;
};

function hexToRgb(color: string): [number, number, number] {
  const normalized = color.replace('#', '');
  return [
    Number.parseInt(normalized.slice(0, 2), 16) / 255,
    Number.parseInt(normalized.slice(2, 4), 16) / 255,
    Number.parseInt(normalized.slice(4, 6), 16) / 255,
  ];
}

export function createShadingMaterial(): ShaderMaterial {
  const paletteSlots = Array.from({ length: MAX_PALETTE }, () => new Vector3(1, 1, 1));
  return new ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      uLightDir: { value: new Vector3(0, 0, 1) },
      uPalette: { value: paletteSlots },
      uMaterialCount: { value: 2 },
      uMode: { value: 0 },
      uHeightMin: { value: 0 },
      uHeightMax: { value: 1 },
      uHeightAxis: { value: 2 },
    },
  });
}

export function updateShadingUniforms(material: ShaderMaterial, params: ShadingParams): void {
  const { uniforms } = material;
  const [lx, ly, lz] = params.lightDirection;
  (uniforms.uLightDir.value as Vector3).set(lx, ly, lz).normalize();

  const slots = uniforms.uPalette.value as Vector3[];
  for (let i = 0; i < MAX_PALETTE; i += 1) {
    const swatch = params.palette[i];
    const [r, g, b] = swatch ? hexToRgb(swatch.color) : [1, 1, 1];
    slots[i].set(r, g, b);
  }

  uniforms.uMaterialCount.value = params.palette.length;
  uniforms.uMode.value = params.mode === 'directional' ? 0 : 1;
  uniforms.uHeightMin.value = params.heightMin;
  uniforms.uHeightMax.value = params.heightMax;
  uniforms.uHeightAxis.value = AXIS_INDEX[params.axis];
}
