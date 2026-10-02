'use strict';
// Batería de pruebas de seguridad y disponibilidad. Genera evidencia en JSON + texto.
// Uso: node pruebas.js <BASE_URL> <salida> [--local]
//   Credenciales vía variables: ADMIN_PASS, ANALISTA_PASS, AUDITOR_PASS
//   Modo Firebase (2FA): además ADMIN_TOTP, ANALISTA_TOTP, AUDITOR_TOTP (secretos base32)
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const { totp, msHastaProximoPeriodo } = require('./totp');

const BASE = (process.argv[2] || 'http://localhost:8080').replace(/\/$/, '');
const SALIDA = process.argv[3] || 'evidencia';
const LOCAL = process.argv.includes('--local');
const CRED = {
  admin: ['admin@portal.cl', process.env.ADMIN_PASS || 'AdminLocal2026'],
  analista: ['analista@portal.cl', process.env.ANALISTA_PASS || 'AnalistaLocal2026'],
  auditor: ['auditor@portal.cl', process.env.AUDITOR_PASS || 'AuditorLocal2026'],
};

const TOTP = { admin: process.env.ADMIN_TOTP, analista: process.env.ANALISTA_TOTP, auditor: process.env.AUDITOR_TOTP };
let CONFIG = { modo: 'local' };
const FIREBASE = () => CONFIG.modo === 'firebase';

const resultados = [];
const lineas = [];
function out(s = '') { console.log(s); lineas.push(s); }
function registrar(grupo, nombre, esperado, obtenido, ok, detalle = '') {
  resultados.push({ grupo, nombre, esperado, obtenido, ok, detalle });
  out(`  [${ok ? 'OK ' : 'FALLA'}] ${nombre} — esperado: ${esperado} | obtenido: ${obtenido}${detalle ? ` (${detalle})` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(metodo, ruta, { cookie, body, csrf = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (csrf) headers['X-Requested-With'] = 'fetch';
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(BASE + ruta, { method: metodo, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const txt = await r.text();
  let json; try { json = JSON.parse(txt); } catch { json = null; }
  const set = r.headers.get('set-cookie');
  return { status: r.status, json, headers: r.headers, cookie: set ? set.split(';')[0] : null };
}

// API REST de Firebase Authentication (lo mismo que hace el SDK web en el navegador).
async function fb(ruta, cuerpo) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/${ruta}?key=${CONFIG.firebase.apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j, error: j.error && j.error.message };
}

// Contraseña + TOTP -> ID token con segundo factor. Reintenta en el siguiente periodo si el código ya fue usado.
async function idTokenConMfa(email, password, secreto) {
  for (let intento = 0; intento < 2; intento++) {
    const a = await fb('v1/accounts:signInWithPassword', { email, password, returnSecureToken: true });
    if (!a.j.mfaPendingCredential) throw new Error(`se esperaba desafío MFA para ${email}: ${a.error || 'sin desafío'}`);
    const f = await fb('v2/accounts/mfaSignIn:finalize', {
      mfaPendingCredential: a.j.mfaPendingCredential, mfaEnrollmentId: a.j.mfaInfo[0].mfaEnrollmentId,
      totpVerificationInfo: { verificationCode: totp(secreto) },
    });
    if (f.j.idToken) return f.j.idToken;
    await sleep(msHastaProximoPeriodo() + 1000);
  }
  throw new Error(`no se pudo completar MFA para ${email}`);
}

async function login(rol) {
  const [email, password] = CRED[rol];
  const body = FIREBASE() ? { idToken: await idTokenConMfa(email, password, TOTP[rol]) } : { email, password };
  const r = await req('POST', '/api/login', { body });
  if (r.status !== 200) throw new Error(`login ${rol} falló: ${r.status}`);
  return r;
}

async function main() {
  out(`Pruebas sobre ${BASE} — ${new Date().toISOString()}`);
  CONFIG = (await req('GET', '/api/config')).json || CONFIG;
  out(`Modo de autenticación: ${CONFIG.modo}`);

  out('\n1. Disponibilidad básica y cabeceras de seguridad');
  const h = await req('GET', '/health', { csrf: false });
  registrar('disponibilidad', 'GET /health responde', 200, h.status, h.status === 200, JSON.stringify(h.json));
  const home = await fetch(BASE + '/');
  for (const cab of ['content-security-policy', 'x-frame-options', 'x-content-type-options', 'strict-transport-security', 'referrer-policy']) {
    const v = home.headers.get(cab);
    registrar('hardening', `Cabecera ${cab}`, 'presente', v ? v.slice(0, 60) : 'ausente', Boolean(v));
  }
  const xpb = home.headers.get('x-powered-by');
  registrar('hardening', 'Sin cabecera X-Powered-By (no revela tecnología)', 'ausente', xpb || 'ausente', !xpb);

  out('\n2. Autenticación');
  const sin = await req('GET', '/api/incidentes');
  registrar('autenticacion', 'Acceso sin sesión a /api/incidentes', 401, sin.status, sin.status === 401);
  if (FIREBASE()) {
    const mala = await fb('v1/accounts:signInWithPassword', { email: 'analista@portal.cl', password: 'Incorrecta123', returnSecureToken: true });
    registrar('autenticacion', 'Login con contraseña incorrecta (Firebase)', 'rechazado', `${mala.status} ${mala.error}`, !mala.j.idToken && !mala.j.mfaPendingCredential);

    out('\n2b. Autenticación multifactor (Firebase + TOTP)');
    const soloPass = await fb('v1/accounts:signInWithPassword', { email: CRED.analista[0], password: CRED.analista[1], returnSecureToken: true });
    registrar('mfa', 'Contraseña correcta sin TOTP no entrega token', 'desafío MFA', soloPass.j.idToken ? 'token entregado' : (soloPass.j.mfaPendingCredential ? 'desafío MFA' : soloPass.error),
      !soloPass.j.idToken && Boolean(soloPass.j.mfaPendingCredential), `factores: ${(soloPass.j.mfaInfo || []).map((m) => (m.totpInfo ? 'totp' : 'otro')).join(',')}`);
    const malo = await fb('v2/accounts/mfaSignIn:finalize', { mfaPendingCredential: soloPass.j.mfaPendingCredential, mfaEnrollmentId: soloPass.j.mfaInfo[0].mfaEnrollmentId, totpVerificationInfo: { verificationCode: '000000' } });
    registrar('mfa', 'Código TOTP incorrecto rechazado', 'rechazado', `${malo.status} ${malo.error}`, !malo.j.idToken);
    const tokFalso = await req('POST', '/api/login', { body: { idToken: 'eyJhbGciOiJSUzI1NiJ9.eyJlbWFpbCI6ImFkbWluQHBvcnRhbC5jbCJ9.firma' } });
    registrar('mfa', 'ID token falsificado rechazado por el servidor', 401, tokFalso.status, tokFalso.status === 401);
  } else {
    const mala = await req('POST', '/api/login', { body: { email: 'analista@portal.cl', password: 'incorrecta' } });
    registrar('autenticacion', 'Login con contraseña incorrecta', 401, mala.status, mala.status === 401, 'mensaje genérico: ' + (mala.json && mala.json.error));
  }
  const falsa = await req('GET', '/api/usuarios', { cookie: 'sid=eyJ1aWQiOjEsInJvbCI6ImFkbWluIiwiZXhwIjo5OTk5OTk5OTk5OTk5fQ.firmafalsa' });
  registrar('autenticacion', 'Token de sesión falsificado (rol admin)', 401, falsa.status, falsa.status === 401);

  const cookies = {};
  let rawCookie = '';
  for (const rol of Object.keys(CRED)) {
    const r = await login(rol);
    cookies[rol] = r.cookie;
    if (rol === 'auditor') rawCookie = r.headers.get('set-cookie') || '';
    registrar('autenticacion', `Login ${rol}${FIREBASE() ? ' (contraseña + TOTP)' : ''}`, 'cookie HttpOnly', cookies[rol] ? 'emitida' : 'no', Boolean(cookies[rol]));
  }
  registrar('autenticacion', 'Atributos de cookie de sesión', 'HttpOnly; SameSite=Strict', rawCookie.replace(/sid=[^;]+/, 'sid=***'),
    /HttpOnly/i.test(rawCookie) && /SameSite=Strict/i.test(rawCookie));

  out('\n3. Control de acceso basado en roles (RBAC)');
  const matriz = [
    ['analista', 'POST', '/api/incidentes', { titulo: 'Phishing reportado por usuario', severidad: 'media' }, 201],
    ['admin', 'POST', '/api/incidentes', { titulo: 'Escaneo de puertos desde IP externa', severidad: 'alta' }, 201],
    ['auditor', 'POST', '/api/incidentes', { titulo: 'intento', severidad: 'baja' }, 403],
    ['analista', 'GET', '/api/usuarios', null, 403],
    ['auditor', 'GET', '/api/usuarios', null, 403],
    ['admin', 'GET', '/api/usuarios', null, 200],
    ['analista', 'GET', '/api/auditoria', null, 403],
    ['auditor', 'GET', '/api/auditoria', null, 200],
    ['admin', 'GET', '/api/auditoria', null, 200],
    ['analista', 'POST', '/api/usuarios', { email: 'x@x.cl', nombre: 'X', rol: 'admin', password: 'Escalada12345' }, 403],
  ];
  let idAdmin = null;
  for (const [rol, m, ruta, body, esperado] of matriz) {
    const r = await req(m, ruta, { cookie: cookies[rol], body });
    if (rol === 'admin' && m === 'POST' && ruta === '/api/incidentes' && r.json) idAdmin = r.json.id;
    registrar('rbac', `${rol} ${m} ${ruta}`, esperado, r.status, r.status === esperado);
  }
  const listaAnalista = await req('GET', '/api/incidentes', { cookie: cookies.analista });
  const soloPropios = listaAnalista.json.every((i) => i.creado_por === CRED.analista[0]);
  registrar('rbac', 'Analista solo ve sus propios incidentes', 'true', String(soloPropios), soloPropios, `${listaAnalista.json.length} visibles`);
  const listaAuditor = await req('GET', '/api/incidentes', { cookie: cookies.auditor });
  registrar('rbac', 'Auditor ve todos los incidentes (solo lectura)', '>= 2', listaAuditor.json.length, listaAuditor.json.length >= 2);
  const ajeno = await req('PATCH', `/api/incidentes/${idAdmin}`, { cookie: cookies.analista, body: { estado: 'cerrado' } });
  registrar('rbac', 'Analista modifica incidente ajeno (IDOR)', 403, ajeno.status, ajeno.status === 403);
  const delAn = await req('DELETE', `/api/incidentes/${idAdmin}`, { cookie: cookies.analista });
  registrar('rbac', 'Analista elimina incidente', 403, delAn.status, delAn.status === 403);

  out('\n4. Protección CSRF e inyección');
  const csrf = await req('POST', '/api/incidentes', { cookie: cookies.analista, body: { titulo: 'csrf', severidad: 'baja' }, csrf: false });
  registrar('csrf', 'POST sin cabecera anti-CSRF', 403, csrf.status, csrf.status === 403);
  const sqli = await req('POST', '/api/login', { body: { email: "' OR '1'='1' --", password: "' OR '1'='1" } });
  registrar('inyeccion', 'Inyección SQL en login', 401, sqli.status, sqli.status === 401);

  if (FIREBASE()) {
    out('\n5. Cuenta nueva sin 2FA y revocación (cuenta de prueba)');
    const email = `prueba${Date.now()}@portal.cl`;
    const alta = await req('POST', '/api/usuarios', { cookie: cookies.admin, body: { email, nombre: 'Cuenta Prueba', rol: 'analista', password: 'Prueba123456' } });
    registrar('mfa', 'Admin crea usuario (sincronizado con Firebase)', 201, alta.status, alta.status === 201);
    const a = await fb('v1/accounts:signInWithPassword', { email, password: 'Prueba123456', returnSecureToken: true });
    const sinMfa = await req('POST', '/api/login', { body: { idToken: a.j.idToken || '' } });
    registrar('mfa', 'Login sin segundo factor enrolado es rechazado', '401 mfa_requerido', `${sinMfa.status} ${sinMfa.json && sinMfa.json.codigo}`,
      sinMfa.status === 401 && sinMfa.json && sinMfa.json.codigo === 'mfa_requerido');
    const lista = await req('GET', '/api/usuarios', { cookie: cookies.admin });
    const nuevo = lista.json.find((u) => u.email === email);
    await req('PATCH', `/api/usuarios/${nuevo.id}`, { cookie: cookies.admin, body: { activo: false } });
    const desact = await fb('v1/accounts:signInWithPassword', { email, password: 'Prueba123456', returnSecureToken: true });
    registrar('mfa', 'Usuario desactivado no puede autenticarse en Firebase', 'USER_DISABLED', desact.error || 'token entregado', desact.error === 'USER_DISABLED');
  } else {
    out('\n5. Bloqueo por fuerza bruta (cuenta de prueba)');
    const pruebaEmail = `bloqueo${Date.now()}@portal.cl`;
    await req('POST', '/api/usuarios', { cookie: cookies.admin, body: { email: pruebaEmail, nombre: 'Cuenta Bloqueo', rol: 'analista', password: 'Bloqueo12345' } });
    const estados = [];
    for (let i = 0; i < 5; i++) estados.push((await req('POST', '/api/login', { body: { email: pruebaEmail, password: 'Mala' + i } })).status);
    const tras = await req('POST', '/api/login', { body: { email: pruebaEmail, password: 'Bloqueo12345' } });
    registrar('autenticacion', '5 intentos fallidos -> bloqueo de cuenta', 423, tras.status, tras.status === 423, `intentos: ${estados.join(',')}`);
  }
  const pol = await req('POST', '/api/usuarios', { cookie: cookies.admin, body: { email: `debil${Date.now()}@portal.cl`, nombre: 'Débil', rol: 'analista', password: '123456' } });
  registrar('autenticacion', 'Política de contraseñas rechaza "123456"', 400, pol.status, pol.status === 400, pol.json && pol.json.error);

  out('\n6. Logging / auditoría');
  const aud = await req('GET', '/api/auditoria', { cookie: cookies.auditor });
  const eventos = new Set(aud.json.map((e) => e.evento));
  const esperados = FIREBASE()
    ? ['login_exitoso', 'login_fallido', 'acceso_denegado', 'login_sin_mfa', 'incidente_creado']
    : ['login_exitoso', 'login_fallido', 'acceso_denegado', 'cuenta_bloqueada', 'incidente_creado'];
  for (const ev of esperados) {
    registrar('logging', `Evento "${ev}" registrado`, 'presente', eventos.has(ev) ? 'presente' : 'ausente', eventos.has(ev));
  }
  if (FIREBASE()) {
    const conMfa = aud.json.some((e) => e.evento === 'login_exitoso' && /password\+totp/.test(e.detalle || ''));
    registrar('logging', 'Auditoría registra el factor usado (password+totp)', 'presente', conMfa ? 'presente' : 'ausente', conMfa);
  }

  out('\n7. Balanceo de carga entre réplicas');
  const conteo = {};
  for (let i = 0; i < 40; i++) {
    const r = await req('GET', '/health', { csrf: false });
    const inst = r.json && r.json.instancia;
    conteo[inst] = (conteo[inst] || 0) + 1;
  }
  registrar('disponibilidad', 'Peticiones distribuidas en >= 2 instancias', '>= 2', Object.keys(conteo).length, Object.keys(conteo).length >= 2, JSON.stringify(conteo));

  if (LOCAL) {
    out('\n8. Failover: caída de una réplica (app1) con tráfico continuo');
    let ok = 0; let fallo = 0; const servidoPor = {};
    const t0 = Date.now();
    const trafico = (async () => {
      while (Date.now() - t0 < 20000) {
        try {
          const r = await req('GET', '/api/incidentes', { cookie: cookies.auditor });
          if (r.status === 200) { ok++; const s = r.headers.get('x-served-by'); servidoPor[s] = (servidoPor[s] || 0) + 1; } else fallo++;
        } catch { fallo++; }
        await sleep(100);
      }
    })();
    await sleep(3000);
    execSync('docker stop portal-incidentes-app1-1', { stdio: 'ignore' });
    out('  -> app1 detenida (docker stop) a los 3 s');
    await trafico;
    const disp = (100 * ok / (ok + fallo)).toFixed(2);
    registrar('disponibilidad', 'Servicio sigue respondiendo con 1 réplica caída', '>= 99%', `${disp}% (${ok} ok / ${fallo} fallos)`, Number(disp) >= 99, JSON.stringify(servidoPor));
    execSync('docker start portal-incidentes-app1-1', { stdio: 'ignore' });
    await sleep(15000);
    const vuelta = new Set();
    for (let i = 0; i < 20; i++) { const r = await req('GET', '/health', { csrf: false }); vuelta.add(r.json && r.json.instancia); }
    registrar('disponibilidad', 'Réplica recuperada vuelve al pool', '2 instancias', [...vuelta].join(', '), vuelta.size >= 2);

    out('\n9. Segmentación de red');
    const puertos = execSync('docker port portal-incidentes-db-1', { encoding: 'utf8' }).trim();
    registrar('red', 'Contenedor BD sin puertos publicados al host', 'ninguno', puertos || 'ninguno', !puertos);
    let lbAlcanzaDb = 'no';
    try { execSync('docker exec portal-incidentes-lb-1 sh -c "nc -z -w 2 db 5432"', { stdio: 'ignore' }); lbAlcanzaDb = 'sí'; } catch { /* esperado */ }
    registrar('red', 'Balanceador (zona pública) NO alcanza la BD', 'no', lbAlcanzaDb, lbAlcanzaDb === 'no');
    let dbInternet = 'no';
    try { execSync('docker exec portal-incidentes-db-1 sh -c "wget -q -T 3 -O /dev/null http://example.com"', { stdio: 'ignore' }); dbInternet = 'sí'; } catch { /* esperado */ }
    registrar('red', 'BD sin salida a Internet (red internal)', 'no', dbInternet, dbInternet === 'no');
  }

  const total = resultados.length;
  const oks = resultados.filter((r) => r.ok).length;
  out(`\nResumen: ${oks}/${total} pruebas OK`);
  fs.writeFileSync(`${SALIDA}.json`, JSON.stringify({ base: BASE, fecha: new Date().toISOString(), resultados }, null, 2));
  fs.writeFileSync(`${SALIDA}.txt`, lineas.join('\n') + '\n');
  process.exit(oks === total ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
