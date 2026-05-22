import { saveAs } from 'file-saver';
import JSZip from 'jszip';
import type { MaterialRecipe, ParsedMesh } from '../../types/mesh';
import { weldMesh } from '../mesh/weldMesh';
import { slugifyFileName } from './download';

const MODEL_CONTENT_TYPE = 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml';
const START_PART_RELATIONSHIP = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';
const CORE_NAMESPACE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const PRUSA_NAMESPACE = 'http://schemas.slic3r.org/3mf/2017/06';
const EXPORT_CHUNK_SIZE = 50_000;

const yieldToBrowser = (): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, 0));

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

async function createModelXml(mesh: ParsedMesh, assignments: Uint8Array, materials: MaterialRecipe[]): Promise<string> {
  const welded = await weldMesh(mesh);

  const verticesChunks: string[] = [];
  for (let chunkStart = 0; chunkStart < welded.vertices.length; chunkStart += EXPORT_CHUNK_SIZE) {
    await yieldToBrowser();
    const chunkEnd = Math.min(chunkStart + EXPORT_CHUNK_SIZE, welded.vertices.length);
    for (let i = chunkStart; i < chunkEnd; i += 1) {
      const [x, y, z] = welded.vertices[i];
      verticesChunks.push(`<vertex x="${x}" y="${y}" z="${z}" />`);
    }
  }
  const verticesXml = verticesChunks.join('');

  const trianglesChunks: string[] = [];
  for (let chunkStart = 0; chunkStart < welded.faces.length; chunkStart += EXPORT_CHUNK_SIZE) {
    await yieldToBrowser();
    const chunkEnd = Math.min(chunkStart + EXPORT_CHUNK_SIZE, welded.faces.length);
    for (let i = chunkStart; i < chunkEnd; i += 1) {
      const face = welded.faces[i];
      const materialIndex = assignments[i] ?? 0;
      const prusaSegmentation = materialIndexToPrusaSegmentation(materialIndex);
      trianglesChunks.push(`<triangle v1="${face[0]}" v2="${face[1]}" v3="${face[2]}" pid="1" p1="${materialIndex}" p2="${materialIndex}" p3="${materialIndex}" slic3rpe:mmu_segmentation="${prusaSegmentation}" />`);
    }
  }
  const trianglesXml = trianglesChunks.join('');

  const materialsXml = materials
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
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="config" ContentType="application/octet-stream" />
</Types>`;
}

function createSlic3rPeConfig(materials: MaterialRecipe[]): string {
  const physicalColors = materials
    .filter((m) => !m.components)
    .map((m) => normalizeHexColor(m.color));
  return `; extruder_colour = ${physicalColors.join(';')}\n`;
}

function createSlic3rPeModelConfig(mesh: ParsedMesh): string {
  const lastFaceIndex = Math.max(0, mesh.faceCount - 1);
  const name = escapeXml(mesh.name);
  return `<?xml version="1.0" encoding="UTF-8"?>
<config>
 <object id="2" instances_count="1">
  <metadata type="object" key="name" value="${name}"/>
  <volume firstid="0" lastid="${lastFaceIndex}">
   <metadata type="volume" key="name" value="${name}"/>
   <metadata type="volume" key="volume_type" value="ModelPart"/>
   <metadata type="volume" key="source_object_id" value="0"/>
   <metadata type="volume" key="source_volume_id" value="0"/>
   <mesh edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>
  </volume>
 </object>
</config>`;
}

function createFullSpectrumMetadata(materials: MaterialRecipe[]): string {
  const physicalExtruders: { color: string; id: number }[] = [];
  const virtualExtruders: {
    color: string;
    components: { extruder: number; ratio: number }[];
    id: number;
    kind: string;
  }[] = [];

  materials.forEach((material, index) => {
    const id = index + 1;
    if (!material.components || material.components.length === 0) {
      physicalExtruders.push({ color: normalizeHexColor(material.color), id });
    } else {
      virtualExtruders.push({
        color: normalizeHexColor(material.color),
        components: material.components.map((c) => ({ extruder: c.extruderId, ratio: c.ratio })),
        id,
        kind: 'fullspectrum',
      });
    }
  });

  return JSON.stringify(
    {
      physical_extruders: physicalExtruders,
      version: 1,
      virtual_extruders: virtualExtruders,
    },
    null,
    4,
  );
}

function createRootRelationshipsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="${START_PART_RELATIONSHIP}" />
</Relationships>`;
}

export async function buildThreeMfBlob(
  mesh: ParsedMesh,
  assignments: Uint8Array,
  materials: MaterialRecipe[],
): Promise<{ blob: Blob; fileName: string; materialCount: number }> {
  const zip = new JSZip();
  const fileName = `${slugifyFileName(mesh.name)}-color-mix.3mf`;

  zip.file('[Content_Types].xml', createContentTypesXml());
  zip.file('_rels/.rels', createRootRelationshipsXml());
  zip.file('3D/3dmodel.model', await createModelXml(mesh, assignments, materials));
  zip.file('Metadata/Prusa_Slicer_full_spectrum.json', createFullSpectrumMetadata(materials));
  zip.file('Metadata/Slic3r_PE.config', createSlic3rPeConfig(materials));
  zip.file('Metadata/Slic3r_PE_model.config', createSlic3rPeModelConfig(mesh));

  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const blob = new Blob([zipBlob], { type: 'model/3mf' });

  return { blob, fileName, materialCount: materials.length };
}

export async function exportMeshAsThreeMf(
  mesh: ParsedMesh,
  assignments: Uint8Array,
  materials: MaterialRecipe[],
): Promise<{ fileName: string; materialCount: number }> {
  const { blob, fileName, materialCount } = await buildThreeMfBlob(mesh, assignments, materials);
  saveAs(blob, fileName);
  return { fileName, materialCount };
}
