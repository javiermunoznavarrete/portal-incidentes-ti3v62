'use strict';
// Portal de Gestión de Incidentes de Seguridad — servidor HTTP sin framework.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { crearPool, inicializar } = require('./db');
const { ROLES, PERMISOS, tienePermiso } = require('./rbac');
const seg = require('./seguridad');
const firebase = require('./firebase');

// ---------------------------------------------------------------- configuración
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const COOKIE_SECURE = process.env.COOKIE_SECURE !== 'false';
const SESSION_MIN = Number(process.env.SESSION_MINUTES || 30);
const MAX_INTENTOS = 5;
const BLOQUEO_MIN = 15;
const INSTANCIA = process.env.RAILWAY_REPLICA_ID
  ? `replica-${process.env.RAILWAY_REPLICA_ID.slice(0, 8)}`
  : (process.env.INSTANCE_NAME || os.hostname());

if (!DATABASE_URL) { console.error('DATABASE_URL no definida'); process.exit(1); }
if (SESSION_SECRET.length < 32) { console.error('SESSION_SECRET debe tener al menos 32 caracteres'); process.exit(1); }

const pool = crearPool(DATABASE_URL);
// Modo de autenticación: 'firebase' (contraseña + TOTP vía Firebase Identity Platform) o 'local' (solo contraseña).
const FB = firebase.iniciar();
const MODO_AUTH = FB ? 'firebase' : 'local';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// ---------------------------------------------------------------- logging estructurado (JSON por línea)
function log(level, evento, datos = {}) {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, evento, instancia: INSTANCIA, ...datos }) + '\n');
}

async function auditar(evento, req, detalle = '') {
  const u = req.usuario || {};
  log(evento.includes('denegado') || evento.includes('fallido') || evento.includes('bloqueada') ? 'warn' : 'info',
    evento, { usuario: u.email, rol: u.rol, ip: req.ip, detalle });
  try {
    await pool.query(
      'INSERT INTO auditoria (evento, usuario_id, email, rol, ip, detalle, instancia) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [evento, u.id || null, u.email || null, u.rol || null, req.ip, String(detalle).slice(0, 500), INSTANCIA],
    );
  } catch (e) {
    log('error', 'auditoria_error', { error: e.message });
  }
}

// ---------------------------------------------------------------- utilidades HTTP
const CABECERAS_SEGURIDAD = {
  // En modo Firebase se permite solo el SDK oficial (gstatic) y las APIs de autenticación de Google.
  'Content-Security-Policy': FB
    ? "default-src 'self'; script-src 'self' https://www.gstatic.com; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; style-src 'self'; img-src 'self' data:; frame-src https://" + (FB.web.authDomain || 'firebaseapp.com') + "; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    : "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

function enviar(res, status, cuerpo, extra = {}) {
  const data = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
  res.writeHead(status, {
    ...CABECERAS_SEGURIDAD,
    'Content-Type': typeof cuerpo === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Served-By': INSTANCIA,
    ...extra,
  });
  res.end(data);
}

function leerJson(req, limite = 10 * 1024) {
  return new Promise((resolve, reject) => {
    let tam = 0;
    const partes = [];
    req.on('data', (c) => {
      tam += c.length;
      if (tam > limite) { reject(Object.assign(new Error('Cuerpo demasiado grande'), { status: 413 })); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => {
      if (!partes.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(partes).toString('utf8'))); }
      catch { reject(Object.assign(new Error('JSON inválido'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function leerCookie(req, nombre) {
  const raw = req.headers.cookie || '';
  for (const parte of raw.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nombre) return decodeURIComponent(v.join('='));
  }
  return null;
}

function cookieSesion(valor, maxAgeSeg) {
  return `sid=${valor}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAgeSeg}${COOKIE_SECURE ? '; Secure' : ''}`;
}

function ipCliente(req) {
  const xff = req.headers['x-forwarded-for'];
  return (xff ? String(xff).split(',')[0] : req.socket.remoteAddress || '').trim();
}

function texto(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

// Rate limiting de login por IP (en memoria, por réplica): mitiga fuerza bruta (NIST AC-7).
const intentosIp = new Map();
function limiteLogin(ip) {
  const ahora = Date.now();
  const r = intentosIp.get(ip) || { n: 0, desde: ahora };
  if (ahora - r.desde > 60_000) { r.n = 0; r.desde = ahora; }
  r.n += 1;
  intentosIp.set(ip, r);
  return r.n <= 10;
}
setInterval(() => {
  const ahora = Date.now();
  for (const [ip, r] of intentosIp) if (ahora - r.desde > 60_000) intentosIp.delete(ip);
}, 60_000).unref();

// ---------------------------------------------------------------- autenticación y autorización
function autenticar(req) {
  const p = seg.verificarToken(leerCookie(req, 'sid'), SESSION_SECRET);
  if (p) req.usuario = { id: p.uid, email: p.email, rol: p.rol, nombre: p.nombre };
}

async function exigir(req, res, permiso) {
  if (!req.usuario) { enviar(res, 401, { error: 'No autenticado' }); return false; }
  // Revalida en BD que la cuenta siga activa (revocación inmediata al desactivar un usuario).
  const { rows } = await pool.query('SELECT activo, rol FROM usuarios WHERE id = $1', [req.usuario.id]);
  if (!rows.length || !rows[0].activo || rows[0].rol !== req.usuario.rol) {
    enviar(res, 401, { error: 'Sesión revocada' }, { 'Set-Cookie': cookieSesion('', 0) });
    return false;
  }
  if (permiso && !tienePermiso(req.usuario.rol, permiso)) {
    await auditar('acceso_denegado', req, `${req.method} ${req.url} requiere ${permiso}`);
    enviar(res, 403, { error: 'Acceso denegado: su rol no tiene permiso para esta acción' });
    return false;
  }
  return true;
}

// Protección CSRF: cookie SameSite=Strict + cabecera personalizada obligatoria en peticiones que modifican estado.
function csrfOk(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
  return req.headers['x-requested-with'] === 'fetch';
}

// ---------------------------------------------------------------- handlers
async function login(req, res) {
  if (!limiteLogin(req.ip)) {
    await auditar('login_rate_limit', req);
    return enviar(res, 429, { error: 'Demasiados intentos. Espere un minuto.' });
  }
  const body = await leerJson(req);
  if (MODO_AUTH === 'firebase') return loginFirebase(req, res, body);
  const email = texto(body.email, 200).toLowerCase();
  const password = typeof body.password === 'string' ? body.password.slice(0, 128) : '';
  const { rows } = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
  const u = rows[0];
  const generico = { error: 'Credenciales inválidas' };

  if (!u || !u.activo) {
    await auditar('login_fallido', req, `email=${email} (inexistente o inactivo)`);
    return enviar(res, 401, generico);
  }
  if (u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) {
    await auditar('login_cuenta_bloqueada', req, `email=${email}`);
    return enviar(res, 423, { error: `Cuenta bloqueada temporalmente por intentos fallidos. Intente en ${BLOQUEO_MIN} minutos.` });
  }
  if (!seg.verifyPassword(password, u.password_hash)) {
    const n = u.intentos_fallidos + 1;
    const bloquear = n >= MAX_INTENTOS;
    await pool.query(
      `UPDATE usuarios SET intentos_fallidos = $2, bloqueado_hasta = CASE WHEN $3 THEN now() + interval '${BLOQUEO_MIN} minutes' ELSE NULL END WHERE id = $1`,
      [u.id, bloquear ? 0 : n, bloquear],
    );
    await auditar(bloquear ? 'cuenta_bloqueada' : 'login_fallido', req, `email=${email} intento=${n}`);
    return enviar(res, 401, generico);
  }
  await pool.query('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1', [u.id]);
  await abrirSesion(req, res, u, 'factor=password');
}

async function abrirSesion(req, res, u, detalle) {
  const exp = Date.now() + SESSION_MIN * 60_000;
  const token = seg.firmarToken({ uid: u.id, email: u.email, rol: u.rol, nombre: u.nombre, exp, jti: crypto.randomUUID() }, SESSION_SECRET);
  req.usuario = { id: u.id, email: u.email, rol: u.rol };
  await auditar('login_exitoso', req, detalle);
  enviar(res, 200, { email: u.email, nombre: u.nombre, rol: u.rol }, { 'Set-Cookie': cookieSesion(token, SESSION_MIN * 60) });
}

// Login con Firebase: el navegador ya validó contraseña y TOTP contra Firebase y envía el ID token.
// Se exige el claim sign_in_second_factor (NIST SP 800-63B AAL2 / ISO 27001 A.8.5).
async function loginFirebase(req, res, body) {
  const idToken = typeof body.idToken === 'string' ? body.idToken : '';
  let t;
  try {
    t = await firebase.verificarIdToken(idToken);
  } catch (e) {
    await auditar('login_fallido', req, `token Firebase inválido: ${e.codigo || e.code || e.message}`.slice(0, 200));
    return enviar(res, 401, { error: 'Credenciales inválidas' });
  }
  const { rows } = await pool.query('SELECT * FROM usuarios WHERE email = $1', [t.email]);
  const u = rows[0];
  if (!u || !u.activo) {
    await auditar('login_fallido', req, `email=${t.email} (sin cuenta en el portal o inactiva)`);
    return enviar(res, 401, { error: 'Credenciales inválidas' });
  }
  if (u.firebase_uid && u.firebase_uid !== t.uid) {
    await auditar('login_fallido', req, `email=${t.email} uid de Firebase no coincide`);
    return enviar(res, 401, { error: 'Credenciales inválidas' });
  }
  if (!u.firebase_uid) await pool.query('UPDATE usuarios SET firebase_uid = $2 WHERE id = $1', [u.id, t.uid]);
  if (t.segundoFactor !== 'totp') {
    req.usuario = { id: u.id, email: u.email, rol: u.rol };
    await auditar('login_sin_mfa', req, 'autenticado solo con contraseña: se exige enrolar/usar TOTP');
    return enviar(res, 401, { error: 'Debe usar autenticación de doble factor', codigo: 'mfa_requerido' });
  }
  await abrirSesion(req, res, u, 'factor=password+totp');
}

function config(req, res) {
  enviar(res, 200, { modo: MODO_AUTH, firebase: FB ? FB.web : null });
}

async function logout(req, res) {
  if (req.usuario) await auditar('logout', req);
  enviar(res, 200, { ok: true }, { 'Set-Cookie': cookieSesion('', 0) });
}

async function me(req, res) {
  if (!(await exigir(req, res))) return;
  enviar(res, 200, { ...req.usuario, permisos: PERMISOS[req.usuario.rol], instancia: INSTANCIA, modo: MODO_AUTH });
}

const SEVERIDADES = ['baja', 'media', 'alta', 'critica'];
const ESTADOS = ['abierto', 'en_analisis', 'contenido', 'cerrado'];

async function listarIncidentes(req, res) {
  if (!(await exigir(req, res))) return;
  const todos = tienePermiso(req.usuario.rol, 'incidentes:leer_todos');
  if (!todos && !tienePermiso(req.usuario.rol, 'incidentes:leer_propios')) {
    await auditar('acceso_denegado', req, 'listar incidentes');
    return enviar(res, 403, { error: 'Acceso denegado' });
  }
  const sql = `SELECT i.id, i.titulo, i.descripcion, i.severidad, i.estado, i.creado_en, i.actualizado_en, u.email AS creado_por
               FROM incidentes i JOIN usuarios u ON u.id = i.creado_por
               ${todos ? '' : 'WHERE i.creado_por = $1'} ORDER BY i.id DESC LIMIT 200`;
  const { rows } = await pool.query(sql, todos ? [] : [req.usuario.id]);
  enviar(res, 200, rows);
}

async function crearIncidente(req, res) {
  if (!(await exigir(req, res, 'incidentes:crear'))) return;
  const b = await leerJson(req);
  const titulo = texto(b.titulo, 150);
  const descripcion = texto(b.descripcion, 2000);
  const severidad = SEVERIDADES.includes(b.severidad) ? b.severidad : null;
  if (!titulo || !severidad) return enviar(res, 400, { error: 'Título y severidad válidos son obligatorios' });
  const { rows } = await pool.query(
    'INSERT INTO incidentes (titulo, descripcion, severidad, creado_por) VALUES ($1,$2,$3,$4) RETURNING id',
    [titulo, descripcion, severidad, req.usuario.id],
  );
  await auditar('incidente_creado', req, `id=${rows[0].id} severidad=${severidad}`);
  enviar(res, 201, { id: rows[0].id });
}

async function actualizarIncidente(req, res, id) {
  if (!(await exigir(req, res))) return;
  const puedeTodos = tienePermiso(req.usuario.rol, 'incidentes:actualizar');
  const puedePropios = tienePermiso(req.usuario.rol, 'incidentes:actualizar_propios');
  if (!puedeTodos && !puedePropios) {
    await auditar('acceso_denegado', req, `actualizar incidente ${id}`);
    return enviar(res, 403, { error: 'Acceso denegado: su rol no tiene permiso para esta acción' });
  }
  const b = await leerJson(req);
  const estado = ESTADOS.includes(b.estado) ? b.estado : null;
  if (!estado) return enviar(res, 400, { error: 'Estado inválido' });
  const { rows } = await pool.query('SELECT creado_por FROM incidentes WHERE id = $1', [id]);
  if (!rows.length) return enviar(res, 404, { error: 'No encontrado' });
  if (!puedeTodos && rows[0].creado_por !== req.usuario.id) {
    await auditar('acceso_denegado', req, `actualizar incidente ajeno ${id}`);
    return enviar(res, 403, { error: 'Acceso denegado: solo puede modificar sus propios incidentes' });
  }
  await pool.query('UPDATE incidentes SET estado = $2, actualizado_en = now() WHERE id = $1', [id, estado]);
  await auditar('incidente_actualizado', req, `id=${id} estado=${estado}`);
  enviar(res, 200, { ok: true });
}

async function eliminarIncidente(req, res, id) {
  if (!(await exigir(req, res, 'incidentes:eliminar'))) return;
  const r = await pool.query('DELETE FROM incidentes WHERE id = $1', [id]);
  if (!r.rowCount) return enviar(res, 404, { error: 'No encontrado' });
  await auditar('incidente_eliminado', req, `id=${id}`);
  enviar(res, 200, { ok: true });
}

async function listarUsuarios(req, res) {
  if (!(await exigir(req, res, 'usuarios:leer'))) return;
  const { rows } = await pool.query(
    'SELECT id, email, nombre, rol, activo, intentos_fallidos, bloqueado_hasta, creado_en, (firebase_uid IS NOT NULL) AS vinculado_firebase FROM usuarios ORDER BY id',
  );
  enviar(res, 200, rows);
}

async function crearUsuario(req, res) {
  if (!(await exigir(req, res, 'usuarios:gestionar'))) return;
  const b = await leerJson(req);
  const email = texto(b.email, 200).toLowerCase();
  const nombre = texto(b.nombre, 100);
  const rol = ROLES.includes(b.rol) ? b.rol : null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !nombre || !rol) {
    return enviar(res, 400, { error: 'Email, nombre y rol válidos son obligatorios' });
  }
  const errPass = seg.validarPoliticaPassword(b.password);
  if (errPass) return enviar(res, 400, { error: errPass });
  const existe = await pool.query('SELECT 1 FROM usuarios WHERE email = $1', [email]);
  if (existe.rowCount) return enviar(res, 409, { error: 'El email ya existe' });
  let uid = null;
  if (MODO_AUTH === 'firebase') {
    // La contraseña se almacena solo en Firebase; el portal guarda la identidad y el rol.
    try { uid = await firebase.crearUsuario({ email, password: b.password, nombre }); }
    catch (e) {
      if (e.code === 'auth/email-already-exists') uid = await firebase.buscarUid(email);
      else return enviar(res, 400, { error: 'Firebase rechazó la cuenta: ' + String(e.message || e.code).slice(0, 150) });
    }
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO usuarios (email, nombre, rol, password_hash, firebase_uid) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [email, nombre, rol, uid ? 'externo:firebase' : seg.hashPassword(b.password), uid],
    );
    await auditar('usuario_creado', req, `id=${rows[0].id} email=${email} rol=${rol}`);
    enviar(res, 201, { id: rows[0].id });
  } catch (e) {
    if (e.code === '23505') return enviar(res, 409, { error: 'El email ya existe' });
    throw e;
  }
}

async function actualizarUsuario(req, res, id) {
  if (!(await exigir(req, res, 'usuarios:gestionar'))) return;
  const b = await leerJson(req);
  if (id === req.usuario.id) return enviar(res, 400, { error: 'No puede modificar su propia cuenta (segregación de funciones)' });
  const sets = [];
  const vals = [id];
  if (typeof b.activo === 'boolean') { vals.push(b.activo); sets.push(`activo = $${vals.length}`); }
  if (b.rol !== undefined) {
    if (!ROLES.includes(b.rol)) return enviar(res, 400, { error: 'Rol inválido' });
    vals.push(b.rol); sets.push(`rol = $${vals.length}`);
  }
  if (b.desbloquear === true) sets.push('intentos_fallidos = 0, bloqueado_hasta = NULL');
  const restablecerMfa = b.restablecer_mfa === true;
  if (!sets.length && !restablecerMfa) return enviar(res, 400, { error: 'Nada que actualizar' });
  const actual = await pool.query('SELECT firebase_uid FROM usuarios WHERE id = $1', [id]);
  if (!actual.rowCount) return enviar(res, 404, { error: 'No encontrado' });
  const uid = actual.rows[0].firebase_uid;
  if (MODO_AUTH === 'firebase' && uid) {
    if (typeof b.activo === 'boolean') await firebase.establecerActivo(uid, b.activo);
    if (restablecerMfa) await firebase.restablecerMfa(uid);
  } else if (restablecerMfa) {
    return enviar(res, 400, { error: 'El usuario no está vinculado a Firebase' });
  }
  if (sets.length) await pool.query(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = $1`, vals);
  await auditar(restablecerMfa ? 'mfa_restablecido' : 'usuario_actualizado', req,
    `id=${id} cambios=${JSON.stringify({ activo: b.activo, rol: b.rol, desbloquear: b.desbloquear, restablecer_mfa: restablecerMfa || undefined })}`);
  enviar(res, 200, { ok: true });
}

async function listarAuditoria(req, res) {
  if (!(await exigir(req, res, 'auditoria:leer'))) return;
  const { rows } = await pool.query(
    'SELECT id, ts, evento, email, rol, ip, detalle, instancia FROM auditoria ORDER BY id DESC LIMIT 200',
  );
  enviar(res, 200, rows);
}

async function health(req, res) {
  try {
    await pool.query('SELECT 1');
    enviar(res, 200, { status: 'ok', instancia: INSTANCIA, db: 'ok', uptime_s: Math.round(process.uptime()) });
  } catch (e) {
    log('error', 'health_db_error', { error: e.message });
    enviar(res, 503, { status: 'degradado', instancia: INSTANCIA, db: 'error' });
  }
}

// ---------------------------------------------------------------- archivos estáticos
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function estatico(req, res) {
  const url = req.url.split('?')[0];
  const rel = url === '/' ? 'index.html' : url.slice(1);
  const archivo = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!archivo.startsWith(PUBLIC_DIR + path.sep)) return enviar(res, 404, { error: 'No encontrado' });
  fs.readFile(archivo, (err, data) => {
    if (err) return enviar(res, 404, { error: 'No encontrado' });
    res.writeHead(200, { ...CABECERAS_SEGURIDAD, 'Content-Type': MIME[path.extname(archivo)] || 'application/octet-stream', 'X-Served-By': INSTANCIA });
    res.end(data);
  });
}

// ---------------------------------------------------------------- router
const RUTAS = [
  ['GET', /^\/health$/, health],
  ['POST', /^\/api\/login$/, login],
  ['POST', /^\/api\/logout$/, logout],
  ['GET', /^\/api\/me$/, me],
  ['GET', /^\/api\/config$/, config],
  ['GET', /^\/api\/incidentes$/, listarIncidentes],
  ['POST', /^\/api\/incidentes$/, crearIncidente],
  ['PATCH', /^\/api\/incidentes\/(\d+)$/, actualizarIncidente],
  ['DELETE', /^\/api\/incidentes\/(\d+)$/, eliminarIncidente],
  ['GET', /^\/api\/usuarios$/, listarUsuarios],
  ['POST', /^\/api\/usuarios$/, crearUsuario],
  ['PATCH', /^\/api\/usuarios\/(\d+)$/, actualizarUsuario],
  ['GET', /^\/api\/auditoria$/, listarAuditoria],
];

const servidor = http.createServer(async (req, res) => {
  const inicio = Date.now();
  req.ip = ipCliente(req);
  res.on('finish', () => {
    if (req.url === '/health') return;
    log(res.statusCode >= 500 ? 'error' : 'info', 'http', {
      metodo: req.method, ruta: req.url.split('?')[0], status: res.statusCode, ms: Date.now() - inicio,
      ip: req.ip, usuario: req.usuario && req.usuario.email,
    });
  });
  try {
    autenticar(req);
    const ruta = req.url.split('?')[0];
    if (ruta.startsWith('/api/')) {
      if (!csrfOk(req)) return enviar(res, 403, { error: 'Petición rechazada (CSRF)' });
      for (const [m, re, h] of RUTAS) {
        const match = ruta.match(re);
        if (match && m === req.method) return await h(req, res, match[1] ? Number(match[1]) : undefined);
      }
      return enviar(res, 404, { error: 'Ruta no encontrada' });
    }
    if (ruta === '/health' && req.method === 'GET') return await health(req, res);
    if (req.method === 'GET') return estatico(req, res);
    enviar(res, 405, { error: 'Método no permitido' });
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) log('error', 'error_no_controlado', { error: e.message, ruta: req.url });
    // No se exponen detalles internos al cliente (ISO 27001 A.8.28).
    if (!res.headersSent) enviar(res, status, { error: status === 500 ? 'Error interno' : e.message });
  }
});

servidor.requestTimeout = 15_000;
servidor.headersTimeout = 10_000;

async function arrancar() {
  for (let intento = 1; ; intento++) {
    try {
      await inicializar(pool, [
        { email: 'admin@portal.cl', nombre: 'Administradora', rol: 'admin', password: process.env.SEED_ADMIN_PASSWORD, externo: Boolean(FB) },
        { email: 'analista@portal.cl', nombre: 'Analista SOC', rol: 'analista', password: process.env.SEED_ANALISTA_PASSWORD, externo: Boolean(FB) },
        { email: 'auditor@portal.cl', nombre: 'Auditor Interno', rol: 'auditor', password: process.env.SEED_AUDITOR_PASSWORD, externo: Boolean(FB) },
      ]);
      break;
    } catch (e) {
      log('warn', 'db_no_disponible', { intento, error: e.message });
      if (intento >= 10) process.exit(1);
      await new Promise((r) => setTimeout(r, 2000 * intento));
    }
  }
  servidor.listen(PORT, () => log('info', 'servidor_iniciado', { puerto: PORT, modo_auth: MODO_AUTH }));
}

function apagar(senal) {
  log('info', 'apagado', { senal });
  servidor.close(() => pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', () => apagar('SIGTERM'));
process.on('SIGINT', () => apagar('SIGINT'));

arrancar();
