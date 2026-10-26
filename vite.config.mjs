import { fileURLToPath } from 'url';
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  // Keep default base neutral; scripts override it for web/electron builds.
  base: '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  root: '.',
  build: {
    outDir: 'dist',
  },
  server: {
    port: 1111,
    host: '0.0.0.0',
    headers: {
      'Cache-Control': 'no-store',
    },
    // YouTube Music's Innertube API has no CORS headers, so browser builds
    // reach it through this dev-only relay. Production web builds need
    // VITE_YTM_PROXY, and the Electron app routes through IPC instead.
    proxy: {
      '/__ytmusic': {
        target: 'https://music.youtube.com',
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/__ytmusic/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            // A foreign Origin makes Innertube answer 403.
            proxyReq.removeHeader('origin');
            proxyReq.removeHeader('referer');
          });
        },
      },
    },
  }
});
