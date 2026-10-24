import { useEffect, useState } from 'react';
import { fetchHubInfo, type HubInfo } from '../lib/hub';

/**
 * 低频轮询 Hub 信息，用于生成手机扫码地址。
 * Hub 可能晚于页面启动，所以失败后继续重试。
 */
export function useHubInfo(): HubInfo | null {
  const [info, setInfo] = useState<HubInfo | null>(null);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      const data = await fetchHubInfo();
      if (alive && data) setInfo(data);
    };

    void load();
    const timer = window.setInterval(() => { void load(); }, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  return info;
}
