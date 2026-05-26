const SLICER_IMPORT_URL = 'https://slicer.printables.com/import';

export interface SlicerUploadOptions {
  sourceName?: string;
  sourceUrl?: string;
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
}

export interface SlicerUploadResult {
  easyprintUrl: string;
  prusaslicerUrl: string;
  fileUrl: string;
  fileName: string;
}

export class SlicerUploadAbortError extends Error {
  constructor() {
    super('Upload aborted');
    this.name = 'SlicerUploadAbortError';
  }
}

export function uploadToSlicer(
  blob: Blob,
  fileName: string,
  { sourceName, sourceUrl, signal, onProgress }: SlicerUploadOptions = {},
): Promise<SlicerUploadResult> {
  return new Promise<SlicerUploadResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new SlicerUploadAbortError());
      return;
    }

    const form = new FormData();
    const file = new File([blob], fileName, { type: blob.type || 'model/3mf' });
    form.append('file', file);
    form.append('file_name', fileName);
    if (sourceName) form.append('file_source_name', sourceName);
    if (sourceUrl) form.append('file_source_url', sourceUrl);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', SLICER_IMPORT_URL);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.responseType = 'json';

    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress(event.loaded, event.total);
        }
      };
    }

    const onAbort = () => {
      xhr.abort();
    };
    signal?.addEventListener('abort', onAbort);

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };

    xhr.onload = () => {
      cleanup();
      const body = xhr.response;
      if (xhr.status >= 200 && xhr.status < 300 && body && body.easyprint_url) {
        resolve({
          easyprintUrl: body.easyprint_url,
          prusaslicerUrl: body.prusaslicer_url,
          fileUrl: body.file_url,
          fileName: body.file_name ?? fileName,
        });
        return;
      }
      const code = body?.error ?? `http-${xhr.status}`;
      const details = body?.details ? ` (${body.details})` : '';
      reject(new Error(`Upload failed: ${code}${details}`));
    };

    xhr.onerror = () => {
      cleanup();
      reject(new Error('Network error while uploading to slicer.'));
    };

    xhr.onabort = () => {
      cleanup();
      reject(new SlicerUploadAbortError());
    };

    xhr.send(form);
  });
}

export function canOpenInPrusaslicer(): boolean {
  if (typeof navigator === 'undefined') return false;
  return !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
