# Servidor Railway (puente) — App Fichas

La app envía las fichas a Railway y Railway las reenvía al Web App de Google
Apps Script de siempre. **Las fichas, las fotos y las hojas siguen en Google
Drive / Sheets.** Aquí no se guarda nada.

```
App Fichas  →  Railway (server.js)  →  Apps Script (Code.gs)  →  Sheets / Drive
```

## Archivos

| Archivo | Para qué |
|---|---|
| `server.js` | El puente (sin librerías externas, Node 20 o más) |
| `package.json` | Le dice a Railway que es Node y cómo arrancar (`npm start`) |
| `railway.json` | Arranque y comprobación de salud (`/salud`) |
| `.gitignore` | Deja fuera `node_modules/` y `.env` |

## Rutas

| Ruta | Qué hace |
|---|---|
| `POST /` | Reenvía el JSON a Apps Script y devuelve su respuesta |
| `GET /?estado=1` | Comprobación de Apps Script (`Servicio de encuestas activo.`) |
| `GET /salud` | Comprobación de Railway, sin llamar a Apps Script |
| `GET /` o `/panel` | Lleva al panel web de Apps Script |

## Variables (Railway → servicio → Variables)

| Variable | Valor |
|---|---|
| `APPS_SCRIPT_URL` | URL del Web App, la que termina en `/exec` (la misma de `mi_app/lib/config.dart`) |
| `TOKEN_SECRETO` | El mismo token de `mi_app/lib/config.dart` |
| `LIMITE_MB` | Opcional. Tamaño máximo de una ficha con fotos (por defecto `50`) |
| `ESPERA_SEGUNDOS` | Opcional. Cuánto esperar a Apps Script (por defecto `330`) |

`PORT` la pone Railway. **Nunca escribir la URL ni el token en el código.**

## Desplegar

1. railway.app → **New Project** → **Deploy from GitHub repo**.
2. **Configure GitHub App** → **Only select repositories** → `APK-FOTOS` → Install & Authorize.
3. Elegir `APK-FOTOS`. Si este contenido está en la raíz del repositorio no hay que configurar carpeta.
4. **Variables** → agregar `APPS_SCRIPT_URL` y `TOKEN_SECRETO`.
5. **Settings → Networking → Generate Domain** → queda `https://<nombre>.up.railway.app`.
6. Comprobar en el navegador:
   - `https://<nombre>.up.railway.app/salud` → `Servidor Railway activo.`
   - `https://<nombre>.up.railway.app/?estado=1` → `Servicio de encuestas activo.`

## Pasar la app a Railway

1. `mi_app/lib/config.dart` → `webAppUrl` = `https://<nombre>.up.railway.app/`
2. `mi_app/pubspec.yaml` → subir la versión (p. ej. `1.15.0+20`).
3. `flutter build apk --release` e instalar **encima** (sin desinstalar).

La app no necesita otro cambio: Railway responde directamente con el JSON
(sin la redirección 302 de Apps Script, que la app igual sabe seguir).

Los celulares con la versión anterior siguen enviando directo a Apps Script:
**no apagar ni cambiar la implementación de Apps Script.** Al publicar cambios
de `Code.gs`, siempre *Gestionar implementaciones → ✏️ → Nueva versión* para
que la URL `/exec` no cambie.

## Probar en la PC

```powershell
$env:APPS_SCRIPT_URL = "https://script.google.com/macros/s/<ID>/exec"
$env:TOKEN_SECRETO = "<token>"
npm start
```

Luego abrir `http://localhost:3000/salud`.

## Registros

Railway → servicio → **Deployments → View logs**. Cada petición deja una línea
con la acción, el tamaño, el tiempo y el resultado (sin respuestas ni datos
personales), por ejemplo:

```
2026-11-18T22:37:27.157Z guardarFicha 2350 KB 4120 ms apps-script 200
```
