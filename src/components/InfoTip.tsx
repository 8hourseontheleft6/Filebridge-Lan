interface InfoTipProps {
  text: string;
  label?: string;
}

export function InfoTip({ text, label = '查看说明' }: InfoTipProps) {
  return (
    <span className="info-tip" tabIndex={0} role="button" aria-label={label}>
      i
      <span className="info-tip-content" role="tooltip">{text}</span>
    </span>
  );
}
