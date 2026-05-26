import { stripExtension } from '../export/download';
import type { ParsedMesh } from '../../types/mesh';

const ASCII_VERTEX_PATTERN = /vertex\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/gi;
const PARSE_CHUNK_SIZE = 100_000;

const yieldToBrowser = (): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, 0));

function looksLikeBinaryStl(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 84) {
    return false;
  }

  const view = new DataView(buffer);
  const triangleCount = view.getUint32(80, true);
  return 84 + triangleCount * 50 === buffer.byteLength;
}

async function parseBinaryStl(buffer: ArrayBuffer, name: string): Promise<ParsedMesh> {
  const view = new DataView(buffer);
  const triangleCount = view.getUint32(80, true);
  const positions = new Float32Array(triangleCount * 9);

  for (let chunkStart = 0; chunkStart < triangleCount; chunkStart += PARSE_CHUNK_SIZE) {
    await yieldToBrowser();
    const chunkEnd = Math.min(chunkStart + PARSE_CHUNK_SIZE, triangleCount);
    let positionOffset = chunkStart * 9;
    let offset = 84 + chunkStart * 50;

    for (let faceIndex = chunkStart; faceIndex < chunkEnd; faceIndex += 1) {
      offset += 12;
      for (let vertexIndex = 0; vertexIndex < 3; vertexIndex += 1) {
        positions[positionOffset] = view.getFloat32(offset, true);
        positions[positionOffset + 1] = view.getFloat32(offset + 4, true);
        positions[positionOffset + 2] = view.getFloat32(offset + 8, true);
        positionOffset += 3;
        offset += 12;
      }
      offset += 2;
    }
  }

  return { name, originalFileName: stripExtension(name), positions, faceCount: triangleCount };
}

function parseAsciiStl(source: string, name: string): ParsedMesh {
  const values: number[] = [];
  let match: RegExpExecArray | null;

  while ((match = ASCII_VERTEX_PATTERN.exec(source)) !== null) {
    values.push(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  if (values.length < 9 || values.length % 9 !== 0) {
    throw new Error('ASCII STL did not contain complete triangular facets.');
  }

  return {
    name,
    originalFileName: stripExtension(name),
    positions: new Float32Array(values),
    faceCount: values.length / 9,
  };
}

export async function parseStl(buffer: ArrayBuffer, name: string): Promise<ParsedMesh> {
  if (looksLikeBinaryStl(buffer)) {
    return parseBinaryStl(buffer, name);
  }

  await yieldToBrowser();
  const source = new TextDecoder().decode(buffer);
  return parseAsciiStl(source, name);
}
