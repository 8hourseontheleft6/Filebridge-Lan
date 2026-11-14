import { useId } from 'react';
import { formatBytes } from '../lib/format';

interface TransferMeterProps {
  tone: 'blue' | 'green';
  label: string;
  percent: number;
  speed: number;
  history: number[];
}

const ACCENT = { blue: '#5b9cf6', green: '#43b981' } as const;

/**
 * Explorer-style transfer meter: the completed share of the track, the live
 * speed shape and the current speed sit in one bordered box instead of a bare
 * progress bar next to a second readout.
 */
export function TransferMeter({ tone, label, percent, speed, history }: TransferMeterProps) {
  const gradientId = `meter-${useId().replace(/:/g, '')}`;
  const accent = ACCENT[tone];
  const values = history.length > 1 ? history : [0, 0];
  const max = Math.max(1, ...values);
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = Math.min(34, 40 - (Math.max(0, value) / max) * 24);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const area = `0,40 ${points} 100,40`;
  const shownPercent = Math.max(0, Math.min(100, Math.round(percent)));

  return (
    <div
      className={`transfer-meter ${tone}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={shownPercent}
    >
      <div className="transfer-meter-fill" style={{ width: `${shownPercent}%` }} />
      <svg className="transfer-meter-chart" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.34" />
            <stop offset="100%" stopColor={accent} stopOpacity="0.04" />
          </linearGradient>
        </defs>
        <polygon points={area} fill={`url(#${gradientId})`} />
        <polyline
          points={points}
          fill="none"
          stroke={accent}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className="transfer-meter-speed">
        速度 {speed > 0 ? `${formatBytes(speed)}/s` : '0B/s'}
      </span>
    </div>
  );
}
