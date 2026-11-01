import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 非安全上下文或权限被拒时走 fallback
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    textarea.setAttribute('readonly', '');
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

export function CopyButton({
  text,
  label = '复制',
  className = 'btn btn-small btn-ghost',
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        setFailed(false);
        if (!(await copyText(text))) {
          setFailed(true);
          if (timerRef.current) window.clearTimeout(timerRef.current);
          timerRef.current = window.setTimeout(() => setFailed(false), 2000);
          return;
        }
        setCopied(true);
        if (timerRef.current) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => setCopied(false), 1600);
      }}
      title={failed ? '复制失败，请手动选择链接' : copied ? '已复制' : `复制：${text}`}
    >
      {failed ? '复制失败' : copied ? <><Icon name="check" size={13} /> 已复制</> : label}
    </button>
  );
}
