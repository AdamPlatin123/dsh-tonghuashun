export const SKIN_STORAGE_KEY = 'dsh-tonghuashun.skin-enabled';
export const THEME_SOURCE = 'dsh-tonghuashun';

export const TERMINAL_TOKENS = {
  '--dsw-alias-brand-primary': { light: '#bf2337', dark: '#ff7182' },
  '--dsw-alias-button-primary-hover': { light: '#a51c2e', dark: '#ff8c99' },
  '--dsw-alias-state-business-primary': { light: '#bf2337', dark: '#ff7182' },
  '--dsw-alias-state-business-tertiary': { light: '#fce9ec', dark: '#47232b' },
  '--dsw-specific-sidebar-fill': { light: '#f2f4f6', dark: '#181b20' },
  '--dsw-specific-sidebar-nav-item-active-accent': { light: '#f5dce1', dark: '#43252e' },
};

function browserStorage() {
  try { return globalThis.localStorage; } catch { return undefined; }
}

export function createSkinState(storage = browserStorage()) {
  let enabled = true;
  try { enabled = storage?.getItem(SKIN_STORAGE_KEY) !== 'false'; } catch { /* Storage may be unavailable. */ }
  const listeners = new Set();
  return {
    getSnapshot: () => enabled,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setEnabled(value) {
      const next = Boolean(value);
      if (next === enabled) return;
      enabled = next;
      try { storage?.setItem(SKIN_STORAGE_KEY, String(next)); } catch { /* The visual toggle still works in memory. */ }
      for (const listener of listeners) listener();
    },
  };
}

export function bindThemeOverrides(theme, skin) {
  let dispose;
  const sync = () => {
    dispose?.();
    dispose = undefined;
    if (skin.getSnapshot()) dispose = theme.overrideTokens(THEME_SOURCE, TERMINAL_TOKENS);
  };
  sync();
  const unsubscribe = skin.subscribe(sync);
  return () => {
    unsubscribe();
    dispose?.();
    dispose = undefined;
  };
}
