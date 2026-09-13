/**
 * A throwaway TLS terminator, for verifying auth the way it is actually
 * deployed. Development only — never run this in front of anything real.
 *
 *   node scripts/tls-proxy.js <cert.pem> <key.pem> <listen-port> <origin-port>
 *
 * WHY IT EXISTS
 *
 * In production the API sets its session cookies `Secure; SameSite=None`, so a
 * browser silently discards them over plain HTTP. Login returns 200, the next
 * request 401s, and nothing in any log says why — the first item in
 * RUNBOOK.md §1 is there because of this failure mode.
 *
 * That behaviour is unverifiable over http://localhost, which is exactly where
 * every local check runs. `kubectl apply` is not a test, and "we set the flag
 * in the ingress" is not evidence. This puts real TLS in front of the
 * containerised API so the property can be asserted, not assumed.
 *
 * It also sets `X-Forwarded-Proto: https`, which is what a real ingress sends
 * and what `app.set('trust proxy', 1)` in src/app.ts exists to consume.
 */
const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');

const [certPath, keyPath, listenPort, originPort] = process.argv.slice(2);

if (!certPath || !keyPath || !listenPort || !originPort) {
  console.error('usage: tls-proxy.js <cert.pem> <key.pem> <listen-port> <origin-port>');
  process.exit(1);
}

const server = https.createServer(
  { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) },
  (req, res) => {
    const upstream = http.request(
      {
        host: '127.0.0.1',
        port: Number(originPort),
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          // The two headers a TLS-terminating proxy owes the app behind it.
          // Without the first, an app that decides anything on req.protocol
          // believes every request arrived over plain HTTP.
          'x-forwarded-proto': 'https',
          'x-forwarded-for': req.socket.remoteAddress,
        },
      },
      (upstreamRes) => {
        // Headers are copied verbatim, Set-Cookie included. Rewriting cookie
        // attributes here would invalidate the whole exercise: the point is to
        // observe what the application actually sends.
        res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
        upstreamRes.pipe(res);
      }
    );

    upstream.on('error', (error) => {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`upstream error: ${error.message}`);
    });

    req.pipe(upstream);
  }
);

server.listen(Number(listenPort), () => {
  console.log(`tls-proxy listening on https://localhost:${listenPort} -> :${originPort}`);
});
