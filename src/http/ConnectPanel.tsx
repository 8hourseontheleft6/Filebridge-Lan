import { useEffect, useRef, useState } from 'react';
import {
  createConnectRequest,
  deviceDisplayName,
  getConnectStatus,
  type ConnectRequestCreated,
} from './connect';
import { API_BASE } from '../lib/hub';

interface ConnectPanelProps {
  onConnected: (token: string, expiresAt: number) => void;
  autoConnect?: boolean;
}

type Phase = 'idle' | 'creating' | 'waiting' | 'denied' | 'expired' | 'error';

export function ConnectPanel({ onConnected, autoConnect = false }: ConnectPanelProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [request, setRequest] = useState<ConnectRequestCreated | null>(null);
  const [error, setError] = useState('');
  const [remaining, setRemaining] = useState(60);
  const stoppedRef = useRef(false);
  const autoStartedRef = useRef(false);

  useEffect(() => {
    if (!request || phase !== 'waiting') return;
    let active = true;
    stoppedRef.current = false;

    const check = async () => {
      if (!active) return;
      try {
        const status = await getConnectStatus(request, API_BASE);
        if (!active) return;
        if (status.status === 'approved' && status.token) {
          setPhase('idle');
          stoppedRef.current = true;
          onConnected(status.token, status.expiresAt || 0);
          return;
        }
        if (status.status === 'denied') {
          setPhase('denied');
          setError('主机拒绝了这次连接请求');
          stoppedRef.current = true;
          return;
        }
        if (status.status === 'expired') {
          setPhase('expired');
          setError('主机未确认或请求已过期');
          stoppedRef.current = true;
        }
      } catch (reason) {
        if (!active) return;
        setPhase('error');
        setError(reason instanceof Error ? reason.message : '查询连接状态失败');
        stoppedRef.current = true;
      }
    };

    void check();
    const timer = window.setInterval(() => { void check(); }, 1200);
    const countdown = window.setInterval(() => {
      setRemaining((value) => Math.max(0, value - 1));
    }, 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.clearInterval(countdown);
    };
  }, [onConnected, phase, request]);

  async function start() {
    setPhase('creating');
    setError('');
    try {
      const created = await createConnectRequest(API_BASE, deviceDisplayName());
      setRequest(created);
      setRemaining(Math.max(1, Math.ceil((created.expiresAt - Date.now()) / 1000)));
      setPhase('waiting');
    } catch (reason) {
      setPhase('error');
      setError(reason instanceof Error ? reason.message : '创建连接请求失败');
    }
  }

  useEffect(() => {
    if (!autoConnect || autoStartedRef.current) return;
    autoStartedRef.current = true;
    void start();
  }, [autoConnect]);

  const waiting = phase === 'waiting' || phase === 'creating';
  const failed = phase === 'denied' || phase === 'expired' || phase === 'error';

  return (
    <div className={`connect-request-panel${waiting ? ' waiting' : ''}`}>
      <div className="connect-request-icon" aria-hidden>↗</div>
      <div className="connect-request-copy">
        <h3>{phase === 'waiting' ? '等待主机确认' : '请求主机允许连接'}</h3>
        {phase === 'waiting' ? (
          <p>
            主机端会显示 <strong>{deviceDisplayName()}</strong> 的连接请求。允许后会自动进入文件列表。
            <span className="connect-countdown">约 {remaining} 秒</span>
          </p>
        ) : (
          <p>不需要扫描二维码或输入配对码；主机在 Filebridge 窗口中确认后即可连接。</p>
        )}
        {error && <p className="connect-error">{error}</p>}
      </div>
      <button
        type="button"
        className="btn btn-primary btn-small connect-action"
        onClick={() => void start()}
        disabled={waiting}
      >
        {phase === 'creating' ? '发送中…' : waiting ? '等待确认…' : failed ? '重新请求' : '请求主机允许'}
      </button>
    </div>
  );
}
