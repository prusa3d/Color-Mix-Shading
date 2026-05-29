// Accepted 3D model file extensions (lowercase, with leading dot).
export const ACCEPTED_UPLOAD_EXTENSIONS = ['.stl', '.obj', '.3mf'] as const;

// Coarse pointer ⇒ touch device. Used to relax the file-input `accept` filter,
// which otherwise hides STL/OBJ/3MF files in mobile file pickers.
export const isMobile =
  typeof window !== 'undefined' &&
  'matchMedia' in window &&
  window.matchMedia('(pointer: coarse)').matches;

// Split a filename into name + lowercased extension (incl. leading dot).
export function splitext(_filename: string): { name: string; ext: string } {
  const filename = _filename || '';
  const ext = filename.slice(Math.max(0, filename.lastIndexOf('.')) || Infinity).toLowerCase();
  return { name: filename.substring(0, filename.length - ext.length), ext };
}

export function isAcceptedUploadFile(filename: string): boolean {
  const { ext } = splitext(filename);
  return (ACCEPTED_UPLOAD_EXTENSIONS as readonly string[]).includes(ext);
}
