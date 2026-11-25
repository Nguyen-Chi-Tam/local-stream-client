import { fileURLToPath } from 'url';
import http from 'node:http';
import https from 'node:https';
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FORWARDED_REQ_HEADERS = [
  'accept',
  'content-type',
  'range',
  'if-none-match',
  'if-modified-since',
  'user-agent',
];

function createMediaProxyMiddleware() {
  return (req, res, next) => {
    const reqUrl = req.url || '';
    if (!reqUrl.startsWith('/__media')) return next();

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Accept, Content-Type, Range, If-None-Match, If-Modified-Since',
        'Access-Control-Allow-Private-Network': 'true',
      });
      res.end();
      return;
    }

    let rawTarget = '';
    let downloadName = '';
    try {
      const parsedReq = new URL(reqUrl, 'http://localhost');
      rawTarget = parsedReq.searchParams.get('url') || '';
      downloadName = (parsedReq.searchParams.get('download') || '').trim();
    } catch {
      rawTarget = '';
    }

    if (!rawTarget) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Missing url parameter');
      return;
    }

    let targetUrl;
    try {
      targetUrl = new URL(rawTarget);
      if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
        throw new Error('Unsupported protocol');
      }
    } catch {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Invalid url parameter');
      return;
    }

    const transport = targetUrl.protocol === 'https:' ? https : http;
    const forwardHeaders = {};
    for (const name of FORWARDED_REQ_HEADERS) {
      if (req.headers[name] != null) {
        forwardHeaders[name] = req.headers[name];
      }
    }

    const method = req.method || 'GET';
    const proxyReq = transport.request(
      targetUrl,
      { method, headers: forwardHeaders },
      (proxyRes) => {
        const outHeaders = { ...proxyRes.headers };
        delete outHeaders['transfer-encoding'];
        delete outHeaders.connection;
        delete outHeaders['keep-alive'];
        outHeaders['access-control-allow-origin'] = '*';
        outHeaders['access-control-allow-private-network'] = 'true';
        outHeaders['access-control-expose-headers'] =
          'Content-Length, Content-Range, Accept-Ranges, Content-Disposition';

        if (downloadName) {
          const asciiFallback = downloadName.replace(/[^\x20-\x7E]|["\\]/g, '_');
          const encoded = encodeURIComponent(downloadName);
          outHeaders['content-disposition'] =
            `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
        }

        if (proxyRes.headers['cache-control']) {
          res.removeHeader('Cache-Control');
        }

        res.writeHead(proxyRes.statusCode ?? 200, outHeaders);

        if (method === 'HEAD') {
          proxyRes.resume();
          res.end();
          return;
        }

        proxyRes.on('error', () => {
          if (!res.destroyed) res.destroy();
        });
        proxyRes.pipe(res);
      },
    );

    const abortUpstream = () => {
      if (!proxyReq.destroyed) proxyReq.destroy();
    };
    req.on('aborted', abortUpstream);
    res.on('close', () => {
      if (!res.writableEnded) abortUpstream();
    });

    proxyReq.on('error', (err) => {
      if (!res.headersSent && !res.writableEnded) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Proxy error: ' + err.message);
      } else if (!res.destroyed) {
        res.destroy();
      }
    });

    if (method === 'GET' || method === 'HEAD') {
      proxyReq.end();
    } else {
      req.pipe(proxyReq);
    }
  };
}

/**
 * Local dev/preview proxy for the LocalStream media API so browser builds stay
 * same-origin and avoid CORS (including <audio>, <video> Range requests, <img>,
 * and canvas sprite sheets).
 *
 * NOTE: `configureServer` MUST live on a Vite plugin object — Vite ignores
 * `server.configureServer`, which previously caused `/__media` to return 404.
 */
function localstreamMediaProxyPlugin() {
  return {
    name: 'localstream-media-proxy',
    configureServer(server) {
      server.middlewares.use(createMediaProxyMiddleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(createMediaProxyMiddleware());
    },
  };
}

export default defineConfig({
  // Keep default base neutral; scripts override it for web/electron builds.
  base: '/',
  plugins: [react(), localstreamMediaProxyPlugin()],
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
    // VITE_YTM_PROXY, and the Tauri app routes through IPC instead.
    proxy: {
      '/__ytmusic': {
        target: 'https://music.youtube.com',
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/__ytmusic/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin');
            proxyReq.removeHeader('referer');
          });
        },
      },
    },
  },
});
