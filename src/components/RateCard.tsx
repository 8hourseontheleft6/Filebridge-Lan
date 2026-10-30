import { useId } from 'react';
import { formatBytes } from '../lib/format';

interface RateCardProps {
  label: string;
  icon: string;
  speed: number;
  peak: number;
  total: number;
  history: number[];
  tone?: 'blue' | 'green';
}

function speedLabel(value: number): string {
  return value > 0 ? `${formatBytes(value)}/s` : '0 B/s';
}

export function RateCard({
  label,
  icon,
  speed,
  peak,
  total,
  history,
  tone = 'blue',
}: RateCardProps) {
  const gradientId = `rate-${useId().replace(/:/g, '')}`;
  const values = history.length > 1 ? history : [0, 0];
  const max = Math.max(1, ...values);
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 44 - (value / max) * 34;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const area = `0,44 ${points} 100,44`;
  const stroke = tone === 'green' ? '#43b981' : '#5b9cf6';

  return (
    <div className={`rate-card ${tone}`}>
      <div className="rate-head">
        <span className="rate-label"><span aria-hidden>{icon}</span>{label}</span>
        <span className="rate-peak">峰值 {speedLabel(peak)}</span>
      </div>
      <div className="rate-value">{speedLabel(speed)}</div>
      <div className="rate-total">累计 {formatBytes(total)}</div>
      <svg className="rate-chart" viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.24" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill={`url(#${gradientId})`} />
        <polyline
          points={points}
          fill="none"
          stroke={stroke}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
