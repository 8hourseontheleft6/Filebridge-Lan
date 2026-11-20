/** Desktop settings types. */
export interface SettingsPort {
  getDownloadDir(): Promise<string>;
  defaultDownloadDir(): Promise<string>;
  setDownloadDir(path: string): Promise<string>;
  pickDownloadDir(current: string): Promise<string | null>;
  openDownloadDir(): Promise<void>;
  openExternal(url: string): Promise<void>;
}

/** Result of loading the saved download directory. */
export interface LoadedSettings {
  savedDir: string;
  draft: string;
  error: string;
}

/** Result of an action that may update the draft. */
export interface DraftResult {
  draft: string | null;
  savedDir?: string | null;
  message: string;
  error: string;
}

/** Result of an action that only reports success/failure. */
export interface ActionResult {
  error: string;
}
