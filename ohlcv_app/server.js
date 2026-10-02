const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const FRONTEND_DIR = path.join(__dirname, '../'); // serve E:\github\ohlcv
const DATA_DIR = path.join(__dirname, '../data/market/nse/mstock');

const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.csv': 'text/csv'
};

const server = http.createServer((req, res) => {
    // API Route for Data
    if (req.url.startsWith('/api/data')) {
        const urlParams = new URLSearchParams(req.url.split('?')[1]);
        const ticker = urlParams.get('ticker');
        
        if (!ticker) {
            res.writeHead(400);
            return res.end('Missing ticker parameter');
        }

        const csvPath = path.join(DATA_DIR, `${ticker}.csv`);
        
        fs.readFile(csvPath, 'utf8', (err, data) => {
            if (err) {
                console.error(`Error reading ${csvPath}:`, err.message);
                res.writeHead(404);
                return res.end('Data not found');
            }
            res.writeHead(200, { 'Content-Type': 'text/csv' });
            res.end(data);
        });
        return;
    }

    // Workspace API Routes
    if (req.url.startsWith('/api/workspaces')) {
        const urlParams = new URLSearchParams(req.url.split('?')[1]);
        const workspaceName = urlParams.get('name');
        const workspacesDir = path.join(FRONTEND_DIR, 'workspaces');
        
        if (!fs.existsSync(workspacesDir)) {
            fs.mkdirSync(workspacesDir);
        }

        if (req.method === 'GET') {
            if (workspaceName) {
                // Get specific workspace
                const filePath = path.join(workspacesDir, `${workspaceName}.json`);
                if (fs.existsSync(filePath)) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(fs.readFileSync(filePath));
                } else {
                    if (workspaceName === 'autosave') {
                        // Return default state silently to avoid 404s on first boot
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ timeframes: {}, stocks: ['BANKBEES'], derivatives: [], lookbacks: {} }));
                    } else {
                        res.writeHead(404);
                        res.end(JSON.stringify({ error: 'Workspace not found' }));
                    }
                }
            } else {
                // List all workspaces
                const files = fs.readdirSync(workspacesDir).filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(files));
            }
        } else if (req.method === 'POST') {
            if (!workspaceName) {
                res.writeHead(400);
                return res.end('Missing name parameter');
            }
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', () => {
                fs.writeFileSync(path.join(workspacesDir, `${workspaceName}.json`), body);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            });
        } else if (req.method === 'DELETE') {
            if (!workspaceName) {
                res.writeHead(400);
                return res.end('Missing name parameter');
            }
            const filePath = path.join(workspacesDir, `${workspaceName}.json`);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        }
        return;
    }

    // Static File Server
    const cleanUrl = req.url.split('?')[0];
    let filePath = path.join(FRONTEND_DIR, cleanUrl === '/' ? 'ohlcv_app/index.html' : cleanUrl);
    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('File not found');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/ohlcv_app/index.html`);
});
