/**
 * Settings controller.
 *
 * Owns the desktop settings state machine (load / choose / save / reset / open)
 * and the unmount guard. The panel only renders and calls these actions.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { isTauriHost } from '../../platform/runtime';
import {
  chooseFolder,
  loadSettings,
  openFolder,
  openProject,
  resetSettings,
  saveSettings,
  tauriSettingsPort,
} from './settingsService';
import type { SettingsPort } from './types';

export interface SettingsController {
  desktop: boolean;
  savedDir: string;
  draft: string;
  busy: boolean;
  message: string;
  error: string;
  setDraft(value: string): void;
  chooseFolder(): Promise<void>;
  save(): Promise<void>;
  reset(): Promise<void>;
  openFolder(): Promise<void>;
  openProject(): Promise<void>;
}

export function useSettings(port: SettingsPort = tauriSettingsPort): SettingsController {
  const desktop = isTauriHost();
  const [savedDir, setSavedDir] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void loadSettings(port).then((loaded) => {
      if (!active) return;
      setSavedDir(loaded.savedDir);
      setDraft(loaded.draft);
      if (loaded.error) setError(loaded.error);
    });
    return () => {
      active = false;
    };
  }, [desktop, port]);

  const run = useCallback(async (action: () => Promise<void>) => {
    if (aliveRef.current) {
      setBusy(true);
      setError('');
      setMessage('');
    }
    try {
      await action();
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }, []);

  const chooseFolderAction = useCallback(() => run(async () => {
    const result = await chooseFolder(port, draft || savedDir);
    if (!aliveRef.current) return;
    if (result.draft !== null) setDraft(result.draft);
    if (result.error) setError(result.error);
  }), [draft, port, run, savedDir]);

  const save = useCallback(() => run(async () => {
    const result = await saveSettings(port, draft);
    if (!aliveRef.current) return;
    if (result.draft !== null) setDraft(result.draft);
    if (result.savedDir != null) setSavedDir(result.savedDir);
    if (result.message) setMessage(result.message);
    if (result.error) setError(result.error);
  }), [draft, port, run]);

  const reset = useCallback(() => run(async () => {
    const result = await resetSettings(port);
    if (!aliveRef.current) return;
    if (result.draft !== null) setDraft(result.draft);
    if (result.message) setMessage(result.message);
    if (result.error) setError(result.error);
  }), [port, run]);

  const openFolderAction = useCallback(async () => {
    if (aliveRef.current) setError('');
    const result = await openFolder(port);
    if (aliveRef.current && result.error) setError(result.error);
  }, [port]);

  const openProjectAction = useCallback(async () => {
    if (!desktop) {
      await openProject(false, port);
      return;
    }
    if (aliveRef.current) setError('');
    const result = await openProject(true, port);
    if (aliveRef.current && result.error) setError(result.error);
  }, [desktop, port]);

  return {
    desktop,
    savedDir,
    draft,
    busy,
    message,
    error,
    setDraft,
    chooseFolder: chooseFolderAction,
    save,
    reset,
    openFolder: openFolderAction,
    openProject: openProjectAction,
  };
}
