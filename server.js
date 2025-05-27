require('dotenv').config();
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const PORT = 8000;

if (!fs.existsSync(path.join(__dirname, '.data'))) fs.mkdirSync(path.join(__dirname, '.data'));
if (!fs.existsSync(path.join(__dirname, '.data', 'uploads'))) fs.mkdirSync(path.join(__dirname, '.data', 'uploads'));

let database = [];
try {
  database = JSON.parse(fs.readFileSync(path.join(__dirname, '.data', 'data.json'), 'utf8'));
} catch (err) {
  console.log('Sin db')
}

const saveDb = () => {
  fs.writeFileSync(path.join(__dirname, '.data', 'data.json'), JSON.stringify(database, null, 2))
}

const outData = (o) => {
  function agg(i) {
    return Object.assign({}, i, { img: (fs.existsSync(path.join(__dirname, `.data/uploads/${i.id}.jpg`))) ? !0 : undefined }, { time: Date.now() - i.time })
  }
  if (!o.length) {
    if (o.error && o.error == 404) return null;
    return agg(o)
  }
  return o.map(i => agg(i))
}

const TOKEN = process.env.TOKEN;
const apiUrl = `https://api.telegram.org/bot${TOKEN}`;

function Telegram(method, data, callback) {
  const options = {
    hostname: 'api.telegram.org',
    path: `/bot${TOKEN}/${method}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    }
  };
  const req = https.request(options, (res) => {
    let responseData = '';
    res.on('data', (chunk) => {
      responseData += chunk;
    });
    res.on('end', () => {
      try {
        const parsedData = JSON.parse(responseData);
        callback(null, parsedData);
      } catch (error) {
        callback(error);
      }
    });
  });
  req.on('error', (error) => {
    callback(error);
  });
  req.write(JSON.stringify(data));
  req.end();
}
function msg(){
  Telegram('sendMessage', { chat_id: 6526862605, text: 'hola' }, (e, d) => {console.log({e,d})})
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return
  }

  if (req.method === 'GET') {
    fs.readFile(path.join(__dirname, '.data', req.url === '/' ? 'index.html' : req.url.split('?')[0]), (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200);
      res.end(data);
    });
    return;
  }

  if (['POST'].includes(req.method)) {    
    if (req.url == '/') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString() });
      req.on('end', () => {
        try {
          body = JSON.parse(body);
          let curl = [null];
          if (body.fileData) {
            try {
              const base64Data = body.fileData.data.replace(/^data:image\/\w+;base64,/, '').replace(/^data:text\/\w+;base64,/, '');
              const buffer = Buffer.from(base64Data, 'base64');
              try {
                fs.writeFileSync(path.join(__dirname, '.data', body.fileData.name), buffer);
                curl = { upload: 200 };
              } catch (err) {
                curl = { upload: 500 };
              }
            } catch (e) {
              curl = { upload: 500 }
            }
          }

          if (body.all) {
            curl = database
          } else if (body.add) {
            Object.assign(body.add, { time: Date.now() })
            database.push(body.add);
            saveDb()
            if (body.add.id) {
              console.log('avatar de telegram...')
              Telegram('getUserProfilePhotos', { user_id: body.add.id }, (e, d) => {
                if (e) {
                  res.end(JSON.stringify(outData(body.add)));
                  console.log('error al cargar avatar');
                } else {
                  if (d.result && d.result.total_count > 0) {
                    Telegram('getFile', { file_id: d.result.photos[0][0].file_id }, (err, file) => {
                      if (err) {
                        res.end(JSON.stringify(outData(body.add)));
                      } else {
                        if (!file.ok) {
                          res.end(JSON.stringify(outData(body.add)));
                        } else {
                          const downloadUrl = `https://api.telegram.org/file/bot${TOKEN}/${file.result.file_path}`;
                          const filePath = path.join(__dirname, '.data', 'uploads', body.add.id + '.jpg');
                          const foto = fs.createWriteStream(filePath);

                          https.get(downloadUrl, (response) => {
                            response.pipe(foto);

                            foto.on('finish', () => {
                              foto.close();
                              console.log('avatar telegram cargado')
                              res.end(JSON.stringify(outData(body.add)));
                            });
                          }).on('error', (err) => {
                            fs.unlink(filePath, () => { });
                            res.end(JSON.stringify(outData(body.add)));
                          });
                        }
                      }
                    })
                  } else {
                    res.end(JSON.stringify(outData(body.add)));
                  }
                }
              })
              return;
            }
            curl = body.add
          } else if (body.delete) {
            database = database.filter(s => s.id != body.delete)
            saveDb()
            curl = database
          } else if (body.find) {
            const key = Object.keys(body.find)[0]
            curl = database.filter(s => s[key] && s[key] == body.find[key])
          } else if (body.update) {
            const key = Object.keys(body.update)[0]
            const found = database.filter(s => s[key] && s[key] == body.update[key])
            saveDb()
            if (found && found[0] && body.data) {
              Object.assign(found[0], body.data, { time: Date.now() })
            }
            curl = found[0] || { error: 404 }
          } else if (body.telegramChat) {
            Telegram('sendMessage', { chat_id: body.telegramChat.userid, text: `${body.telegramChat.text}` }, (e, d) => {
              if (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: e }));
              }
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ send: d }));
            })
            return;
          }else if (body.sendPhoto) {
            Telegram( "sendPhoto", {
              chat_id: body.sendPhoto.userid,
              photo: body.sendPhoto.url,
              caption: body.sendPhoto.text,
            },(error, ok) => {
              res.end(JSON.stringify({error,ok }))
            });
            return;
          }
          const data = outData(curl)
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Error en la operación: ' + e }));
        }
      });
      return;
    }
  }
});


(function autoPing() {
  console.log('Auto ping cada 2 minutos')
  const https = require('https');
  const PING_INTERVAL = 60000 * 2; // 2 minutos
  const PING_URL = `https://${process.env.PROJECT_DOMAIN}.glitch.me/uploads/default.jpg`;
  const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

  const ping = () => {
    const options = {
      headers: { 'User-Agent': USER_AGENT } // Simula un navegador real
    };
    https.get(PING_URL, options, (res) => {
      console.log(`[AutoPing] ✅ Ping exitoso (Status: ${res.statusCode})`);
    }).on('error', (err) => {
      console.log(`[AutoPing] ❌ Error: ${err.message}`);
    });
  };
  if (process.env.PROJECT_DOMAIN) {
    ping();
    setInterval(ping, PING_INTERVAL);
  }
})();

server.listen(PORT, '8000', () => console.log(`●${__dirname}:${PORT}\n`));
