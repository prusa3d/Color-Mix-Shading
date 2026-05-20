import { Grid, OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MeshBasicMaterial, OrthographicCamera, PointsMaterial, Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { PaletteMaterial, ParsedMesh, PreviewMesh, PreviewMode } from '../types/mesh';
import { createColoredPreviewGeometry, createPointPreviewGeometry } from '../lib/preview/createPreviewGeometry';

type PreviewViewportProps = {
  originalFaceCount: number;
  originalMesh: ParsedMesh | null;
  previewMesh: PreviewMesh | null;
  assignments: Uint8Array;
  palette: PaletteMaterial[];
  previewMode: PreviewMode;
  orbitEnabled: boolean;
  pointSize: number;
};

const CAMERA_VIEWS = {
  front: {
    label: 'Front',
    direction: new Vector3(0, -1, 0),
    up: new Vector3(0, 0, 1),
  },
  back: {
    label: 'Back',
    direction: new Vector3(0, 1, 0),
    up: new Vector3(0, 0, 1),
  },
  right: {
    label: 'Right Side',
    direction: new Vector3(1, 0, 0),
    up: new Vector3(0, 0, 1),
  },
  left: {
    label: 'Left Side',
    direction: new Vector3(-1, 0, 0),
    up: new Vector3(0, 0, 1),
  },
  top: {
    label: 'Top',
    direction: new Vector3(0, 0, 1),
    up: new Vector3(0, 1, 0),
  },
  iso: {
    label: 'Iso',
    direction: new Vector3(1, -1, 1).normalize(),
    up: new Vector3(0, 0, 1),
  },
} as const;

type CameraView = keyof typeof CAMERA_VIEWS;
type MeshBounds = {
  center: Vector3;
  size: Vector3;
  corners: Vector3[];
  maxDimension: number;
};

const PRESET_VIEW_PADDING = 1.1;
const MIN_VIEW_SIZE = 1;

function computeMeshBounds(mesh: ParsedMesh | PreviewMesh | null): MeshBounds | null {
  if (!mesh || mesh.positions.length < 3) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < mesh.positions.length; index += 3) {
    const x = mesh.positions[index];
    const y = mesh.positions[index + 1];
    const z = mesh.positions[index + 2];

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  if (![minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite)) {
    return null;
  }

  const center = new Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  const size = new Vector3(maxX - minX, maxY - minY, maxZ - minZ);
  const maxDimension = Math.max(size.x, size.y, size.z, MIN_VIEW_SIZE);

  return {
    center,
    size,
    maxDimension,
    corners: [
      new Vector3(minX, minY, minZ),
      new Vector3(minX, minY, maxZ),
      new Vector3(minX, maxY, minZ),
      new Vector3(minX, maxY, maxZ),
      new Vector3(maxX, minY, minZ),
      new Vector3(maxX, minY, maxZ),
      new Vector3(maxX, maxY, minZ),
      new Vector3(maxX, maxY, maxZ),
    ],
  };
}

function computeProjectedViewSize(bounds: MeshBounds, direction: Vector3, up: Vector3) {
  const forward = direction.clone().multiplyScalar(-1).normalize();
  const right = new Vector3().crossVectors(forward, up).normalize();
  const cameraUp = new Vector3().crossVectors(right, forward).normalize();
  let minHorizontal = Number.POSITIVE_INFINITY;
  let maxHorizontal = Number.NEGATIVE_INFINITY;
  let minVertical = Number.POSITIVE_INFINITY;
  let maxVertical = Number.NEGATIVE_INFINITY;

  bounds.corners.forEach((corner) => {
    const offset = corner.clone().sub(bounds.center);
    const horizontal = offset.dot(right);
    const vertical = offset.dot(cameraUp);
    minHorizontal = Math.min(minHorizontal, horizontal);
    maxHorizontal = Math.max(maxHorizontal, horizontal);
    minVertical = Math.min(minVertical, vertical);
    maxVertical = Math.max(maxVertical, vertical);
  });

  return {
    width: Math.max(maxHorizontal - minHorizontal, MIN_VIEW_SIZE),
    height: Math.max(maxVertical - minVertical, MIN_VIEW_SIZE),
  };
}

function DemandRenderSignal({ version }: { version: string }) {
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    invalidate();
  }, [invalidate, version]);

  return null;
}

function PresetCameraRig({
  bounds,
  cameraView,
  orbitControls,
}: {
  bounds: MeshBounds | null;
  cameraView: CameraView;
  orbitControls: React.RefObject<OrbitControlsImpl | null>;
}) {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const size = useThree((state) => state.size);

  useLayoutEffect(() => {
    if (!bounds || !(camera instanceof OrthographicCamera)) {
      return;
    }

    const view = CAMERA_VIEWS[cameraView];
    const center = bounds.center.clone();
    const direction = view.direction.clone().normalize();
    const distance = Math.max(bounds.maxDimension * 2, MIN_VIEW_SIZE * 2);
    const projectedSize = computeProjectedViewSize(bounds, direction, view.up);
    const paddedWidth = projectedSize.width * PRESET_VIEW_PADDING;
    const paddedHeight = projectedSize.height * PRESET_VIEW_PADDING;

    camera.up.copy(view.up);
    camera.position.copy(center).addScaledVector(direction, distance);
    camera.zoom = Math.min(size.width / paddedWidth, size.height / paddedHeight);
    camera.near = Math.max(0.01, distance - bounds.maxDimension * 4);
    camera.far = distance + bounds.maxDimension * 4;
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    if (orbitControls.current) {
      orbitControls.current.target.copy(center);
      orbitControls.current.update();
    }

    invalidate();
  }, [bounds, camera, cameraView, invalidate, orbitControls, size.height, size.width]);

  return null;
}

function MeshPreview({
  previewMesh,
  assignments,
  palette,
  previewMode,
  pointSize,
}: {
  previewMesh: PreviewMesh;
  assignments: Uint8Array;
  palette: PaletteMaterial[];
  previewMode: PreviewMode;
  pointSize: number;
}) {
  const meshGeometry = useMemo(
    () => (previewMode !== 'points' ? createColoredPreviewGeometry(previewMesh, assignments, palette) : null),
    [assignments, palette, previewMesh, previewMode],
  );
  const pointGeometry = useMemo(
    () => (previewMode === 'points' ? createPointPreviewGeometry(previewMesh, assignments, palette) : null),
    [assignments, palette, previewMesh, previewMode],
  );
  const meshMaterial = useMemo(() => new MeshBasicMaterial({ vertexColors: true }), []);
  const pointMaterial = useMemo(
    () => new PointsMaterial({
      vertexColors: true,
      size: pointSize,
      sizeAttenuation: false,
      depthTest: true,
      transparent: false,
      opacity: 1,
    }),
    [pointSize],
  );

  useEffect(() => () => {
    meshGeometry?.dispose();
  }, [meshGeometry]);

  useEffect(() => () => {
    pointGeometry?.dispose();
  }, [pointGeometry]);

  useEffect(() => () => {
    meshMaterial.dispose();
    pointMaterial.dispose();
  }, [meshMaterial, pointMaterial]);

  if (previewMode === 'points' && pointGeometry) {
    return <points geometry={pointGeometry} material={pointMaterial} />;
  }

  if (!meshGeometry) {
    return null;
  }

  return <mesh geometry={meshGeometry} material={meshMaterial} />;
}

export function PreviewViewport({
  originalFaceCount,
  originalMesh,
  previewMesh,
  assignments,
  palette,
  previewMode,
  orbitEnabled,
  pointSize,
}: PreviewViewportProps) {
  const [cameraView, setCameraView] = useState<CameraView>('iso');
  const orbitControls = useRef<OrbitControlsImpl | null>(null);
  const bounds = useMemo(() => computeMeshBounds(originalMesh ?? previewMesh), [originalMesh, previewMesh]);
  const renderVersion = `${cameraView}-${previewMode}-${pointSize}-${previewMesh?.faceCount ?? 0}-${assignments.length}-${palette.map((item) => item.color).join('|')}`;

  return (
    <section className="viewport-panel">
      <div className="viewport-header">
        <div>
          <p className="eyebrow">Preview</p>
          <h2>{previewMesh ? previewMesh.name : 'Import a mesh'}</h2>
        </div>
        {previewMesh ? (
          <p className="viewport-meta">
            {previewMesh.faceCount.toLocaleString()} shown / {originalFaceCount.toLocaleString()} faces
            {previewMesh.sampled ? ' - sampled' : ''}
          </p>
        ) : null}
      </div>
      {previewMesh ? (
        <div className="view-buttons">
          {(Object.keys(CAMERA_VIEWS) as CameraView[]).map((view) => (
            <button className={cameraView === view ? 'active' : ''} type="button" key={view} onClick={() => setCameraView(view)}>
              {CAMERA_VIEWS[view].label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="canvas-frame">
        {previewMesh ? (
          <Canvas orthographic camera={{ position: [1, -1, 1], near: 0.1, far: 10000, zoom: 1 }} frameloop="demand">
            <color attach="background" args={['#f6f8fb']} />
            <Grid
              args={[300, 300]}
              cellColor="#cbd5e1"
              sectionColor="#7c8da3"
              cellThickness={0.45}
              sectionThickness={0.9}
              fadeDistance={340}
              fadeStrength={1.4}
              infiniteGrid
            />
            <MeshPreview previewMesh={previewMesh} assignments={assignments} palette={palette} previewMode={previewMode} pointSize={pointSize} />
            <OrbitControls ref={orbitControls} makeDefault enabled={orbitEnabled} enableDamping={false} />
            <PresetCameraRig bounds={bounds} cameraView={cameraView} orbitControls={orbitControls} />
            <DemandRenderSignal version={renderVersion} />
          </Canvas>
        ) : (
          <div className="empty-preview">
            <strong>No mesh loaded</strong>
            <span>Upload an STL or OBJ to assign palette bands by light direction or height.</span>
          </div>
        )}
      </div>
    </section>
  );
}
