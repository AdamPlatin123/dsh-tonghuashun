import { useSyncExternalStore, useMemo } from 'react';

const stores = new Map();
function createStore(root, apiBase) {
  let state = { project: null, error: '', loading: true, preview: false };
  let timer;
  let controller;
  let lastBody = '';
  const listeners = new Set();
  const publish = next => { state = next; for (const listener of listeners) listener(); };
  const refresh = async (rescan = false) => {
    if (controller || !root) return;
    controller = new AbortController();
    try {
      const response = await fetch(`${apiBase}/tonghuashun/ledger?root=${encodeURIComponent(root)}${rescan ? '&refresh=1' : ''}`, { signal: controller.signal });
      const body = await response.text();
      const value = JSON.parse(body);
      if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
      if (body !== lastBody || state.error || state.loading) {
        lastBody = body;
        publish({ project: value.project, preview: !!value.preview, loading: false, error: '' });
      }
    } catch (error) {
      if (error.name !== 'AbortError') publish({ ...state, loading: false, error: error.message });
    } finally { controller = undefined; }
  };
  return {
    getSnapshot: () => state,
    refresh,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) { refresh(); timer = setInterval(refresh, 1500); }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) { clearInterval(timer); controller?.abort(); }
      };
    },
  };
}

export function useProject(root, apiBase = '') {
  const store = useMemo(() => {
    const key = `${apiBase}\0${root}`;
    if (!stores.has(key)) stores.set(key, createStore(root, apiBase));
    return stores.get(key);
  }, [root, apiBase]);
  return { ...useSyncExternalStore(store.subscribe, store.getSnapshot), refresh: () => store.refresh(true) };
}
