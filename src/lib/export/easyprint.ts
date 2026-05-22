const EASYPRINT_IMPORT_URL = 'https://slicer.printables.com/import';

type OpenTarget = 'self' | 'blank';

export interface OpenInEasyPrintOptions {
  sourceName?: string;
  sourceUrl?: string;
  target?: OpenTarget;
}

export function openInEasyPrint(
  blob: Blob,
  fileName: string,
  { sourceName, sourceUrl, target = 'blank' }: OpenInEasyPrintOptions = {},
): void {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = EASYPRINT_IMPORT_URL;
  form.enctype = 'multipart/form-data';
  form.style.display = 'none';
  if (target === 'blank') {
    form.target = '_blank';
  }

  const file = new File([blob], fileName, { type: blob.type || 'model/3mf' });

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.name = 'file';
  const dt = new DataTransfer();
  dt.items.add(file);
  fileInput.files = dt.files;
  form.appendChild(fileInput);

  const appendHidden = (name: string, value: string) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  };

  appendHidden('file_name', fileName);
  if (sourceName) appendHidden('file_source_name', sourceName);
  if (sourceUrl) appendHidden('file_source_url', sourceUrl);

  document.body.appendChild(form);
  form.submit();
  form.remove();
}
