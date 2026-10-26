// Files in Vite's public/ directory are served from the app root. That root
// differs between the web build (/) and the Electron build (./), so resolve
// them through BASE_URL instead of hard-coding a leading slash.
export function publicAssetUrl(name) {
  const base = import.meta.env.BASE_URL || '/';
  return `${base}${String(name || '').replace(/^\/+/, '')}`;
}
