// QueryMT Desktop is a Tauri SPA. Reloading a nested session URL must stay on
// that route in the webview; Vite SSR of session pages throws because they use
// browser-only APIs such as requestAnimationFrame.
export const ssr = false;
