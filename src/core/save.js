// VALLEYWARD · the save's storage in the browser (docs/DESIGN.md §9.1): localStorage under meta.js SAVE_KEY, every access
// in try/catch (a private window, blocked site data or a preview may throw or return nothing: the game then keeps the
// save in memory for the session). The sim takes it as `storage` ({ load, save, clear }); Node uses memoryStorage().
import { SAVE_KEY } from '../shared/meta.js';

export function createLocalStorage(key = SAVE_KEY) {
  let mem = null;
  const ls = () => { try { return globalThis.localStorage || null; } catch { return null; } };
  return {
    load() {
      try { const s = ls()?.getItem(key); if (s) return JSON.parse(s); } catch { /* fall back to memory */ }
      return mem ? JSON.parse(JSON.stringify(mem)) : null;
    },
    save(o) {
      try { mem = JSON.parse(JSON.stringify(o)); } catch { /* */ }
      try { ls()?.setItem(key, JSON.stringify(o)); } catch { /* quota or blocked: memory only */ }
    },
    clear() { mem = null; try { ls()?.removeItem(key); } catch { /* */ } },
  };
}
