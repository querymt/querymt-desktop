// Shared vitest setup. Installs a localStorage shim only when the environment
// (some sandboxes and minimal CI images) exposes no jsdom storage, so tests
// that persist preferences keep working; environments with real storage are
// unaffected.

if (typeof window !== 'undefined' && !window.localStorage) {
  const backing = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return backing.size;
    },
    clear: () => backing.clear(),
    getItem: (key) => (backing.has(key) ? backing.get(key)! : null),
    key: (index) => Array.from(backing.keys())[index] ?? null,
    removeItem: (key) => {
      backing.delete(key);
    },
    setItem: (key, value) => {
      backing.set(key, String(value));
    }
  };
  Object.defineProperty(window, 'localStorage', { value: shim, configurable: true });
}
