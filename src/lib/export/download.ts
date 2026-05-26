const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|\x00-\x1f]/g;

export function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, '');
}

export function sanitizeFileNameBase(name: string): string {
  return name.replace(UNSAFE_FILENAME_CHARS, '').trim() || 'ColorMixShading';
}
