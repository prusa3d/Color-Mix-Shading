import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { getTriangleCentroidComponent, getTriangleNormal } from './lib/geometry/analyzeMesh';
import { exportMeshAsThreeMf } from './lib/export/threeMf';
import { parseMeshFile } from './lib/mesh/parseMesh';
import { normalize } from './lib/mesh/vector';
import { createFullPreviewMesh, createSampledPreviewMesh, PREVIEW_FACE_LIMITS } from './lib/preview/createPreviewMesh';
import { PreviewViewport } from './components/PreviewViewport';
import type { AssignmentMode, Axis, PaletteMaterial, ParsedMesh, PreviewMesh, PreviewMode, PreviewQuality, Vec3 } from './types/mesh';

const DEFAULT_LIGHT: Vec3 = [0.35, 0.45, 0.82];
const DEFAULT_HIGHLIGHT = '#F8D36B';
const DEFAULT_SHADOW = '#6C2A00';
const POINT_LIMITS = [50_000, 100_000, 250_000];
const SURFACE_SAFE_FACE_COUNT = 150_000;
const SURFACE_WARN_FACE_COUNT = 500_000;
const ASSIGNMENT_CHUNK_SIZE = 20_000;
const AXIS_INDEX: Record<Axis, number> = { x: 0, y: 1, z: 2 };

function hexToRgb(color: string): [number, number, number] {
  const normalized = color.replace('#', '');
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

function mixHexColors(shadowColor: string, highlightColor: string, amount: number): string {
  const shadow = hexToRgb(shadowColor);
  const highlight = hexToRgb(highlightColor);
  return rgbToHex([
    shadow[0] + (highlight[0] - shadow[0]) * amount,
    shadow[1] + (highlight[1] - shadow[1]) * amount,
    shadow[2] + (highlight[2] - shadow[2]) * amount,
  ]);
}

function createShadingPalette(highlightColor: string, shadowColor: string, materialCount: number): PaletteMaterial[] {
  const palette: PaletteMaterial[] = [
    { id: 'mat-highlight', name: 'Material 1 highlight', color: highlightColor },
    { id: 'mat-shadow', name: 'Material 2 shadow', color: shadowColor },
  ];

  for (let band = 1; band < materialCount - 1; band += 1) {
    palette.push({
      id: `mat-shade-${band}`,
      name: `Material ${band + 2} shade ${band}`,
      color: mixHexColors(shadowColor, highlightColor, band / (materialCount - 1)),
    });
  }

  return palette;
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

function quantize(value: number, count: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return Math.min(count - 1, Math.floor(clamped * count));
}

export default function App() {
  const [originalMesh, setOriginalMesh] = useState<ParsedMesh | null>(null);
  const [previewMesh, setPreviewMesh] = useState<PreviewMesh | null>(null);
  const [previewQuality, setPreviewQuality] = useState<PreviewQuality>('medium');
  const [previewMode, setPreviewMode] = useState<PreviewMode>('surface');
  const [pointLimit, setPointLimit] = useState(100_000);
  const [pointSize, setPointSize] = useState(1.8);
  const [orbitEnabled, setOrbitEnabled] = useState(false);
  const [materialCount, setMaterialCount] = useState(4);
  const [highlightColor, setHighlightColor] = useState(DEFAULT_HIGHLIGHT);
  const [shadowColor, setShadowColor] = useState(DEFAULT_SHADOW);
  const [mode, setMode] = useState<AssignmentMode>('directional');
  const [axis, setAxis] = useState<Axis>('z');
  const [lightDirection, setLightDirection] = useState<Vec3>(DEFAULT_LIGHT);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<string>('Ready for STL or OBJ import.');
  const [error, setError] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<Uint8Array>(new Uint8Array());

  const palette = useMemo(
    () => createShadingPalette(highlightColor, shadowColor, materialCount),
    [highlightColor, materialCount, shadowColor],
  );
  useEffect(() => {
    if (!originalMesh) {
      setAssignments(new Uint8Array());
      return;
    }

    let isCancelled = false;
    const nextAssignments = new Uint8Array(originalMesh.faceCount);
    const normalizedLight = normalize(lightDirection);
    const axisIndex = AXIS_INDEX[axis];
    let heightMin = 0;
    let heightMax = 1;

    const assignChunk = (startIndex: number) => {
      const endIndex = Math.min(originalMesh.faceCount, startIndex + ASSIGNMENT_CHUNK_SIZE);

      for (let faceIndex = startIndex; faceIndex < endIndex; faceIndex += 1) {
        let band = 0;

        if (mode === 'height') {
          const value = getTriangleCentroidComponent(originalMesh.positions, faceIndex, axisIndex);
          band = quantize((value - heightMin) / (heightMax - heightMin), materialCount);
        } else {
          const normal = getTriangleNormal(originalMesh.positions, faceIndex);
          const brightness = Math.max(
            0,
            normal[0] * normalizedLight[0] + normal[1] * normalizedLight[1] + normal[2] * normalizedLight[2],
          );
          band = quantize(brightness, materialCount);
        }

        nextAssignments[faceIndex] = bandToMaterialIndex(band, materialCount);
      }

      if (isCancelled) {
        return;
      }

      if (endIndex < originalMesh.faceCount) {
        window.setTimeout(() => assignChunk(endIndex), 0);
        return;
      }

      setAssignments(nextAssignments);
      setStatus('Rendering preview...');
    };

    const scanHeightRangeChunk = (startIndex: number) => {
      const endIndex = Math.min(originalMesh.faceCount, startIndex + ASSIGNMENT_CHUNK_SIZE);

      for (let faceIndex = startIndex; faceIndex < endIndex; faceIndex += 1) {
        const value = getTriangleCentroidComponent(originalMesh.positions, faceIndex, axisIndex);
        heightMin = Math.min(heightMin, value);
        heightMax = Math.max(heightMax, value);
      }

      if (isCancelled) {
        return;
      }

      if (endIndex < originalMesh.faceCount) {
        window.setTimeout(() => scanHeightRangeChunk(endIndex), 0);
        return;
      }

      if (heightMin === heightMax) {
        heightMax = heightMin + 1;
      }
      window.setTimeout(() => assignChunk(0), 0);
    };

    setStatus('Assigning materials...');

    if (mode === 'height') {
      const first = getTriangleCentroidComponent(originalMesh.positions, 0, axisIndex);
      heightMin = first;
      heightMax = first;
      window.setTimeout(() => scanHeightRangeChunk(0), 0);
    } else {
      window.setTimeout(() => assignChunk(0), 0);
    }

    return () => {
      isCancelled = true;
    };
  }, [axis, lightDirection, materialCount, mode, originalMesh]);

  const surfacePreviewBlocked = Boolean(
    originalMesh && previewMode === 'surface' && originalMesh.faceCount > SURFACE_WARN_FACE_COUNT,
  );
  const sampledFullPreviewBlocked = Boolean(
    originalMesh
      && previewMode === 'sampled-triangles'
      && previewQuality === 'full'
      && originalMesh.faceCount > SURFACE_WARN_FACE_COUNT,
  );

  useEffect(() => {
    if (!originalMesh) {
      setPreviewMesh(null);
      return;
    }

    let isCancelled = false;
    const timeoutId = window.setTimeout(() => {
      if (previewMode === 'surface' && originalMesh.faceCount > SURFACE_WARN_FACE_COUNT) {
        setPreviewMesh(null);
        setStatus('Surface preview disabled for meshes over 500k faces. Use Point Preview.');
        return;
      }

      if (previewMode === 'sampled-triangles' && previewQuality === 'full' && originalMesh.faceCount > SURFACE_WARN_FACE_COUNT) {
        setPreviewMesh(null);
        setStatus('Full triangle preview disabled for meshes over 500k faces. Use Point Preview.');
        return;
      }

      setStatus('Creating preview...');
      const nextPreviewMesh = previewMode === 'surface'
        ? createFullPreviewMesh(originalMesh)
        : createSampledPreviewMesh(
            originalMesh,
            previewMode === 'points' ? pointLimit : PREVIEW_FACE_LIMITS[previewQuality],
          );

      if (isCancelled) {
        return;
      }

      setPreviewMesh(nextPreviewMesh);
      setStatus('Rendering preview...');
      window.setTimeout(() => {
        if (!isCancelled) {
          setStatus('Ready');
        }
      }, 30);
    }, 20);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [originalMesh, pointLimit, previewMode, previewQuality]);

  useEffect(() => {
    if (!originalMesh || !assignments.length) {
      return;
    }

    setStatus('Rendering preview...');
    const timeoutId = window.setTimeout(() => setStatus('Ready'), 30);
    return () => window.clearTimeout(timeoutId);
  }, [assignments, originalMesh, palette]);

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setIsProcessing(true);
    setError(null);
    setPreviewMesh(null);
    setStatus('Parsing mesh...');

    try {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
      const parsedMesh = await parseMeshFile(file);
      setStatus('Assigning materials...');
      setPreviewMode(parsedMesh.faceCount > SURFACE_WARN_FACE_COUNT ? 'points' : 'surface');
      setOriginalMesh(parsedMesh);
      setPreviewQuality('high');
      setPointLimit(parsedMesh.faceCount > SURFACE_WARN_FACE_COUNT ? 100_000 : 50_000);
      setOrbitEnabled(parsedMesh.faceCount < SURFACE_SAFE_FACE_COUNT);
    } catch (caughtError) {
      setOriginalMesh(null);
      setPreviewMesh(null);
      setError(caughtError instanceof Error ? caughtError.message : 'The mesh could not be parsed.');
      setStatus('Import failed.');
    } finally {
      setIsProcessing(false);
      event.target.value = '';
    }
  };

  const handleExport = async () => {
    if (!originalMesh) {
      return;
    }

    setIsProcessing(true);
    setError(null);
    setStatus('Packaging 3MF...');

    try {
      const result = await exportMeshAsThreeMf(originalMesh, assignments, palette);
      setStatus(`Exported ${result.fileName} with ${result.materialCount} materials.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '3MF export failed.');
      setStatus('Export failed.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <main className="app-shell">
      <aside className="side-panel">
        <header className="app-title">
          <p className="eyebrow">Prototype</p>
          <h1>Color Mix Shading</h1>
        </header>

        <section className="panel-section">
          <h2>Import</h2>
          <label className="file-drop">
            <input type="file" accept=".stl,.obj,model/stl,text/plain" onChange={handleFileUpload} disabled={isProcessing} />
            <span>Choose STL or OBJ</span>
          </label>
          <p className={error ? 'status status-error' : 'status'}>{error ?? status}</p>
        </section>

        <section className="panel-section">
          <h2>Preview</h2>
          <label className="field">
            <span>Mode</span>
            <select
              value={previewMode}
              onChange={(event) => {
                setStatus('Creating preview...');
                setPreviewMode(event.target.value as PreviewMode);
              }}
            >
              <option value="surface" disabled={Boolean(originalMesh && originalMesh.faceCount > SURFACE_WARN_FACE_COUNT)}>
                Surface Preview
              </option>
              <option value="points">Point Preview - recommended for large files</option>
              <option value="sampled-triangles">Sampled Triangles - experimental</option>
            </select>
          </label>
          {previewMode === 'sampled-triangles' ? (
            <label className="field">
              <span>Sampled triangle count</span>
              <select
                value={previewQuality}
                onChange={(event) => {
                  setStatus('Creating preview...');
                  setPreviewQuality(event.target.value as PreviewQuality);
                }}
              >
                <option value="low">Low - 25k faces</option>
                <option value="medium">Medium - 75k faces</option>
                <option value="high">High - 150k faces</option>
                <option value="full" disabled={Boolean(originalMesh && originalMesh.faceCount > SURFACE_WARN_FACE_COUNT)}>
                  Full - not sampled
                </option>
              </select>
            </label>
          ) : null}
          {previewMode === 'points' ? (
            <>
            <label className="field">
              <span>Sample count</span>
              <select
                value={pointLimit}
                onChange={(event) => {
                  setStatus('Creating preview...');
                  setPointLimit(Number(event.target.value));
                }}
              >
                {POINT_LIMITS.map((count) => (
                  <option key={count} value={count}>{count.toLocaleString()} points</option>
                ))}
              </select>
            </label>
            <label className="slider-row">
              <span>Size</span>
              <input
                type="range"
                min="0.5"
                max="5"
                step="0.1"
                value={pointSize}
                onChange={(event) => {
                  setStatus('Rendering preview...');
                  setPointSize(Number(event.target.value));
                }}
              />
              <output>{pointSize.toFixed(1)}</output>
            </label>
            </>
          ) : null}
          {originalMesh && previewMode === 'surface' && originalMesh.faceCount >= SURFACE_SAFE_FACE_COUNT && originalMesh.faceCount <= SURFACE_WARN_FACE_COUNT ? (
            <p className="status status-warning">Surface preview renders the full mesh. Point Preview is recommended if interaction gets slow.</p>
          ) : null}
          {originalMesh && previewMode === 'surface' && originalMesh.faceCount > SURFACE_WARN_FACE_COUNT ? (
            <p className="status status-warning">Surface preview is disabled over 500k faces to prevent browser crashes. Point Preview is recommended.</p>
          ) : null}
          {surfacePreviewBlocked ? (
            <button className="secondary-button" type="button" onClick={() => setPreviewMode('points')}>
              Switch to Point Preview
            </button>
          ) : null}
          {previewMode === 'sampled-triangles' ? (
            <p className="status status-warning">Sampled Triangles is experimental and may look shredded because it is not a decimated surface.</p>
          ) : null}
          {previewQuality === 'full' && previewMode === 'sampled-triangles' ? (
            <p className="status status-warning">Full mode renders every triangle and can be slow on large meshes.</p>
          ) : null}
          {sampledFullPreviewBlocked ? (
            <button className="secondary-button" type="button" onClick={() => setPreviewMode('points')}>
              Switch to Point Preview
            </button>
          ) : null}
          <label className="checkbox-row">
            <input type="checkbox" checked={orbitEnabled} onChange={(event) => setOrbitEnabled(event.target.checked)} />
            <span>Enable orbit controls</span>
          </label>
        </section>

        <section className="panel-section">
          <div className="section-row">
            <h2>Palette</h2>
            <select value={materialCount} onChange={(event) => {
              setStatus('Assigning materials...');
              setMaterialCount(Number(event.target.value));
            }}>
              {Array.from({ length: 7 }, (_, index) => index + 2).map((count) => (
                <option key={count} value={count}>{count} materials</option>
              ))}
            </select>
          </div>
          <div className="endpoint-grid">
            <label className="field">
              <span>Material 1 highlight</span>
              <input type="color" value={highlightColor} onChange={(event) => {
                setStatus('Assigning materials...');
                setHighlightColor(event.target.value);
              }} />
            </label>
            <label className="field">
              <span>Material 2 shadow</span>
              <input type="color" value={shadowColor} onChange={(event) => {
                setStatus('Assigning materials...');
                setShadowColor(event.target.value);
              }} />
            </label>
          </div>
          <div className="swatch-list">
            {palette.map((material, index) => (
              <div className="swatch-row" key={material.id}>
                <span className="material-index">{index + 1}</span>
                <span className="swatch-chip" style={{ background: material.color }} />
                <span>{material.name}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel-section">
          <h2>Assignment</h2>
          <div className="segmented-control">
            <button className={mode === 'directional' ? 'active' : ''} type="button" onClick={() => {
              setStatus('Assigning materials...');
              setMode('directional');
            }}>Light</button>
            <button className={mode === 'height' ? 'active' : ''} type="button" onClick={() => {
              setStatus('Assigning materials...');
              setMode('height');
            }}>Height</button>
          </div>

          {mode === 'directional' ? (
            <div className="control-stack">
              {(['0', '1', '2'] as const).map((component, index) => (
                <label className="slider-row" key={component}>
                  <span>{['X', 'Y', 'Z'][index]}</span>
                  <input
                    type="range"
                    min="-1"
                    max="1"
                    step="0.01"
                    value={lightDirection[index]}
                    onChange={(event) =>
                      setLightDirection((current) => {
                        setStatus('Assigning materials...');
                        const next: Vec3 = [...current];
                        next[index] = Number(event.target.value);
                        return next;
                      })
                    }
                  />
                  <output>{lightDirection[index].toFixed(2)}</output>
                </label>
              ))}
            </div>
          ) : (
            <label className="field">
              <span>Axis</span>
              <select value={axis} onChange={(event) => {
                setStatus('Assigning materials...');
                setAxis(event.target.value as Axis);
              }}>
                <option value="z">Z</option>
                <option value="y">Y</option>
                <option value="x">X</option>
              </select>
            </label>
          )}
        </section>

        <section className="panel-section">
          <h2>Export</h2>
          <button className="primary-button" type="button" onClick={handleExport} disabled={!originalMesh || isProcessing}>
            Export 3MF
          </button>
          <p className="helper-copy">Face material indices follow the palette order shown above.</p>
        </section>
      </aside>

      <PreviewViewport
        originalFaceCount={originalMesh?.faceCount ?? 0}
        originalMesh={originalMesh}
        previewMesh={previewMesh}
        assignments={assignments}
        palette={palette}
        previewMode={previewMode}
        orbitEnabled={orbitEnabled}
        pointSize={pointSize}
      />
    </main>
  );
}
