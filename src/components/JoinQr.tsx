import { QRCodeSVG } from 'qrcode.react';
import { CopyButton } from './CopyButton';

export function JoinQr({
  url,
  title,
  subtitle,
}: {
  url: string;
  title: string;
  subtitle?: string;
}) {
  if (!url) return null;

  return (
    <div className="qr-card" aria-label={title}>
      <div className="qr-code">
        <QRCodeSVG
          value={url}
          size={132}
          level="M"
          marginSize={2}
          bgColor="#ffffff"
          fgColor="#1a1a2e"
          title={title}
        />
      </div>
      <div className="qr-info">
        <strong>{title}</strong>
        {subtitle && <p className="hint">{subtitle}</p>}
        <code className="qr-url" title={url}>{url}</code>
        <div className="qr-actions">
          <CopyButton text={url} label="复制链接" />
        </div>
      </div>
    </div>
  );
}
