const fs = require('fs');
const http = require('http');
const path = require('path');
const { execSync } = require('child_process');

const PORT = 8000;

// Función para obtener el directorio base correcto
function getBaseDirectory() {
  return process.pkg 
    ? path.dirname(process.execPath)
    : __dirname;
}

// Función para manejar la carpeta sys comprimida
function ensureSysDirectory() {
  const baseDir = getBaseDirectory();
  const sysZipPath = path.join(baseDir, 'sys.zip');
  const sysDirPath = path.join(baseDir, 'sys');
  
  if (fs.existsSync(sysZipPath)) {
    try {
      if (fs.existsSync(sysDirPath)) {
        fs.rmSync(sysDirPath, { recursive: true, force: true });
      }
      
      fs.mkdirSync(sysDirPath);
      
      console.log('Descomprimiendo sys.zip...');
      if (process.platform === 'win32') {
        execSync(`powershell -command "Expand-Archive -Path '${sysZipPath}' -DestinationPath '${baseDir}'"`);
      } else {
        execSync(`unzip -o '${sysZipPath}' -d '${baseDir}'`);
      }
      
      fs.unlinkSync(sysZipPath);
      console.log('sys.zip descomprimido y eliminado');
      
    } catch (err) {
      console.error('Error al procesar sys.zip:', err);
    }
  }
  
  if (!fs.existsSync(sysDirPath)) {
    fs.mkdirSync(sysDirPath);
  }
}

// Verificar/crear la carpeta sys al iniciar
ensureSysDirectory();

// Cargar datos iniciales
const dataFile = path.join(getBaseDirectory(), 'data.json');
let database = {};
try {
  database = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
} catch (err) {
  database = { personal: [] };
}

function decodeCI(ci) {
  if (!/^\d{11}$/.test(ci)) return {};
  const day = ci.substr(4, 2), month = ci.substr(2, 2), yy = ci.substr(0, 2);
  const fullYear = (parseInt(yy) <= new Date().getFullYear() % 100) ? 2000 + parseInt(yy) : 1900 + parseInt(yy);
  const nacido = `${day}/${month}/${fullYear}`;

  // Cálculo exacto de la edad (verificando si ya pasó el cumpleaños este año)
  const today = new Date();
  const nacidoThisYear = new Date(today.getFullYear(),parseInt(month) - 1,parseInt(day));
  const edad = (today.getFullYear() - fullYear - (today < nacidoThisYear ? 1 : 0)).toString();

  // Género basado en el dígito 10 (posición 9)
  const sexo = parseInt(ci[9]) % 2 === 0 ? "M" : "F";
  return {nacido,edad,sexo}
}

const db = (() => {
  const match = (obj, criteria) => {
    for (const key in criteria) {
      const val = criteria[key];
      
      if (val && typeof val === 'object') {
        // Manejar operadores especiales
        if ('$menor' in val && !(obj[key] <= val.$menor)) return false;
        if ('$mayor' in val && !(obj[key] >= val.$mayor)) return false;
        // ... otros operadores que necesites
      }
      else if (typeof val === 'string' && typeof obj[key] === 'string') {
        if (!obj[key].toLowerCase().includes(val.toLowerCase())) return false;
      }
      else {
        if (obj[key] !== val) return false;
      }
    }
    return true;
  };

  return {
    find(criteria) {
      return database.personal.filter(obj => match(obj, criteria));
    },
    add(data) {
      database.personal.push(data);
      fs.writeFileSync(dataFile, JSON.stringify(database, null, 2));
      return data;
    },
    update(criteria, newData) {
      const found = database.personal.find(obj => match(obj, criteria));
      if (found) Object.assign(found, newData);
      fs.writeFileSync(dataFile, JSON.stringify(database, null, 2));
      return found || null;
    },
    move(criteria, newIndex) {
      if (typeof newIndex !== 'number' || newIndex < 0 || newIndex >= database.personal.length) {
        return null
      }
      const currentIndex = database.personal.findIndex(obj => match(obj, criteria));
      if (currentIndex === -1) return null; // No se encontró el elemento
      if (currentIndex === newIndex) return database.personal[newIndex];
      const [element] = database.personal.splice(currentIndex, 1);
      database.personal.splice(newIndex, 0, element);
      fs.writeFileSync(dataFile, JSON.stringify(database, null, 2));
      return element;
    }
  };
})();

const server = http.createServer((req, res) => {
    // Configurar headers CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Manejar solicitud OPTIONS (preflight)
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }
    
    // Servir archivos estáticos (GET)
    if (req.method === 'GET') {
        if(req.url=='/ip') return res.end( getLocalIp() );
        if(req.url=='/reload') {
          database = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
          database.personal = database.personal.map(e=>{return Object.assign(e,decodeCI(e.ci||''))})
          req.url = '/'
        }
    
        let filePath = path.join(getBaseDirectory(), (req.url == '/data.json' ? '' : 'sys'), req.url === '/' ? 'index.html' : req.url);
        
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404);
                return res.end();
            }
            res.writeHead(200);
            res.end(data);
        });
        return;
    }
    
    // Manejar operaciones con archivos (POST, PUT, DELETE)
    if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
        if (req.url == '/curl') {
            let body = '';
            req.on('data', chunk => { 
                body += chunk.toString();
            });
            req.on('end', () => {
                try {
                    body = JSON.parse(body);
                    let curl = {};
                    if (body.add) curl = db.add(body.add || {});
                    if (body.find) curl = db.find(body.find);
                    if (body.update) curl = db.update(body.update, body.data || {});
                    if (body.move) curl = db.move(body.move, body.index);

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(curl));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({error:'Error en la operación'}));
                }
            });
            return;
        }
        
        // Manejar escritura de archivos
        const filePath = path.join(getBaseDirectory(), req.url);
        
        if (req.method === 'DELETE') {
            try {
                fs.unlinkSync(filePath);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ok:'eliminado'}));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({error:''}));
            }
            return;
        }






const writeStream = fs.createWriteStream('imagen_recibida.jpg', { flags: 'wx' });
        
        // Pipe directo del request al archivo (más eficiente)
        req.pipe(writeStream);
        
        writeStream.on('finish', () => {
            console.log('Imagen guardada correctamente');
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Imagen recibida y guardada con éxito');
        });
        
        writeStream.on('error', (err) => {
            console.error('Error al guardar:', err);
            if (err.code === 'EEXIST') {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('El archivo ya existe');
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Error al guardar la imagen');
            }
        });
        
        req.on('error', (err) => {
            console.error('Error en el request:', err);
            writeStream.destroy();
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error al recibir la imagen');
        });
        
        
    
    }
});

server.listen(PORT, '0.0.0.0', () => console.log(`● server [reidel${__dirname}]\n● http://localhost:${PORT}\n● http://${getLocalIp()}:${PORT}`));

function getLocalIp() {
  const interfaces = require('os').networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}
