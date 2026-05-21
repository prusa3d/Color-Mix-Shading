import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent } from 'react';
import { exportMeshAsThreeMf } from './lib/export/threeMf';
import { computeAssignments } from './lib/materials/assignMaterials';
import { parseMeshFile } from './lib/mesh/parseMesh';
import { normalize } from './lib/mesh/vector';
import { PreviewViewport } from './components/PreviewViewport';
import { mixFilamentsCached } from './lib/preview/mixCache';
import type { AssignmentMode, Axis, PaletteMaterial, ParsedMesh, Vec3 } from './types/mesh';


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

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await loadFile(file);
    }
    event.target.value = '';
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
      const result = await exportMeshAsThreeMf(originalMesh, assignments, materials);
      setStatus(`Exported ${result.fileName} with ${result.materialCount} materials.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '3MF export failed.');
      setStatus('Export failed.');
    } finally {
      setIsProcessing(false);
      setIsExporting(false);
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
            <input type="file" accept=".stl,.obj,.3mf,model/stl,model/3mf,text/plain" onChange={handleFileUpload} disabled={isProcessing} />
            <span>Choose STL, OBJ, or 3MF - or drop one on the window</span>
          </label>
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
          <button className="primary-button" type="button" onClick={handleExport} disabled={!originalMesh || isProcessing}>
            {isExporting ? 'Exporting...' : 'Export 3MF'}
          </button>
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

      {isProcessing ? (
        <div className="loading-overlay" role="status" aria-live="polite">
          <div className="loading-card">
            <div className="spinner" aria-hidden="true" />
            <p>{status}</p>
          </div>
        </div>
      ) : null}

      {isDragging ? (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-card">Drop STL, OBJ, or 3MF to load</div>
        </div>
      ) : null}
    </main>
  );
}
