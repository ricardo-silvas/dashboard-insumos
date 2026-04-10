/**
 * Servidor local para o Dashboard de Insumos Fortpel
 * Roda na porta 3000: http://localhost:3000
 * Permite que os arquivos Excel sejam lidos automaticamente pelo dashboard.
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 3000;
const ROOT = __dirname;

const MIME = {
    '.html' : 'text/html; charset=utf-8',
    '.js'   : 'application/javascript; charset=utf-8',
    '.css'  : 'text/css; charset=utf-8',
    '.json' : 'application/json',
    '.png'  : 'image/png',
    '.jpg'  : 'image/jpeg',
    '.xls'  : 'application/vnd.ms-excel',
    '.xlsx' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ico'  : 'image/x-icon',
};

const server = http.createServer((req, res) => {
    // Remove query strings and decode URI
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';

    const filePath = path.join(ROOT, urlPath);

    // Security: prevent path traversal outside ROOT
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403); res.end('Forbidden'); return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end(`Arquivo não encontrado: ${urlPath}`);
            return;
        }
        const ext  = path.extname(filePath).toLowerCase();
        const mime = MIME[ext] || 'application/octet-stream';

        res.writeHead(200, {
            'Content-Type'                : mime,
            'Access-Control-Allow-Origin' : '*',
            'Cache-Control'               : 'no-cache',
        });
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log('');
    console.log('  ✅  Dashboard de Insumos rodando!');
    console.log(`  🌐  Acesse: http://localhost:${PORT}`);
    console.log('');
    console.log('  Pressione Ctrl+C para parar o servidor.');
    console.log('');
});
