import { OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BufferGeometry, Line, LineBasicMaterial, MeshBasicMaterial, OrthographicCamera, Quaternion, Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { AssignmentMode, Axis, PaletteMaterial, ParsedMesh, Vec3 } from '../types/mesh';
import { createSurfaceGeometry } from '../lib/preview/createPreviewGeometry';
import { createShadingMaterial, updateShadingUniforms } from '../lib/preview/shadingMaterial';

type PreviewViewportProps = {
  mesh: ParsedMesh | null;
  palette: PaletteMaterial[];
  lightDirection: Vec3;
  mode: AssignmentMode;
  axis: Axis;
};

const AXIS_INDEX: Record<Axis, number> = { x: 0, y: 1, z: 2 };

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

function computeMeshBounds(mesh: ParsedMesh | null): MeshBounds | null {
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

function ShadedMesh({
  mesh,
  palette,
  lightDirection,
  mode,
  axis,
  heightMin,
  heightMax,
}: {
  mesh: ParsedMesh;
  palette: PaletteMaterial[];
  lightDirection: Vec3;
  mode: AssignmentMode;
  axis: Axis;
  heightMin: number;
  heightMax: number;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const geometry = useMemo(() => createSurfaceGeometry(mesh), [mesh]);
  const material = useMemo(() => createShadingMaterial(), []);

  useEffect(() => {
    updateShadingUniforms(material, { lightDirection, palette, mode, axis, heightMin, heightMax });
    invalidate();
  }, [axis, heightMax, heightMin, invalidate, lightDirection, material, mode, palette]);

  useEffect(() => () => {
    geometry.dispose();
  }, [geometry]);

  useEffect(() => () => {
    material.dispose();
  }, [material]);

  return <mesh geometry={geometry} material={material} />;
}

function LightDirectionHelper({
  bounds,
  lightDirection,
}: {
  bounds: MeshBounds | null;
  lightDirection: Vec3;
}) {
  const lightVector = useMemo(() => new Vector3(lightDirection[0], lightDirection[1], lightDirection[2]).normalize(), [lightDirection]);
  const geometry = useMemo(() => {
    const center = bounds?.center ?? new Vector3();
    const distance = (bounds?.maxDimension ?? MIN_VIEW_SIZE) * 0.85 + MIN_VIEW_SIZE * 0.35;
    const sunPosition = center.clone().addScaledVector(lightVector, distance);
    return new BufferGeometry().setFromPoints([sunPosition, center]);
  }, [bounds, lightVector]);
  const lineMaterial = useMemo(() => new LineBasicMaterial({ color: '#f59e0b', depthTest: false, depthWrite: false }), []);
  const line = useMemo(() => {
    const nextLine = new Line(geometry, lineMaterial);
    nextLine.renderOrder = 10;
    return nextLine;
  }, [geometry, lineMaterial]);
  const sunMaterial = useMemo(() => new MeshBasicMaterial({ color: '#fbbf24', depthTest: false, depthWrite: false }), []);
  const arrowMaterial = useMemo(() => new MeshBasicMaterial({ color: '#f59e0b', depthTest: false, depthWrite: false }), []);
  const helperScale = (bounds?.maxDimension ?? MIN_VIEW_SIZE) * 0.035 + MIN_VIEW_SIZE * 0.025;
  const center = bounds?.center ?? new Vector3();
  const helperDistance = (bounds?.maxDimension ?? MIN_VIEW_SIZE) * 0.85 + MIN_VIEW_SIZE * 0.35;
  const sunPosition = center.clone().addScaledVector(lightVector, helperDistance);
  const arrowDirection = lightVector.clone().multiplyScalar(-1).normalize();
  const arrowPosition = center.clone().addScaledVector(lightVector, helperDistance * 0.28);
  const arrowQuaternion = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), arrowDirection);

  useEffect(() => () => {
    geometry.dispose();
  }, [geometry]);

  useEffect(() => () => {
    lineMaterial.dispose();
    sunMaterial.dispose();
    arrowMaterial.dispose();
  }, [arrowMaterial, lineMaterial, sunMaterial]);

  return (
    <group renderOrder={10}>
      <primitive object={line} />
      <mesh position={sunPosition} material={sunMaterial} renderOrder={11}>
        <sphereGeometry args={[helperScale * 1.4, 24, 16]} />
      </mesh>
      <mesh position={arrowPosition} quaternion={arrowQuaternion} material={arrowMaterial} renderOrder={11}>
        <coneGeometry args={[helperScale, helperScale * 3, 24]} />
      </mesh>
    </group>
  );
}

export function PreviewViewport({
  mesh,
  palette,
  lightDirection,
  mode,
  axis,
}: PreviewViewportProps) {
  const [cameraView, setCameraView] = useState<CameraView>('iso');
  const orbitControls = useRef<OrbitControlsImpl | null>(null);
  const bounds = useMemo(() => computeMeshBounds(mesh), [mesh]);
  const heightRange = useMemo(() => {
    if (!bounds) {
      return { min: 0, max: 1 };
    }
    const axisIndex = AXIS_INDEX[axis];
    const half = bounds.size.getComponent(axisIndex) / 2;
    const center = bounds.center.getComponent(axisIndex);
    const min = center - half;
    const max = center + half;
    return min === max ? { min, max: min + 1 } : { min, max };
  }, [axis, bounds]);
  const renderVersion = `${cameraView}-${mesh?.faceCount ?? 0}-${palette.map((item) => item.color).join('|')}-${lightDirection.join(',')}-${mode}-${axis}`;

  return (
    <section className="viewport-panel">
      <div className="viewport-header">
        <div>
          <p className="eyebrow">Preview</p>
          <h2>{mesh ? mesh.name : 'Import a mesh'}</h2>
        </div>
        {mesh ? (
          <p className="viewport-meta">{mesh.faceCount.toLocaleString()} faces</p>
        ) : null}
      </div>
      {mesh ? (
        <div className="view-buttons">
          {(Object.keys(CAMERA_VIEWS) as CameraView[]).map((view) => (
            <button className={cameraView === view ? 'active' : ''} type="button" key={view} onClick={() => setCameraView(view)}>
              {CAMERA_VIEWS[view].label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="canvas-frame">
        {mesh ? (
          <Canvas orthographic camera={{ position: [1, -1, 1], near: 0.1, far: 10000, zoom: 1 }} frameloop="demand">
            <color attach="background" args={['#f6f8fb']} />
            <ShadedMesh
              mesh={mesh}
              palette={palette}
              lightDirection={lightDirection}
              mode={mode}
              axis={axis}
              heightMin={heightRange.min}
              heightMax={heightRange.max}
            />
            {mode === 'directional' ? (
              <LightDirectionHelper bounds={bounds} lightDirection={lightDirection} />
            ) : null}
            <OrbitControls ref={orbitControls} makeDefault enableDamping={false} />
            <PresetCameraRig bounds={bounds} cameraView={cameraView} orbitControls={orbitControls} />
            <DemandRenderSignal version={renderVersion} />
          </Canvas>
        ) : (
          <div className="empty-preview">
            <strong>No mesh loaded</strong>
            <span>Drop an STL or OBJ anywhere on the window to load it.</span>
          </div>
        )}
      </div>
    </section>
  );
}
