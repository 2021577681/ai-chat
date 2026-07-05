const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.argv[2] || process.env.PORT || 4173);
const root = path.resolve(__dirname, '..', '..');

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav'
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function requestPath(reqUrl) {
  const url = new URL(reqUrl, `http://127.0.0.1:${port}`);
  const decoded = decodeURIComponent(url.pathname);
  const normalized = path.normalize(decoded).replace(/^([/\\])+/, '');
  const target = path.resolve(root, normalized || 'AI-Chat-大模型对话助手.html');
  if (!target.startsWith(root + path.sep) && target !== root) return null;
  return target;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method Not Allowed', { 'content-type': 'text/plain' });
    return;
  }

  const filePath = requestPath(req.url);
  if (!filePath) {
    send(res, 403, 'Forbidden', { 'content-type': 'text/plain' });
    return;
  }

  fs.stat(filePath, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      send(res, 404, 'Not Found', { 'content-type': 'text/plain' });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'content-type': contentTypes[ext] || 'application/octet-stream',
      'content-length': stat.size
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(port, '127.0.0.1');

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
