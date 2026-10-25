import { QRCodeSVG } from 'qrcode.react';
import type { ReactNode } from 'react';
import { CopyButton } from './CopyButton';

export function JoinQr({
  url,
  displayUrl,
  title,
  subtitle,
  actions,
}: {
  url: string;
  displayUrl?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  if (!url) return null;
  const shown = displayUrl || url;

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
        <code
          className="qr-url"
          title={shown === url ? undefined : '完整链接已隐藏，请使用复制按钮或显示 code'}
        >{shown}</code>
        <div className="qr-actions">
          {actions}
          <CopyButton text={url} label="复制链接" />
        </div>
      </div>
    </div>
  );
}
