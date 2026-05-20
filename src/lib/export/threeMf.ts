import JSZip from 'jszip';
import type { PaletteMaterial, ParsedMesh } from '../../types/mesh';
import { weldMesh } from '../mesh/weldMesh';
import { downloadBlob, slugifyFileName } from './download';

const MODEL_CONTENT_TYPE = 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml';
const START_PART_RELATIONSHIP = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';
const CORE_NAMESPACE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const PRUSA_NAMESPACE = 'http://schemas.slic3r.org/3mf/2017/06';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizeHexColor(color: string): string {
  const hex = color.startsWith('#') ? color.toUpperCase() : `#${color.toUpperCase()}`;
  return hex.length >= 7 ? hex.slice(0, 7) : hex;
}

function encodePrusaTriangleState(state: number): string {
  const bitstream: boolean[] = [false, false];

  if (state >= 3) {
    bitstream.push(true, true);
    const extendedState = state - 3;
    for (let bitIndex = 0; bitIndex < 4; bitIndex += 1) {
      bitstream.push(Boolean(extendedState & (1 << bitIndex)));
    }
  } else {
    bitstream.push(Boolean(state & 1), Boolean(state & 2));
  }

  let output = '';
  for (let offset = 0; offset < bitstream.length; offset += 4) {
    let nibble = 0;
    for (let bitIndex = 3; bitIndex >= 0; bitIndex -= 1) {
      nibble = (nibble << 1) | (bitstream[offset + bitIndex] ? 1 : 0);
    }

    output = nibble.toString(16).toUpperCase() + output;
  }

  return output;
}

function materialIndexToPrusaSegmentation(materialIndex: number): string {
  return encodePrusaTriangleState(materialIndex + 1);
}

function createModelXml(mesh: ParsedMesh, assignments: Uint8Array, palette: PaletteMaterial[]): string {
  const welded = weldMesh(mesh);
  const verticesXml = welded.vertices
    .map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}" />`)
    .join('');
  const trianglesXml = welded.faces
    .map((face, index) => {
      const materialIndex = assignments[index] ?? 0;
      const prusaSegmentation = materialIndexToPrusaSegmentation(materialIndex);
      return `<triangle v1="${face[0]}" v2="${face[1]}" v3="${face[2]}" pid="1" p1="${materialIndex}" p2="${materialIndex}" p3="${materialIndex}" slic3rpe:mmu_segmentation="${prusaSegmentation}" />`;
    })
    .join('');
  const materialsXml = palette
    .map((material, index) => `<base name="${escapeXml(material.name || `Material ${index + 1}`)}" displaycolor="${normalizeHexColor(material.color)}" />`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="${CORE_NAMESPACE}" xmlns:slic3rpe="${PRUSA_NAMESPACE}">
  <metadata name="slic3rpe:Version3mf">1</metadata>
  <metadata name="slic3rpe:MmPaintingVersion">1</metadata>
  <metadata name="Application">Color Mix Shading</metadata>
  <resources>
    <basematerials id="1">${materialsXml}</basematerials>
    <object id="2" type="model" name="${escapeXml(mesh.name)}">
      <mesh>
        <vertices>${verticesXml}</vertices>
        <triangles>${trianglesXml}</triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="2" />
  </build>
</model>`;
}

function createContentTypesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="${MODEL_CONTENT_TYPE}" />
</Types>`;
}

function createRootRelationshipsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="${START_PART_RELATIONSHIP}" />
</Relationships>`;
}

export async function exportMeshAsThreeMf(
  mesh: ParsedMesh,
  assignments: Uint8Array,
  palette: PaletteMaterial[],
): Promise<{ fileName: string; materialCount: number }> {
  const zip = new JSZip();
  const fileName = `${slugifyFileName(mesh.name)}-color-mix.3mf`;

  zip.file('[Content_Types].xml', createContentTypesXml());
  zip.file('_rels/.rels', createRootRelationshipsXml());
  zip.file('3D/3dmodel.model', createModelXml(mesh, assignments, palette));

  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, fileName);

  return { fileName, materialCount: palette.length };
}
