type UploadTarget = 'easyprint' | 'prusaslicer';
type UploadStatus = 'uploading' | 'opening' | 'error';

export interface UploadModalProps {
  open: boolean;
  target: UploadTarget;
  fileName: string;
  progress: number;
  status: UploadStatus;
  errorMessage?: string;
  onCancel: () => void;
  onClose: () => void;
}

const RING_SIZE = 72;
const RING_STROKE = 6;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const TARGET_LABEL: Record<UploadTarget, string> = {
  easyprint: 'EasyPrint',
  prusaslicer: 'PrusaSlicer',
};

export function UploadModal({
  open,
  target,
  fileName,
  progress,
  status,
  errorMessage,
  onCancel,
  onClose,
}: UploadModalProps) {
  if (!open) return null;

  const targetLabel = TARGET_LABEL[target];
  const indeterminate = progress < 0 || status === 'opening';
  const clamped = indeterminate ? 0 : Math.max(0, Math.min(1, progress));
  const dashOffset = RING_CIRCUMFERENCE * (1 - clamped);
  const percentText = indeterminate ? '' : `${Math.round(clamped * 100)}%`;

  let title: string;
  if (status === 'error') title = `Couldn't reach ${targetLabel}`;
  else if (status === 'opening') title = `Opening in ${targetLabel}…`;
  else title = `Uploading to ${targetLabel}…`;

  return (
    <div
      className="upload-modal"
      role="dialog"
      aria-modal="true"
      aria-live="polite"
      aria-label={title}
    >
      <div className="upload-modal__card">
        <h2 className="upload-modal__title">{title}</h2>
        <p className="upload-modal__filename" title={fileName}>{fileName}</p>

        <div className="upload-progress-wrap">
          {indeterminate ? (
            <div
              className={`upload-progress-spinner upload-progress-spinner--${target}`}
              aria-hidden="true"
            />
          ) : (
            <svg
              className={`upload-progress-ring upload-progress-ring--${target}`}
              width={RING_SIZE}
              height={RING_SIZE}
              viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
              aria-hidden="true"
            >
              <circle
                className="upload-progress-ring__track"
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                strokeWidth={RING_STROKE}
                fill="none"
              />
              <circle
                className="upload-progress-ring__indicator"
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                strokeWidth={RING_STROKE}
                fill="none"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
                transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
              />
            </svg>
          )}
          {percentText ? <span className="upload-progress-pct">{percentText}</span> : null}
        </div>

        {status === 'error' && errorMessage ? (
          <p className="upload-modal__error">{errorMessage}</p>
        ) : null}

        <div className="upload-modal__actions">
          {status === 'error' ? (
            <button type="button" className="secondary-button" onClick={onClose}>
              Close
            </button>
          ) : (
            <button
              type="button"
              className="secondary-button"
              onClick={onCancel}
              disabled={status === 'opening'}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
