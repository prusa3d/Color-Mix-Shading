import type { ParsedMesh } from '../../types/mesh';
import { parseObj } from './parseObj';
import { parseStl } from './parseStl';

export async function parseMeshFile(file: File): Promise<ParsedMesh> {
  const extension = file.name.split('.').pop()?.toLowerCase();

  if (extension === 'stl') {
    return parseStl(await file.arrayBuffer(), file.name);
  }

  if (extension === 'obj') {
    return parseObj(await file.text(), file.name);
  }

  throw new Error('Please upload an STL or OBJ file.');
}
