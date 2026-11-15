/**
 * LAN address selection for the Node Hub.
 *
 * Keep this in step with src-tauri/src/network_profile.rs: only real adapters
 * may be advertised to phones, and the adapter that carries the default route
 * comes first. scripts/fixtures/lan-ips.json is asserted by both
 * implementations, so the candidate order stays identical.
 */

export const VIRTUAL_NAME_MARKERS = [
  'virtualbox',
  'vbox',
  'vmware',
  'vmnet',
  'hyper-v',
  'vethernet',
  'wsl',
  'virtual ethernet',
  'host-only',
  'wi-fi direct',
  'wifi direct',
  'microsoft wi-fi direct',
  'tap-windows',
  'tap-win32',
  'tap adapter',
  'openvpn',
  'wireguard',
  'tailscale',
  'zerotier',
  'npcap',
  'hamachi',
  'radmin',
  'softether',
  'pseudo-interface',
  'teredo',
  'isatap',
  '6to4',
  'loopback',
  'bluetooth',
  'docker',
  'wintun',
  'vpn',
  'tunnel',
  'tap',
];

export const VIRTUAL_MAC_PREFIXES = [
  '0a:00:27', // VirtualBox
  '00:15:5d', // Hyper-V
  '00:50:56', // VMware
  '00:0c:29', // VMware
  '00:05:69', // VMware
  '00:1c:14', // VMware
  '00:1c:42', // Parallels
  '00:16:3e', // Xen
  '52:54:00', // QEMU / KVM
  '00:ff', // TAP-Windows / OpenVPN
  '02:42', // Docker bridge
];

export function isPrivateIPv4(ip) {
  return (
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
}

export function normalizeMac(mac) {
  const value = String(mac || '').toLowerCase().replace(/-/g, ':');
  if (!/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(value)) return '';
  if (value === '00:00:00:00:00:00') return '';
  return value;
}

export function isVirtualAdapter(adapter) {
  const haystack = `${String(adapter.name || '')} ${String(adapter.description || '')}`.toLowerCase();
  if (VIRTUAL_NAME_MARKERS.some((marker) => haystack.includes(marker))) return true;
  const mac = normalizeMac(adapter.mac);
  return mac ? VIRTUAL_MAC_PREFIXES.some((prefix) => mac.startsWith(prefix)) : false;
}

/**
 * Pure selection used by /api/info and by the smoke tests.
 * adapters: { name, description?, mac?, ip, internal?, up?, isDefaultRoute?, metric? }
 */
export function selectLanIps(adapters) {
  return adapters
    .filter((adapter) => adapter && !adapter.internal && adapter.up !== false)
    .filter((adapter) => isPrivateIPv4(String(adapter.ip || '')))
    .filter((adapter) => !isVirtualAdapter(adapter))
    .sort((a, b) => {
      const rankA = a.isDefaultRoute ? 0 : 1;
      const rankB = b.isDefaultRoute ? 0 : 1;
      if (rankA !== rankB) return rankA - rankB;
      const metric = (a.metric ?? 0) - (b.metric ?? 0);
      if (metric !== 0) return metric;
      const ipA = String(a.ip);
      const ipB = String(b.ip);
      if (ipA === ipB) return 0;
      return ipA < ipB ? -1 : 1;
    })
    .map((adapter) => ({ iface: adapter.name, ip: adapter.ip }));
}
