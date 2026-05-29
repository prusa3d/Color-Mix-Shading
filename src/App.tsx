import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent } from 'react';
import { saveAs } from 'file-saver';
import { buildThreeMfBlob } from './lib/export/threeMf';
import {
  SlicerUploadAbortError,
  canOpenInPrusaslicer,
  uploadToSlicer,
  type SlicerUploadResult,
} from './lib/export/slicerUpload';
import { computeAssignments } from './lib/materials/assignMaterials';
import { parseMeshFile } from './lib/mesh/parseMesh';
import { normalize } from './lib/mesh/vector';
import { ACCEPTED_UPLOAD_EXTENSIONS, isMobile, isAcceptedUploadFile } from './lib/upload';
import { PreviewViewport } from './components/PreviewViewport';
import { UploadModal } from './components/UploadModal';
import { mixFilamentsCached } from './lib/preview/mixCache';
import type { AssignmentMode, Axis, PaletteMaterial, ParsedMesh, Vec3 } from './types/mesh';

type SlicerTarget = 'easyprint' | 'prusaslicer';

interface UploadState {
  target: SlicerTarget;
  fileName: string;
  progress: number;
  status: 'uploading' | 'ready' | 'error';
  errorMessage?: string;
  abort: AbortController;
  result?: SlicerUploadResult;
}

const SLICER_LABEL: Record<SlicerTarget, string> = {
  easyprint: 'EasyPrint',
  prusaslicer: 'PrusaSlicer',
};


const DEFAULT_LIGHT: Vec3 = [0.35, 0.45, 0.82];
const DEFAULT_SECOND_LIGHT: Vec3 = [-0.55, -0.35, 0.75];
const DEFAULT_SECOND_LIGHT_COLOR = '#3B82F6';
const DEFAULT_HIGHLIGHT = '#F8D36B';
const DEFAULT_SHADOW = '#6C2A00';
const LIGHT_PRESETS: Array<{ name: string; direction: Vec3 }> = [
  { name: 'Front Left', direction: [-1, -1, 1] },
  { name: 'Front Right', direction: [1, -1, 1] },
  { name: 'Back Left', direction: [-1, 1, 1] },
  { name: 'Back Right', direction: [1, 1, 1] },
  { name: 'Left Side', direction: [-1, 0, 0.2] },
  { name: 'Right Side', direction: [1, 0, 0.2] },
  { name: 'Overhead', direction: [0, 0, 1] },
  { name: 'Zenithal 45', direction: [0, -Math.SQRT1_2, Math.SQRT1_2] },
];

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

function directionFromDomePosition(dx: number, dy: number): Vec3 {
  const length = Math.hypot(dx, dy);
  const clampedX = length > 1 ? dx / length : dx;
  const clampedY = length > 1 ? dy / length : dy;
  const radius = Math.min(1, Math.hypot(clampedX, clampedY));
  return normalize([clampedX, clampedY, Math.sqrt(Math.max(0, 1 - radius * radius))]);
}

function directionsMatch(a: Vec3, b: Vec3): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  return na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2] > 0.999;
}

function LightDirectionControls({
  lightDirection,
  onLightDirectionChange,
}: {
  lightDirection: Vec3;
  onLightDirectionChange: (direction: Vec3) => void;
}) {
  const domeRef = useRef<HTMLDivElement | null>(null);
  const normalizedLight = normalize(lightDirection);
  const domeRadius = Math.min(1, Math.hypot(normalizedLight[0], normalizedLight[1]));
  const domeAngle = Math.atan2(normalizedLight[1], normalizedLight[0]);
  const domeX = Math.cos(domeAngle) * domeRadius;
  const domeY = Math.sin(domeAngle) * domeRadius;

  const updateFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = domeRef.current?.getBoundingClientRect();
    if (!bounds) {
      return;
    }

    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const radius = bounds.width / 2;
    const dx = (event.clientX - centerX) / radius;
    const dy = (event.clientY - centerY) / radius;
    onLightDirectionChange(directionFromDomePosition(dx, dy));
  };

  return (
    <div className="light-direction-control">
      <div
        className="light-dome"
        ref={domeRef}
        role="slider"
        tabIndex={0}
        aria-label="Light direction dome"
        aria-valuetext={`X ${normalizedLight[0].toFixed(2)}, Y ${normalizedLight[1].toFixed(2)}, Z ${normalizedLight[2].toFixed(2)}`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          updateFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            updateFromPointer(event);
          }
        }}
      >
        <span className="light-dome-axis light-dome-axis-x" />
        <span className="light-dome-axis light-dome-axis-y" />
        <span
          className="light-dome-dot"
          style={{
            left: `${50 + domeX * 50}%`,
            top: `${50 + domeY * 50}%`,
          }}
        />
      </div>

      <div className="preset-grid">
        {LIGHT_PRESETS.map((preset) => {
          const isActive = directionsMatch(lightDirection, preset.direction);
          return (
            <button
              type="button"
              key={preset.name}
              className={isActive ? 'active' : ''}
              onClick={() => onLightDirectionChange(normalize(preset.direction))}
            >
              {preset.name}
            </button>
          );
        })}
      </div>

      <details className="advanced-light-controls">
        <summary>Advanced</summary>
        <div className="control-stack">
          {(['0', '1', '2'] as const).map((component, index) => (
            <label className="slider-row" key={component}>
              <span>{['X', 'Y', 'Z'][index]}</span>
              <input
                type="range"
                min="-1"
                max="1"
                step="0.01"
                value={normalizedLight[index]}
                onChange={(event) => {
                  const next: Vec3 = [...normalizedLight];
                  next[index] = Number(event.target.value);
                  onLightDirectionChange(normalize(next));
                }}
              />
              <output>{normalizedLight[index].toFixed(2)}</output>
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}

export default function App() {
  const [originalMesh, setOriginalMesh] = useState<ParsedMesh | null>(null);
  const [materialCount, setMaterialCount] = useState(4);
  const [highlightColor, setHighlightColor] = useState(DEFAULT_HIGHLIGHT);
  const [shadowColor, setShadowColor] = useState(DEFAULT_SHADOW);
  const [mode, setMode] = useState<AssignmentMode>('directional');
  const [axis, setAxis] = useState<Axis>('z');
  const [lightDirection, setLightDirection] = useState<Vec3>(DEFAULT_LIGHT);
  const [secondLightDirection, setSecondLightDirection] = useState<Vec3>(DEFAULT_SECOND_LIGHT);
  const [secondLightColor, setSecondLightColor] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const showPrusaSlicerButton = useMemo(() => canOpenInPrusaslicer(), []);
  const [status, setStatus] = useState<string>('Ready for STL, OBJ, or 3MF import.');
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const palette = useMemo(
    () => createShadingPalette(highlightColor, shadowColor, materialCount),
    [highlightColor, materialCount, shadowColor],
  );

  const mixedPalette = useMemo(() => {
    if (secondLightColor === null) {
      return null;
    }
    const paletteLen = palette.length;
    return palette.map((_base, paletteIndex) => {
      const v1 =
        paletteIndex === 0 ? 1 : paletteIndex === 1 ? 0 : (paletteIndex - 1) / (paletteLen - 1);
      return Array.from({ length: paletteLen }, (_, step) => {
        const v2 = paletteLen > 1 ? step / (paletteLen - 1) : 0;
        const total = v1 + v2;
        const light1Ratio = total > 1 ? v1 / total : v1;
        const light2Ratio = total > 1 ? v2 / total : v2;
        const shadowRatio = total > 1 ? 0 : 1 - total;
        return mixFilamentsCached([
          { hex: highlightColor, ratio: light1Ratio },
          { hex: shadowColor, ratio: shadowRatio },
          { hex: secondLightColor, ratio: light2Ratio },
        ]).hex;
      });
    });
  }, [palette, secondLightColor, shadowColor, highlightColor]);

  const isProcessingRef = useRef(isProcessing);
  isProcessingRef.current = isProcessing;
  const dragCounter = useRef(0);

  const loadFile = async (file: File) => {
    if (isProcessingRef.current) {
      return;
    }

    if (!isAcceptedUploadFile(file.name)) {
      setOriginalMesh(null);
      setError('Unsupported file type. Please choose an STL, OBJ, or 3MF file.');
      setStatus('Import failed.');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setStatus(`Parsing ${file.name}...`);

    try {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
      const parsedMesh = await parseMeshFile(file);
      setStatus('Building preview...');
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      setOriginalMesh(parsedMesh);
      // isProcessing stays true until ShadedMesh signals via handleMeshLoaded.
    } catch (caughtError) {
      setOriginalMesh(null);
      setError(caughtError instanceof Error ? caughtError.message : 'The mesh could not be parsed.');
      setStatus('Import failed.');
      setIsProcessing(false);
    }
  };

  const handleMeshLoaded = useCallback((mesh: ParsedMesh) => {
    setStatus(`Ready - ${mesh.faceCount.toLocaleString()} faces`);
    setIsProcessing(false);
  }, []);

  useEffect(() => {
    const handleDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) {
        return;
      }
      event.preventDefault();
      dragCounter.current += 1;
      setIsDragging(true);
    };

    const handleDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) {
        return;
      }
      event.preventDefault();
    };

    const handleDragLeave = (event: DragEvent) => {
      event.preventDefault();
      dragCounter.current -= 1;
      if (dragCounter.current <= 0) {
        dragCounter.current = 0;
        setIsDragging(false);
      }
    };

    const handleDrop = (event: DragEvent) => {
      event.preventDefault();
      dragCounter.current = 0;
      setIsDragging(false);
      const file = event.dataTransfer?.files[0];
      if (file) {
        void loadFile(file);
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
    // loadFile is stable enough — it reads via isProcessingRef and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the bundled 3DBenchy sample on demand (Import → "Load 3D Benchy sample").
  const loadSample = async () => {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}3dbenchy.stl`);
      if (!response.ok) {
        throw new Error(`Sample request failed (${response.status}).`);
      }
      const blob = await response.blob();
      await loadFile(new File([blob], '3dbenchy.stl', { type: 'model/stl' }));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'The sample could not be loaded.');
      setStatus('Import failed.');
    }
  };

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await loadFile(file);
    }
    event.target.value = '';
  };

  const prepareThreeMfBlob = async () => {
    if (!originalMesh) {
      return null;
    }

    const { assignments, materials } = await computeAssignments(originalMesh, {
      mode,
      lightDirection,
      axis,
      materialCount,
      palette,
      secondLight:
        secondLightColor !== null
          ? { direction: secondLightDirection, color: secondLightColor }
          : null,
    });
    setStatus('Packaging 3MF...');
    return buildThreeMfBlob(originalMesh, assignments, materials);
  };

  const handleExport = async () => {
    if (!originalMesh) {
      return;
    }

    setIsProcessing(true);
    setIsExporting(true);
    setError(null);
    setStatus('Computing material assignments...');

    try {
      const result = await prepareThreeMfBlob();
      if (!result) {
        return;
      }
      saveAs(result.blob, result.fileName);
      setStatus(`Exported ${result.fileName} with ${result.materialCount} materials.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '3MF export failed.');
      setStatus('Export failed.');
    } finally {
      setIsProcessing(false);
      setIsExporting(false);
    }
  };

  const startSlicerUpload = async (target: SlicerTarget) => {
    if (!originalMesh || upload) {
      return;
    }

    const label = SLICER_LABEL[target];

    setIsProcessing(true);
    setError(null);
    setStatus('Computing material assignments...');

    let blobResult: Awaited<ReturnType<typeof prepareThreeMfBlob>>;
    try {
      blobResult = await prepareThreeMfBlob();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'Failed to package 3MF.',
      );
      setStatus(`${label} hand-off failed.`);
      setIsProcessing(false);
      return;
    }
    if (!blobResult) {
      setIsProcessing(false);
      return;
    }

    const { blob, fileName } = blobResult;
    const abort = new AbortController();
    setUpload({ target, fileName, progress: 0, status: 'uploading', abort });
    setIsProcessing(false);
    setStatus(`Uploading to ${label}...`);

    try {
      const result = await uploadToSlicer(blob, fileName, {
        sourceName: 'Color Mix Shading',
        sourceUrl: window.location.href,
        signal: abort.signal,
        onProgress: (loaded, total) => {
          setUpload((current) =>
            current && current.abort === abort
              ? { ...current, progress: total > 0 ? loaded / total : 0 }
              : current,
          );
        },
      });

      setUpload((current) =>
        current && current.abort === abort
          ? { ...current, status: 'ready', progress: 1, result }
          : current,
      );
      setStatus(`Ready to open ${fileName} in ${label}.`);
    } catch (caughtError) {
      if (caughtError instanceof SlicerUploadAbortError) {
        setStatus(`${label} upload cancelled.`);
        setUpload(null);
        return;
      }
      const message =
        caughtError instanceof Error ? caughtError.message : `Failed to send to ${label}.`;
      setError(message);
      setStatus(`${label} hand-off failed.`);
      setUpload((current) =>
        current && current.abort === abort
          ? { ...current, status: 'error', errorMessage: message }
          : current,
      );
    }
  };

  const handlePrintWithEasyPrint = () => startSlicerUpload('easyprint');
  const handlePrintInPrusaSlicer = () => startSlicerUpload('prusaslicer');

  const handleUploadLaunch = () => {
    if (!upload?.result) return;
    const { target, result, fileName } = upload;
    if (target === 'easyprint') {
      window.open(result.easyprintUrl, '_blank', 'noopener,noreferrer');
    } else {
      window.location.href = result.prusaslicerUrl;
    }
    setStatus(`Opened ${fileName} in ${SLICER_LABEL[target]}.`);
    setUpload(null);
  };

  const handleUploadCancel = () => {
    upload?.abort.abort();
  };

  const handleUploadClose = () => {
    setUpload(null);
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
            <input type="file" accept={isMobile ? '' : ACCEPTED_UPLOAD_EXTENSIONS.join(',')} onChange={handleFileUpload} disabled={isProcessing} />
            <span>Choose STL, OBJ, or 3MF - or drop one on the window</span>
          </label>
          <button type="button" className="secondary-button" onClick={loadSample} disabled={isProcessing}>
            Load 3D Benchy sample
          </button>
          <p className={error ? 'status status-error' : 'status'}>{error ?? status}</p>
        </section>

        <section className="panel-section">
          <div className="section-row">
            <h2>Palette</h2>
            <select value={materialCount} onChange={(event) => setMaterialCount(Number(event.target.value))}>
              {Array.from({ length: 7 }, (_, index) => index + 2).map((count) => {
                const steps = count - 2;
                return (
                  <option key={count} value={count}>{steps} mix step{steps === 1 ? '' : 's'}</option>
                );
              })}
            </select>
          </div>
          <div className="endpoint-grid">
            <label className="field">
              <span>Material 1 highlight</span>
              <input type="color" value={highlightColor} onChange={(event) => setHighlightColor(event.target.value)} />
            </label>
            <label className="field">
              <span>Material 2 shadow</span>
              <input type="color" value={shadowColor} onChange={(event) => setShadowColor(event.target.value)} />
            </label>
          </div>
          {mixedPalette === null ? (
            <div className="swatch-list">
              {palette.map((material, index) => (
                <div className="swatch-row" key={material.id}>
                  <span className="material-index">{index + 1}</span>
                  <span className="swatch-chip" style={{ background: material.color }} />
                  <span>{material.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mixed-grid">
              <h3 className="subsection-heading">Predicted FDM mixes</h3>
              <div className="mixed-grid-rows">
                {mixedPalette.map((row, bandIndex) => {
                  const cols = row.length;
                  return (
                    <div className="mixed-row" key={palette[bandIndex].id}>
                      <span className="material-index">{bandIndex + 1}</span>
                      <div
                        className="mixed-strip"
                        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                      >
                        {row.map((hex, step) => (
                          <span
                            className="mixed-cell"
                            key={step}
                            style={{ background: hex }}
                            title={`${cols > 1 ? Math.round((step / (cols - 1)) * 100) : 0}% second light → ${hex}`}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="helper-copy">Rows: light 1 intensity. Columns: light 2 intensity. Bin count follows mix steps.</p>
            </div>
          )}
        </section>

        <section className="panel-section">
          <h2>Assignment</h2>
          <div className="segmented-control">
            <button className={mode === 'directional' ? 'active' : ''} type="button" onClick={() => setMode('directional')}>Light</button>
            <button
              className={mode === 'height' ? 'active' : ''}
              type="button"
              onClick={() => setMode('height')}
              disabled={secondLightColor !== null}
              title={secondLightColor !== null ? 'Disable the second light to use axis mapping' : undefined}
            >
              Axis
            </button>
          </div>

          {mode === 'directional' ? (
            <>
              <LightDirectionControls
                lightDirection={lightDirection}
                onLightDirectionChange={setLightDirection}
              />

              <div className="second-light-block">
                <div className="section-row">
                  <h3 className="subsection-heading">Second light</h3>
                  {secondLightColor === null ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setSecondLightColor(DEFAULT_SECOND_LIGHT_COLOR);
                        if (mode !== 'directional') {
                          setMode('directional');
                        }
                      }}
                    >
                      Add
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setSecondLightColor(null)}
                    >
                      Remove
                    </button>
                  )}
                </div>

                {secondLightColor !== null ? (
                  <>
                    <label className="field">
                      <span>Tint color</span>
                      <input
                        type="color"
                        value={secondLightColor}
                        onChange={(event) => setSecondLightColor(event.target.value)}
                      />
                    </label>
                    <LightDirectionControls
                      lightDirection={secondLightDirection}
                      onLightDirectionChange={setSecondLightDirection}
                    />
                  </>
                ) : null}
              </div>
            </>
          ) : (
            <label className="field">
              <span>Axis</span>
              <select value={axis} onChange={(event) => setAxis(event.target.value as Axis)}>
                <option value="z">Z</option>
                <option value="y">Y</option>
                <option value="x">X</option>
              </select>
            </label>
          )}
        </section>

        <section className="panel-section">
          <h2>Export</h2>
          <button className="primary-button" type="button" onClick={handleExport} disabled={!originalMesh || isProcessing || upload !== null}>
            {isExporting ? 'Exporting...' : 'Export 3MF'}
          </button>
          <button
            className="easyprint-button"
            type="button"
            onClick={handlePrintWithEasyPrint}
            disabled={!originalMesh || isProcessing || upload !== null}
          >
            <span className="easyprint-button__label">Print with</span>
            <svg
              className="easyprint-button__logo"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 406.37 83.99"
                aria-hidden="true"
                focusable="false"
              >
                <g fill="#fd5000">
                  <polygon points="72.66 16.8 43.59 .01 14.52 16.8 14.52 50.36 43.59 33.58 72.66 16.8" />
                  <polygon points="0 67.2 29.08 83.98 58.15 67.2 58.15 33.63 29.08 50.41 0 67.2" />
                </g>
                <g fill="#121212">
                  <polygon points="92.02 67.2 127.3 67.2 127.3 55.1 105.34 55.1 105.34 47.76 125.86 47.76 125.86 36.24 105.34 36.24 105.34 28.82 127.3 28.82 127.3 16.8 92.02 16.8 92.02 67.2" />
                  <path d="M158.73,30.94c-2.59-1.27-5.64-1.91-9.14-1.91-3.26,0-6.12.58-8.57,1.73-2.45,1.15-4.36,2.69-5.72,4.61-1.37,1.92-2.17,4.01-2.41,6.26h12.02c.82-1.82,2.38-2.74,4.68-2.74,1.34,0,2.47.44,3.38,1.33.91.89,1.37,2.03,1.37,3.42v.65h-7.85c-4.9,0-8.64,1.12-11.23,3.35-2.59,2.23-3.89,5.17-3.89,8.82,0,2.16.54,4.1,1.62,5.83,1.08,1.73,2.65,3.1,4.72,4.1,2.06,1.01,4.49,1.51,7.27,1.51,2.21,0,4.19-.37,5.94-1.12,1.75-.74,3.01-1.57,3.78-2.48h.36l.72,2.88h11.02v-23.54c0-2.78-.7-5.28-2.09-7.49-1.39-2.21-3.38-3.95-5.98-5.22ZM154.34,52.72c0,1.78-.55,3.18-1.66,4.21s-2.62,1.55-4.54,1.55c-1.39,0-2.45-.29-3.17-.86s-1.08-1.37-1.08-2.38.38-1.73,1.15-2.3c.77-.58,1.92-.86,3.46-.86h5.83v.65Z" />
                  <path d="M192.07,43.94l-5.4-.79c-2.35-.33-3.53-1.15-3.53-2.45,0-.72.38-1.34,1.15-1.87.77-.53,1.87-.79,3.31-.79,1.58,0,2.79.3,3.64.9.84.6,1.26,1.38,1.26,2.34h12.1c0-2.06-.65-4.06-1.94-5.98-1.3-1.92-3.23-3.48-5.8-4.68-2.57-1.2-5.65-1.8-9.25-1.8s-6.59.54-9.11,1.62c-2.52,1.08-4.42,2.54-5.69,4.39-1.27,1.85-1.91,3.9-1.91,6.16,0,3.12,1.09,5.66,3.28,7.63,2.18,1.97,5.46,3.29,9.83,3.96l5.26.79c1.34.19,2.28.52,2.81.97.53.46.79,1.09.79,1.91,0,.77-.41,1.4-1.22,1.91s-2.04.76-3.67.76c-1.78,0-3.08-.31-3.92-.94-.84-.62-1.26-1.44-1.26-2.45h-12.17c0,1.97.61,3.91,1.84,5.83,1.22,1.92,3.14,3.53,5.76,4.82,2.62,1.3,5.87,1.94,9.76,1.94s6.83-.54,9.4-1.62c2.57-1.08,4.49-2.54,5.76-4.39,1.27-1.85,1.91-3.88,1.91-6.08,0-6.77-4.32-10.8-12.96-12.1Z" />
                  <path d="M226.64,51.07h-1.44l-7.63-21.31h-13.32l14.83,38.52-.29.65c-.38.82-1.08,1.22-2.09,1.22h-7.63v11.45h10.8c3.12,0,5.5-.61,7.13-1.84,1.63-1.22,2.93-3.18,3.89-5.87l15.77-44.14h-13.32l-6.7,21.31Z" />
                  <path d="M282.18,19.03c-2.62-1.49-5.63-2.23-9.04-2.23h-23.9v50.4h13.32v-14.04h10.58c3.41,0,6.42-.74,9.04-2.23,2.62-1.49,4.64-3.61,6.08-6.37,1.44-2.76,2.16-5.96,2.16-9.61s-.72-6.84-2.16-9.58c-1.44-2.74-3.47-4.85-6.08-6.34ZM275.73,38.86c-.91.98-2.06,1.48-3.46,1.48h-9.72v-10.8h9.72c1.39,0,2.54.5,3.46,1.51.91,1.01,1.37,2.3,1.37,3.89s-.46,2.94-1.37,3.92Z" />
                  <path d="M308.51,30.55c-1.18.53-2.03,1.15-2.56,1.87h-.36l-.72-2.66h-10.94v37.44h12.46v-19.22c0-4.42,2.11-6.62,6.34-6.62h6.48v-11.59h-6.77c-1.44,0-2.75.26-3.92.79Z" />
                  <rect x="321.83" y="14.64" width="12.74" height="10.08" />
                  <rect x="321.97" y="29.76" width="12.46" height="37.44" />
                  <path d="M370.08,30.91c-2.16-1.25-4.66-1.87-7.49-1.87-2.3,0-4.32.37-6.05,1.12-1.73.75-3,1.57-3.82,2.48h-.36l-.72-2.88h-10.94v37.44h12.46v-20.23c0-1.73.52-3.14,1.55-4.25,1.03-1.1,2.41-1.66,4.14-1.66s3.11.55,4.14,1.66c1.03,1.11,1.55,2.52,1.55,4.25v20.23h12.46v-22.9c0-3.07-.61-5.76-1.84-8.06s-2.92-4.08-5.08-5.33Z" />
                  <path d="M406.37,41.35v-11.59h-8.28v-11.45h-12.46v11.45h-5.76v11.59h5.76v14.69c0,3.6,1.01,6.36,3.03,8.28,2.02,1.92,4.97,2.88,8.86,2.88h8.86v-11.38h-5.76c-.91,0-1.56-.19-1.94-.58-.38-.38-.58-1.03-.58-1.94v-11.95h8.28Z" />
                </g>
              </svg>
          </button>
          {showPrusaSlicerButton ? (
            <button
              className="prusaslicer-button"
              type="button"
              onClick={handlePrintInPrusaSlicer}
              disabled={!originalMesh || isProcessing || upload !== null}
            >
              <svg
                className="prusaslicer-button__logo"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 800 800"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="m 680.14429,102.36264 c -131.72203,-131.722038 -345.22674,-131.722038 -476.94877,0 -131.722035,131.72203 -131.722035,345.22674 0,476.94877 z"
                  fill="#363636"
                />
                <path
                  d="m 123.79757,699.53056 c 131.72203,131.72203 345.22674,131.72203 476.94877,0 131.72204,-131.72204 131.72204,-345.22674 0,-476.94877"
                  fill="#ed6b21"
                />
              </svg>
              <span className="prusaslicer-button__label">
                Open in <strong>PrusaSlicer</strong>
              </span>
            </button>
          ) : null}
          <p className="helper-copy">Face material indices follow the palette order shown above.</p>
        </section>
      </aside>

      <PreviewViewport
        mesh={originalMesh}
        palette={palette}
        lightDirection={lightDirection}
        mode={mode}
        axis={axis}
        secondLight={secondLightColor !== null ? { direction: secondLightDirection, color: secondLightColor } : null}
        onMeshLoaded={handleMeshLoaded}
      />

      {isProcessing && !upload ? (
        <div className="loading-overlay" role="status" aria-live="polite">
          <div className="loading-card">
            <div className="spinner" aria-hidden="true" />
            <p>{status}</p>
          </div>
        </div>
      ) : null}

      <UploadModal
        open={upload !== null}
        target={upload?.target ?? 'easyprint'}
        fileName={upload?.fileName ?? ''}
        progress={upload?.progress ?? 0}
        status={upload?.status ?? 'uploading'}
        errorMessage={upload?.errorMessage}
        onLaunch={handleUploadLaunch}
        onCancel={handleUploadCancel}
        onClose={handleUploadClose}
      />

      {isDragging ? (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-card">Drop STL, OBJ, or 3MF to load</div>
        </div>
      ) : null}
    </main>
  );
}
