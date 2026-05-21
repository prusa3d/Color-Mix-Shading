import type { ParsedMesh } from '../../types/mesh';
import { parseObj } from './parseObj';
import { parseStl } from './parseStl';
import { parseThreeMf } from './parseThreeMf';

export async function parseMeshFile(file: File): Promise<ParsedMesh> {
  const extension = file.name.split('.').pop()?.toLowerCase();

  if (extension === 'stl') {
    return parseStl(await file.arrayBuffer(), file.name);
  }

  if (extension === 'obj') {
    return parseObj(await file.text(), file.name);
  }

  if (extension === '3mf') {
    return parseThreeMf(await file.arrayBuffer(), file.name);
  }

  throw new Error('Please upload an STL, OBJ, or 3MF file.');
}
