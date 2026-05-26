import JSZip from 'jszip';
import { stripExtension } from '../export/download';
import type { ParsedMesh, Vec3 } from '../../types/mesh';

type Transform = [number, number, number, number, number, number, number, number, number, number, number, number];

const MODEL_PATH_PATTERN = /\.model$/i;
const PARSE_YIELD_INTERVAL = 50_000;
const MAX_COMPONENT_DEPTH = 16;

const yieldToBrowser = (): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, 0));

function parseTransform(value: string | null | undefined): Transform | null {
  if (!value) {
    return null;
  }
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length !== 12 || parts.some((entry) => !Number.isFinite(entry))) {
    return null;
  }
  return parts as Transform;
}

function applyTransform(t: Transform | null, x: number, y: number, z: number): Vec3 {
  if (!t) {
    return [x, y, z];
  }
  return [
    t[0] * x + t[3] * y + t[6] * z + t[9],
    t[1] * x + t[4] * y + t[7] * z + t[10],
    t[2] * x + t[5] * y + t[8] * z + t[11],
  ];
}

function getCell(matrix: Transform, row: number, col: number): number {
  return col < 3 ? matrix[col * 3 + row] : matrix[9 + row];
}

function compose(a: Transform | null, b: Transform | null): Transform | null {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  const out = new Array<number>(12).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      let sum = 0;
      for (let k = 0; k < 3; k += 1) {
        sum += getCell(a, row, k) * getCell(b, k, col);
      }
      out[col * 3 + row] = sum;
    }
    let translation = getCell(a, row, 3);
    for (let k = 0; k < 3; k += 1) {
      translation += getCell(a, row, k) * getCell(b, k, 3);
    }
    out[9 + row] = translation;
  }
  return out as Transform;
}

function findModelEntry(zip: JSZip): JSZip.JSZipObject {
  const standard = zip.file('3D/3dmodel.model');
  if (standard) {
    return standard;
  }

  let fallback: JSZip.JSZipObject | null = null;
  zip.forEach((path, entry) => {
    if (fallback || entry.dir) {
      return;
    }
    if (MODEL_PATH_PATTERN.test(path)) {
      fallback = entry;
    }
  });

  if (!fallback) {
    throw new Error('3MF archive does not contain a 3D model file.');
  }
  return fallback;
}

function childByLocalName(parent: Element, localName: string): Element | null {
  for (const child of Array.from(parent.children)) {
    if (child.localName === localName) {
      return child;
    }
  }
  return null;
}

function childrenByLocalName(parent: Element, localName: string): Element[] {
  const out: Element[] = [];
  for (const child of Array.from(parent.children)) {
    if (child.localName === localName) {
      out.push(child);
    }
  }
  return out;
}

async function expandObject(
  objectElement: Element,
  transform: Transform | null,
  objectsById: Map<string, Element>,
  positions: number[],
  depth: number,
): Promise<void> {
  if (depth > MAX_COMPONENT_DEPTH) {
    return;
  }

  const meshElement = childByLocalName(objectElement, 'mesh');
  if (meshElement) {
    const verticesElement = childByLocalName(meshElement, 'vertices');
    const trianglesElement = childByLocalName(meshElement, 'triangles');
    if (verticesElement && trianglesElement) {
      const vertexElements = childrenByLocalName(verticesElement, 'vertex');
      const localVertices: Vec3[] = new Array(vertexElements.length);
      for (let i = 0; i < vertexElements.length; i += 1) {
        const element = vertexElements[i];
        const x = Number(element.getAttribute('x'));
        const y = Number(element.getAttribute('y'));
        const z = Number(element.getAttribute('z'));
        localVertices[i] = applyTransform(transform, x, y, z);
        if (i > 0 && i % PARSE_YIELD_INTERVAL === 0) {
          await yieldToBrowser();
        }
      }

      const triangleElements = childrenByLocalName(trianglesElement, 'triangle');
      for (let i = 0; i < triangleElements.length; i += 1) {
        const element = triangleElements[i];
        const v1 = Number(element.getAttribute('v1'));
        const v2 = Number(element.getAttribute('v2'));
        const v3 = Number(element.getAttribute('v3'));
        const a = localVertices[v1];
        const b = localVertices[v2];
        const c = localVertices[v3];
        if (!a || !b || !c) {
          continue;
        }
        positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
        if (i > 0 && i % PARSE_YIELD_INTERVAL === 0) {
          await yieldToBrowser();
        }
      }
    }
  }

  const componentsElement = childByLocalName(objectElement, 'components');
  if (componentsElement) {
    for (const component of childrenByLocalName(componentsElement, 'component')) {
      const refId = component.getAttribute('objectid');
      if (!refId) {
        continue;
      }
      const target = objectsById.get(refId);
      if (!target) {
        continue;
      }
      const localTransform = parseTransform(component.getAttribute('transform'));
      await expandObject(target, compose(transform, localTransform), objectsById, positions, depth + 1);
    }
  }
}

export async function parseThreeMf(buffer: ArrayBuffer, fileName: string): Promise<ParsedMesh> {
  const zip = await JSZip.loadAsync(buffer);
  const modelEntry = findModelEntry(zip);
  const xmlSource = await modelEntry.async('string');

  await yieldToBrowser();
  const doc = new DOMParser().parseFromString(xmlSource, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('3MF model XML is malformed.');
  }

  const root = doc.documentElement;
  if (!root || root.localName !== 'model') {
    throw new Error('3MF file does not contain a <model> root element.');
  }

  const resources = childByLocalName(root, 'resources');
  if (!resources) {
    throw new Error('3MF model is missing <resources>.');
  }

  const objectsById = new Map<string, Element>();
  let firstObjectName: string | null = null;
  for (const objectElement of childrenByLocalName(resources, 'object')) {
    const id = objectElement.getAttribute('id');
    if (!id) {
      continue;
    }
    objectsById.set(id, objectElement);
    if (!firstObjectName) {
      firstObjectName = objectElement.getAttribute('name');
    }
  }

  if (objectsById.size === 0) {
    throw new Error('3MF file does not contain any objects.');
  }

  const positions: number[] = [];
  const buildElement = childByLocalName(root, 'build');
  const items = buildElement ? childrenByLocalName(buildElement, 'item') : [];

  if (items.length > 0) {
    for (const item of items) {
      const refId = item.getAttribute('objectid');
      if (!refId) {
        continue;
      }
      const target = objectsById.get(refId);
      if (!target) {
        continue;
      }
      const itemTransform = parseTransform(item.getAttribute('transform'));
      await expandObject(target, itemTransform, objectsById, positions, 0);
    }
  } else {
    for (const objectElement of objectsById.values()) {
      await expandObject(objectElement, null, objectsById, positions, 0);
    }
  }

  if (positions.length === 0 || positions.length % 9 !== 0) {
    throw new Error('3MF did not contain usable triangular geometry.');
  }

  const baseName = firstObjectName?.trim() || fileName;
  return {
    name: baseName,
    originalFileName: stripExtension(fileName),
    positions: new Float32Array(positions),
    faceCount: positions.length / 9,
  };
}
