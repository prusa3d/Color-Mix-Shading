import { ShaderMaterial, Vector3 } from 'three';
import type { AssignmentMode, Axis, PaletteMaterial, Vec3 } from '../../types/mesh';
import { mixFilamentsCached } from './mixCache';

const MAX_PALETTE = 8;
const MIX_BINS = 16;
const MIX_STEPS = MIX_BINS + 1;
const MIX_LUT_SIZE = MAX_PALETTE * MIX_STEPS;
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
uniform int uHasSecondLight;
uniform vec3 uLightDir2;
uniform vec3 uMixLut[${MIX_LUT_SIZE}];

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
  vec3 N = normalize(vWorldNormal);
  float value;
  if (uMode == 0) {
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

  if (uHasSecondLight == 1) {
    float v2 = max(0.0, dot(N, normalize(uLightDir2)));
    int band2 = int(clamp(floor(v2 * float(${MIX_STEPS})), 0.0, float(${MIX_STEPS - 1})));
    int lutIndex = band * ${MIX_STEPS} + band2;
    vec3 mixed = uMixLut[0];
    for (int i = 0; i < ${MIX_LUT_SIZE}; i++) {
      if (i == lutIndex) mixed = uMixLut[i];
    }
    color = mixed;
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
  secondLight: { direction: Vec3; color: string } | null;
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
      uHasSecondLight: { value: 0 },
      uLightDir2: { value: new Vector3(0, 0, 1) },
      uMixLut: { value: Array.from({ length: MIX_LUT_SIZE }, () => new Vector3(1, 1, 1)) },
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

  if (params.secondLight && params.mode === 'directional') {
    const [dx, dy, dz] = params.secondLight.direction;
    (uniforms.uLightDir2.value as Vector3).set(dx, dy, dz).normalize();
    uniforms.uHasSecondLight.value = 1;

    const lutSlots = uniforms.uMixLut.value as Vector3[];
    const secondHex = params.secondLight.color;
    const paletteLen = params.palette.length;
    const highlightHex = params.palette[0].color;
    const shadowHex = params.palette[1].color;
    for (let band1 = 0; band1 < paletteLen; band1 += 1) {
      const v1 = paletteLen > 1 ? band1 / (paletteLen - 1) : 0;
      for (let band2 = 0; band2 < MIX_STEPS; band2 += 1) {
        const v2 = band2 / (MIX_STEPS - 1);
        const total = v1 + v2;
        const light1Ratio = total > 1 ? v1 / total : v1;
        const light2Ratio = total > 1 ? v2 / total : v2;
        const shadowRatio = total > 1 ? 0 : 1 - total;
        const mixed = mixFilamentsCached([
          { hex: highlightHex, ratio: light1Ratio },
          { hex: shadowHex, ratio: shadowRatio },
          { hex: secondHex, ratio: light2Ratio },
        ]);
        const r = Math.min(1, Math.max(0, mixed.rgb.r / 255));
        const g = Math.min(1, Math.max(0, mixed.rgb.g / 255));
        const b = Math.min(1, Math.max(0, mixed.rgb.b / 255));
        lutSlots[band1 * MIX_STEPS + band2].set(r, g, b);
      }
    }
  } else {
    uniforms.uHasSecondLight.value = 0;
  }
}
