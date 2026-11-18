/**
 * ============================================================================
 *  SERVIDOR RAILWAY - Puente hacia el Web App de Google Apps Script
 * ============================================================================
 *  La app Fichas envía aquí lo mismo que antes enviaba a Apps Script, y este
 *  servidor lo reenvía tal cual. Apps Script sigue haciendo todo el trabajo
 *  (fichas, fotos en Drive, hojas en Sheets, usuarios, panel, PDF y Excel):
 *  aquí no se guarda nada.
 *
 *    App  →  Railway (este archivo)  →  Apps Script  →  Sheets / Drive
 *
 *  Rutas:
 *    POST /            → reenvía el JSON a Apps Script y devuelve su respuesta
 *    GET  /?estado=1   → comprobación del servicio (la de Apps Script)
 *    GET  /salud       → comprobación de Railway (sin llamar a Apps Script)
 *    GET  /            → lleva al panel web (el de Apps Script)
 *
 *  Configuración (Railway → Variables):
 *    APPS_SCRIPT_URL   URL del Web App, la que termina en /exec   (obligatoria)
 *    TOKEN_SECRETO     el mismo token de la app; si está, se rechaza aquí lo
 *                      que no lo traiga, sin gastar cuota de Apps Script
 *    LIMITE_MB         tamaño máximo de una petición (por defecto 50)
 *    ESPERA_SEGUNDOS   cuánto esperar a Apps Script (por defecto 330)
 *    PORT              lo pone Railway
 * ============================================================================
 */

'use strict';

const http = require('http');

const APPS_SCRIPT_URL = (process.env.APPS_SCRIPT_URL || '').trim();
const TOKEN_SECRETO = (process.env.TOKEN_SECRETO || '').trim();
const LIMITE_BYTES = Number(process.env.LIMITE_MB || 50) * 1024 * 1024;
const ESPERA_MS = Number(process.env.ESPERA_SEGUNDOS || 330) * 1000;
const PUERTO = Number(process.env.PORT || 3000);

if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(APPS_SCRIPT_URL)) {
  console.error('Falta APPS_SCRIPT_URL (o no es la URL /exec de un Web App de Apps Script).');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function responder(res, estado, cuerpo, tipo) {
  res.writeHead(estado, {
    'Content-Type': tipo || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo));
}

/** Lee el cuerpo completo; corta si pasa del límite. */
function leerCuerpo(req) {
  return new Promise(function (resolver, rechazar) {
    const partes = [];
    let total = 0;
    req.on('data', function (trozo) {
      total += trozo.length;
      if (total > LIMITE_BYTES) {
        rechazar(Object.assign(new Error('La petición pasa de ' + LIMITE_BYTES / 1048576 + ' MB.'), { estado: 413 }));
        req.destroy();
        return;
      }
      partes.push(trozo);
    });
    req.on('end', function () { resolver(Buffer.concat(partes)); });
    req.on('error', rechazar);
  });
}

/**
 * Apps Script procesa el POST y responde con un 302 hacia
 * script.googleusercontent.com, donde está el resultado: se lee con un GET
 * (igual que hacía la app). El POST no se repite.
 */
async function reenviarPost(cuerpo) {
  const senal = AbortSignal.timeout(ESPERA_MS);
  let r = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: cuerpo,
    redirect: 'manual',
    signal: senal,
  });
  const destino = r.headers.get('location');
  if ((r.status === 302 || r.status === 303) && destino) {
    r = await fetch(destino, { redirect: 'follow', signal: senal });
  }
  return { estado: r.status, tipo: r.headers.get('content-type'), texto: await r.text() };
}

function registrar(accion, bytes, inicio, resultado) {
  // Solo datos técnicos: nada de respuestas, usuarios ni fotos.
  console.log(new Date().toISOString() + ' ' + accion + ' ' + Math.round(bytes / 1024) + ' KB ' +
    (Date.now() - inicio) + ' ms ' + resultado);
}

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

async function atenderPost(req, res) {
  const inicio = Date.now();
  let accion = '?';
  let cuerpo = Buffer.alloc(0);
  try {
    cuerpo = await leerCuerpo(req);

    let json;
    try {
      json = JSON.parse(cuerpo.toString('utf8'));
    } catch (_) {
      registrar(accion, cuerpo.length, inicio, 'json-invalido');
      return responder(res, 200, { ok: false, error: 'El cuerpo de la petición no es un JSON válido.' });
    }
    accion = String((json && json.accion) || 'guardarFicha');
    if (TOKEN_SECRETO && (!json || json.token !== TOKEN_SECRETO)) {
      registrar(accion, cuerpo.length, inicio, 'no-autorizado');
      return responder(res, 200, { ok: false, error: 'No autorizado.' });
    }

    const r = await reenviarPost(cuerpo);
    registrar(accion, cuerpo.length, inicio, 'apps-script ' + r.estado);
    return responder(res, r.estado, r.texto, r.tipo);
  } catch (err) {
    if (err && err.estado === 413) {
      registrar(accion, cuerpo.length, inicio, 'muy-grande');
      return responder(res, 413, { ok: false, error: err.message });
    }
    // Sin respuesta de Apps Script: la app lo toma como error y la ficha sigue
    // pendiente. Si Apps Script sí llegó a guardarla, el reintento no la
    // duplica (mismo idEnvio).
    const espera = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    registrar(accion, cuerpo.length, inicio, espera ? 'sin-respuesta' : 'error ' + (err && err.message));
    return responder(res, 502, {
      ok: false,
      error: espera ? 'Apps Script tardó demasiado en responder.' : 'No se pudo conectar con Apps Script.',
    });
  }
}

async function atenderGet(req, res) {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/salud') {
    return responder(res, 200, { ok: true, mensaje: 'Servidor Railway activo.' });
  }

  if (url.pathname === '/' && url.searchParams.has('estado')) {
    try {
      const r = await fetch(APPS_SCRIPT_URL + '?estado=1', { redirect: 'follow', signal: AbortSignal.timeout(30000) });
      return responder(res, r.status, await r.text(), r.headers.get('content-type'));
    } catch (_) {
      return responder(res, 502, { ok: false, error: 'No se pudo conectar con Apps Script.' });
    }
  }

  if (url.pathname === '/' || url.pathname === '/panel') {
    // El panel sigue en Apps Script (inicia sesión con Google allí).
    res.writeHead(302, { Location: APPS_SCRIPT_URL, 'Cache-Control': 'no-store' });
    return res.end();
  }

  return responder(res, 404, { ok: false, error: 'No existe esa ruta.' });
}

const servidor = http.createServer(function (req, res) {
  const fallo = function (err) {
    console.error(err);
    if (!res.headersSent) responder(res, 500, { ok: false, error: 'Error interno del servidor Railway.' });
  };
  if (req.method === 'POST') return atenderPost(req, res).catch(fallo);
  if (req.method === 'GET' || req.method === 'HEAD') return atenderGet(req, res).catch(fallo);
  responder(res, 405, { ok: false, error: 'Método no permitido.' });
});

// Las fichas con fotos pueden tardar: no cortar la conexión antes que Apps Script.
servidor.requestTimeout = ESPERA_MS + 30000;
servidor.headersTimeout = 60000;

servidor.listen(PUERTO, function () {
  console.log('Servidor Railway escuchando en el puerto ' + PUERTO + ' -> Apps Script');
});
