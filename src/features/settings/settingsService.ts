/**
 * Desktop settings application service.
 *
 * All Tauri commands go through the settings port (backed by
 * `src/platform/tauri.ts`); the exported flow functions are pure enough to test
 * without React or a real desktop shell. Messages match the pre-refactor UI.
 */
import { tauri } from '../../platform/tauri';
import type { ActionResult, DraftResult, LoadedSettings, SettingsPort } from './types';

export const tauriSettingsPort: SettingsPort = {
  getDownloadDir: () => tauri.getDownloadDir(),
  defaultDownloadDir: () => tauri.defaultDownloadDir(),
  setDownloadDir: (path) => tauri.setDownloadDir(path),
  pickDownloadDir: (current) => tauri.pickDownloadDir(current),
  openDownloadDir: () => tauri.openDownloadDir(),
  openExternal: (url) => tauri.openExternal(url),
};

export const PROJECT_URL = 'https://github.com/8hourseontheleft6/Filebridge-Lan';

function reasonText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Initial load: current download directory for the desktop shell. */
export async function loadSettings(port: SettingsPort): Promise<LoadedSettings> {
  try {
    const dir = await port.getDownloadDir();
    return { savedDir: dir, draft: dir, error: '' };
  } catch (reason) {
    return { savedDir: '', draft: '', error: `读取设置失败：${reasonText(reason)}` };
  }
}

/** "选择…" — a cancelled dialog returns `draft: null` and keeps the old value. */
export async function chooseFolder(port: SettingsPort, current: string): Promise<DraftResult> {
  try {
    const picked = await port.pickDownloadDir(current);
    return { draft: picked ?? null, message: '', error: '' };
  } catch (reason) {
    return { draft: null, message: '', error: `选择文件夹失败：${reasonText(reason)}` };
  }
}

/** "保存" — persists the draft and reports the normalized directory. */
export async function saveSettings(port: SettingsPort, draft: string): Promise<DraftResult> {
  try {
    const dir = await port.setDownloadDir(draft);
    return { draft: dir, savedDir: dir, message: '已保存', error: '' };
  } catch (reason) {
    return { draft: null, message: '', error: `保存失败：${reasonText(reason)}` };
  }
}

/** "恢复默认" — only fills the draft; the user still has to save. */
export async function resetSettings(port: SettingsPort): Promise<DraftResult> {
  try {
    const dir = await port.defaultDownloadDir();
    return { draft: dir, message: '已恢复默认路径，点击“保存”生效', error: '' };
  } catch (reason) {
    return { draft: null, message: '', error: `恢复默认失败：${reasonText(reason)}` };
  }
}

export async function openFolder(port: SettingsPort): Promise<ActionResult> {
  try {
    await port.openDownloadDir();
    return { error: '' };
  } catch (reason) {
    return { error: `打开文件夹失败：${reasonText(reason)}` };
  }
}

/**
 * Project link: desktop uses the OS default handler through Tauri; browsers use
 * a normal `window.open` and never call the platform adapter.
 */
export async function openProject(
  desktop: boolean,
  port: SettingsPort,
  openWindow: (url: string) => void = (url) => window.open(url, '_blank', 'noopener,noreferrer') as unknown as void,
): Promise<ActionResult> {
  if (!desktop) {
    openWindow(PROJECT_URL);
    return { error: '' };
  }
  try {
    await port.openExternal(PROJECT_URL);
    return { error: '' };
  } catch (reason) {
    return { error: `打开链接失败：${reasonText(reason)}` };
  }
}
