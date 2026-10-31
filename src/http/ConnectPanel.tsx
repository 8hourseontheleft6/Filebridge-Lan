import { useEffect, useRef, useState } from 'react';
import {
  createConnectRequest,
  deviceDisplayName,
  getConnectStatus,
  type ConnectRequestCreated,
} from './connect';
import { API_BASE } from '../lib/hub';
import { InfoTip } from '../components/InfoTip';

interface ConnectPanelProps {
  onConnected: (token: string, expiresAt: number) => void;
  autoConnect?: boolean;
}

type Phase = 'idle' | 'creating' | 'waiting' | 'denied' | 'expired' | 'error';

const PENDING_KEY = 'filebridge_connect_pending';

function readPending(): ConnectRequestCreated | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConnectRequestCreated>;
    if (
      typeof parsed.requestId !== 'string'
      || typeof parsed.requestSecret !== 'string'
      || typeof parsed.expiresAt !== 'number'
      || parsed.expiresAt <= Date.now()
    ) {
      window.sessionStorage.removeItem(PENDING_KEY);
      return null;
    }
    return parsed as ConnectRequestCreated;
  } catch {
    return null;
  }
}

function savePending(request: ConnectRequestCreated) {
  try {
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(request));
  } catch {
    // sessionStorage 不可用时只影响刷新恢复，不影响本次请求
  }
}

function clearPending() {
  try {
    window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
}

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
          clearPending();
          setPhase('idle');
          stoppedRef.current = true;
          onConnected(status.token, status.expiresAt || 0);
          return;
        }
        if (status.status === 'denied') {
          clearPending();
          setPhase('denied');
          setError('主机拒绝了这次连接请求');
          stoppedRef.current = true;
          return;
        }
        if (status.status === 'expired') {
          clearPending();
          setPhase('expired');
          setError('主机未确认或请求已过期');
          stoppedRef.current = true;
        }
      } catch (reason) {
        if (!active) return;
        const message = reason instanceof Error ? reason.message : '查询连接状态失败';
        if (message.includes('不存在') || message.includes('失效')) clearPending();
        setPhase('error');
        setError(message);
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
    const saved = readPending();
    if (saved) {
      setRequest(saved);
      setRemaining(Math.max(1, Math.ceil((saved.expiresAt - Date.now()) / 1000)));
      setPhase('waiting');
      return;
    }
    setPhase('creating');
    setError('');
    try {
      const created = await createConnectRequest(API_BASE, deviceDisplayName());
      savePending(created);
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
    const saved = readPending();
    if (saved) {
      setRequest(saved);
      setRemaining(Math.max(1, Math.ceil((saved.expiresAt - Date.now()) / 1000)));
      setPhase('waiting');
      return;
    }
    void start();
  }, [autoConnect]);

  const waiting = phase === 'waiting' || phase === 'creating';
  const failed = phase === 'denied' || phase === 'expired' || phase === 'error';

  return (
    <div className={`connect-request-panel${waiting ? ' waiting' : ''}`}>
      <div className="connect-request-icon" aria-hidden>↗</div>
      <div className="connect-request-copy">
        <h3>
          {phase === 'waiting' ? '等待主机确认' : '请求主机允许连接'}
          <InfoTip text="主机端会显示这台设备的连接请求。允许后自动进入文件列表；拒绝或 60 秒未确认时不会获得访问授权。" />
        </h3>
        {phase === 'waiting' ? (
          <p>
            等待 <strong>{deviceDisplayName()}</strong> 的请求
            <span className="connect-countdown">约 {remaining} 秒</span>
          </p>
        ) : (
          <p>发起后需要主机在 Filebridge 窗口中确认。</p>
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
