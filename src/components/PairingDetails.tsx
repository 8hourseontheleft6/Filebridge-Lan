import { CopyButton } from './CopyButton';
import { Icon } from './Icon';

interface PairingDetailsProps {
  sessionCode: string;
  codeInput: string;
  codeError: string;
  canRotate: boolean;
  rotating: boolean;
  expanded: boolean;
  onToggle: () => void;
  onCodeInput: (value: string) => void;
  onUnlock: () => void;
  onRotate: () => void;
}

/** Manual pairing / session details disclosure. */
export function PairingDetails({
  sessionCode,
  codeInput,
  codeError,
  canRotate,
  rotating,
  expanded,
  onToggle,
  onCodeInput,
  onUnlock,
  onRotate,
}: PairingDetailsProps) {
  return (
    <div className={`pairing-details${expanded ? ' is-open' : ''}`}>
      <button
        type="button"
        className="pairing-summary"
        aria-expanded={expanded}
        aria-controls="pairing-body"
        onClick={onToggle}
      >
        <span>手动连接 / 连接详情</span>
        <Icon name="chevron-down" size={14} className="pairing-chevron" />
      </button>
      <div
        id="pairing-body"
        className={`pairing-body disclosure${expanded ? ' is-open' : ''}`}
        inert={expanded ? undefined : true}
      >
        <div className="disclosure-inner">
          <div className="pairing-code-row">
            {sessionCode && (
              <>
                <span>配对码</span>
                <strong>{sessionCode}</strong>
              </>
            )}
            <div className="pairing-code-actions">
              {sessionCode && (
                <CopyButton text={sessionCode} label="复制配对码" variant="icon" />
              )}
              {canRotate && (
                <button
                  type="button"
                  className="btn btn-ghost btn-icon-round"
                  onClick={onRotate}
                  disabled={rotating}
                  aria-label="重新生成配对码"
                  title="重新生成配对码"
                >
                  <Icon name="refresh" size={14} className={rotating ? 'is-spinning' : undefined} />
                </button>
              )}
            </div>
          </div>
          <label className="field-label" htmlFor="http-session-code">手动输入配对码</label>
          <div className="path-row">
            <input
              id="http-session-code"
              className="input"
              value={codeInput}
              onChange={(event) => onCodeInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') onUnlock(); }}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="6 位数字"
              style={{ textAlign: 'center', fontSize: '1.2rem', letterSpacing: 4 }}
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={onUnlock}
              disabled={codeInput.length !== 6 || rotating}
            >
              连接
            </button>
          </div>
          {codeError && <p className="text-error" role="alert">{codeError}</p>}
          <p className="hint">
            扫码即可连接；配对码仅用于授权。
          </p>
        </div>
      </div>
    </div>
  );
}
