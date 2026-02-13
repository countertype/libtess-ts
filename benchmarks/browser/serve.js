import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT = path.join(__dirname, '../..');

const PORT = 8080;

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.map': 'application/json',
};

http.createServer((req, res) => {
  let filePath;

  if (req.url === '/' || req.url === '/index.html') {
    filePath = path.join(__dirname, 'index.html');
  } else if (req.url.startsWith('/dist/')) {
    filePath = path.join(PROJECT, req.url);
  } else if (req.url === '/libtess.min.js') {
    filePath = path.join(PROJECT, 'node_modules/libtess/libtess.min.js');
  } else if (req.url === '/tess2.js') {
    // Wrap CJS module for browser use
    const src = fs.readFileSync(path.join(PROJECT, 'node_modules/tess2/src/tess2.js'), 'utf-8');
    const wrapped = src.replace('module.exports = Tess2;', 'window.Tess2 = Tess2;');
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(wrapped, 'utf-8');
    return;
  } else {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500);
      res.end(err.code === 'ENOENT' ? `Not found: ${req.url}` : `Error: ${err.code}`);
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
}).listen(PORT, () => {
  console.log(`Browser benchmark at http://localhost:${PORT}/`);
});
