import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyMediaLoadError,
  extractServerFromHash,
  getHttpSwitchUrl,
  isMixedContentUrl,
} from './mediaFetchError.js';

test('isMixedContentUrl detects https page requesting non-loopback http server', () => {
  assert.equal(
    isMixedContentUrl('http://192.168.1.11:8080/api/media', {
      pageProtocol: 'https:',
      isDesktop: false,
    }),
    true
  );

  assert.equal(
    isMixedContentUrl('http://localhost:8080/api/media', {
      pageProtocol: 'https:',
      isDesktop: false,
    }),
    false
  );

  assert.equal(
    isMixedContentUrl('http://127.0.0.1:8080/api/media', {
      pageProtocol: 'https:',
      isDesktop: false,
    }),
    false
  );

  assert.equal(
    isMixedContentUrl('/__media?url=http%3A%2F%2F192.168.1.11%3A8080%2Fapi%2Fmedia', {
      pageProtocol: 'https:',
      isDesktop: false,
    }),
    false
  );

  assert.equal(
    isMixedContentUrl('http://192.168.1.11:8080/api/media', {
      pageProtocol: 'http:',
      isDesktop: false,
    }),
    false
  );

  assert.equal(
    isMixedContentUrl('http://192.168.1.11:8080/api/media', {
      pageProtocol: 'https:',
      isDesktop: true,
    }),
    false
  );
});

test('getHttpSwitchUrl and extractServerFromHash round-trip valid server URLs safely', () => {
  const switchUrl = getHttpSwitchUrl('http://192.168.1.11:8080', {
    locationObj: {
      protocol: 'https:',
      host: 'lsclient.qzz.io',
      pathname: '/media',
      search: '',
    },
  });

  assert.equal(
    switchUrl,
    'http://lsclient.qzz.io/media#server=http%3A%2F%2F192.168.1.11%3A8080'
  );

  const hash = switchUrl.slice(switchUrl.indexOf('#'));
  assert.equal(extractServerFromHash(hash), 'http://192.168.1.11:8080');
  assert.equal(extractServerFromHash('#server=https%3A%2F%2Fevil.example'), '');
  assert.equal(extractServerFromHash('#server=javascript%3Aalert(1)'), '');

  assert.equal(
    getHttpSwitchUrl('http://192.168.1.11:8080', {
      locationObj: {
        protocol: 'http:',
        host: 'lsclient.qzz.io',
        pathname: '/media',
        search: '',
      },
    }),
    null
  );
});

test('classifyMediaLoadError classifies mixed-content, timeout, http, and network failures', () => {
  const mixed = classifyMediaLoadError(new TypeError('Failed to fetch'), {
    serverUrl: 'http://192.168.1.11:8080',
    endpoint: 'http://192.168.1.11:8080/api/media',
    pageProtocol: 'https:',
    isDesktop: false,
    locationObj: {
      protocol: 'https:',
      host: 'lsclient.qzz.io',
      pathname: '/media',
      search: '',
    },
  });
  assert.equal(mixed.kind, 'mixed-content');
  assert.match(mixed.message, /mixed-content/i);
  assert.equal(
    mixed.httpSwitchUrl,
    'http://lsclient.qzz.io/media#server=http%3A%2F%2F192.168.1.11%3A8080'
  );

  const timeoutErr = Object.assign(new Error('Request timed out after 8000ms'), {
    name: 'TimeoutError',
    code: 'TIMEOUT',
  });
  const timeout = classifyMediaLoadError(timeoutErr, {
    serverUrl: 'http://192.168.1.11:8080',
    endpoint: 'http://192.168.1.11:8080/api/media',
    pageProtocol: 'http:',
    isDesktop: false,
  });
  assert.equal(timeout.kind, 'timeout');
  assert.match(timeout.message, /timed out/i);
  assert.equal(timeout.httpSwitchUrl, null);

  const httpErr = Object.assign(new Error('Server responded with 503'), {
    status: 503,
    code: 'HTTP_ERROR',
  });
  const http = classifyMediaLoadError(httpErr, {
    serverUrl: 'http://192.168.1.11:8080',
    endpoint: 'http://192.168.1.11:8080/api/media',
    pageProtocol: 'http:',
    isDesktop: false,
  });
  assert.equal(http.kind, 'http');
  assert.match(http.message, /HTTP 503/);
  assert.equal(http.httpSwitchUrl, null);

  const network = classifyMediaLoadError(new TypeError('Failed to fetch'), {
    serverUrl: 'http://192.168.1.11:8080',
    endpoint: 'http://192.168.1.11:8080/api/media',
    pageProtocol: 'http:',
    isDesktop: false,
  });
  assert.equal(network.kind, 'network');
  assert.match(network.message, /Could not reach/);
  assert.match(network.message, /CORS/);
  assert.equal(network.httpSwitchUrl, null);
});
