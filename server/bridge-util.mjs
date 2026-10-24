import net from 'node:net';

function normalizeIp(value) {
  const ip = String(value || '').trim();
  if (!net.isIP(ip)) return '';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

/**
 * 从可信代理链右侧向前解析真实客户端 IP。
 * X-Forwarded-For 的左侧可被客户端伪造，不能直接取第一项。
 */
export function resolveClientIp(remoteAddress, forwardedFor, trustedProxies) {
  const trusted = new Set(
    [...(trustedProxies || [])].map(normalizeIp).filter(Boolean)
  );
  const forwarded = String(forwardedFor || '')
    .split(',')
    .map(normalizeIp)
    .filter(Boolean);
  const chain = [...forwarded, normalizeIp(remoteAddress)].filter(Boolean);
  if (chain.length === 0) return 'unknown';

  for (let index = chain.length - 1; index >= 0; index -= 1) {
    if (!trusted.has(chain[index])) return chain[index];
  }
  return chain[chain.length - 1];
}
