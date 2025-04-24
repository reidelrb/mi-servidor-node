const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8000;
const server = http.createServer((req, res) => {
    // Servir archivos estáticos (GET)
    if (req.method === 'GET') {
        let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
        
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404);
                return res.end('Archivo no encontrado');
            }
            res.writeHead(200);
            res.end(data);
        });
    }
    
    // Reemplazar archivos (POST)
    else if (req.method === 'POST') {
        const filePath = path.join(__dirname, req.url);
        
        // Validaciones básicas
        if (req.url.includes('../') || req.url === '/') {
            res.writeHead(400);
            return res.end('Ruta inválida');
        }

        const writeStream = fs.createWriteStream(filePath);
        req.pipe(writeStream);
        
        writeStream.on('finish', () => {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end(`Archivo \${req.url} actualizado`);
        });
        
        writeStream.on('error', (err) => {
            res.writeHead(500);
            res.end(`Error al guardar: \${err.message}`);
        });
    }
});

server.listen(PORT, () => {
    console.log(`✅ Servidor activo en http://localhost:${PORT}`);
    console.log(`📂 Directorio actual: ${__dirname}`);
    console.log('POST: Envía archivos para reemplazar los existentes');
});
