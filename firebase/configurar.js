'use strict';
// Configuración automatizada del proyecto Firebase para el portal (idempotente).
// Uso: node firebase/configurar.js <firebase-sa.json> <firebase-web.json> <CREDENCIALES-NO-SUBIR.txt> <dominio1,dominio2,...> [salida.html]
//  1. Inicializa Identity Platform y habilita acceso por correo/contraseña
//  2. Activa MFA TOTP, política de contraseñas y protección contra enumeración de correos
//  3. Autoriza los dominios de la aplicación
//  4. Crea/actualiza las cuentas semilla (correo verificado) y enrola su TOTP
//  5. Escribe secretos TOTP en el archivo de credenciales y un HTML local con los códigos QR
const fs = require('node:fs');
const path = require('node:path');
const appDir = path.join(__dirname, '..', 'app');
const { initializeApp, cert } = require(path.join(appDir, 'node_modules', 'firebase-admin', 'lib', 'app'));
const { getAuth } = require(path.join(appDir, 'node_modules', 'firebase-admin', 'lib', 'auth'));
const qrcode = require(path.join(appDir, 'public', 'vendor', 'qrcode.js'));
const { totp, msHastaProximoPeriodo } = require('../pruebas/totp');

const [saPath, webPath, credPath, dominiosArg] = process.argv.slice(2);
if (!saPath || !webPath || !credPath) { console.error('Faltan argumentos'); process.exit(1); }
const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
const web = JSON.parse(fs.readFileSync(webPath, 'utf8'));
const PID = sa.project_id;
const API_KEY = web.apiKey;
const credencial = cert(sa);
initializeApp({ credential: credencial, projectId: PID });
const auth = getAuth();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SEMILLAS = [
  { rol: 'ADMIN', email: 'admin@portal.cl', nombre: 'Administradora' },
  { rol: 'ANALISTA', email: 'analista@portal.cl', nombre: 'Analista SOC' },
  { rol: 'AUDITOR', email: 'auditor@portal.cl', nombre: 'Auditor Interno' },
];

function leerCred() {
  const o = {};
  for (const l of fs.readFileSync(credPath, 'utf8').split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0) o[l.slice(0, i)] = l.slice(i + 1); }
  return o;
}
function guardarCred(o) { fs.writeFileSync(credPath, Object.entries(o).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'); }

async function adminRest(metodo, url, cuerpo) {
  const { access_token: token } = await credencial.getAccessToken();
  const r = await fetch(url, { method: metodo, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${metodo} ${url.split('?')[0]} -> ${r.status} ${JSON.stringify(j.error || j).slice(0, 300)}`);
  return j;
}
async function clienteRest(ruta, cuerpo) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/${ruta}?key=${API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${ruta} -> ${r.status} ${(j.error && j.error.message) || ''}`);
  return j;
}

async function paso(nombre, fn) {
  process.stdout.write(`- ${nombre}... `);
  try { const r = await fn(); console.log(r || 'OK'); return true; } catch (e) { console.log('ERROR: ' + e.message); return false; }
}

(async () => {
  const CONFIG = `https://identitytoolkit.googleapis.com/admin/v2/projects/${PID}/config`;
  console.log(`Proyecto Firebase: ${PID}`);

  await paso('Inicializar Identity Platform', async () => {
    try { await adminRest('POST', `https://identitytoolkit.googleapis.com/v2/projects/${PID}/identityPlatform:initializeAuth`, {}); return 'inicializado'; }
    catch (e) { if (/ALREADY|already/i.test(e.message)) return 'ya estaba activo'; throw e; }
  });

  await paso('Habilitar acceso con correo/contraseña', () =>
    adminRest('PATCH', `${CONFIG}?updateMask=signIn.email.enabled,signIn.email.passwordRequired`, { signIn: { email: { enabled: true, passwordRequired: true } } }).then(() => 'habilitado'));

  await paso('Protección contra enumeración de correos', () =>
    adminRest('PATCH', `${CONFIG}?updateMask=emailPrivacyConfig.enableImprovedEmailPrivacy`, { emailPrivacyConfig: { enableImprovedEmailPrivacy: true } }).then(() => 'activada'));

  const okMfa = await paso('Activar MFA TOTP y política de contraseñas', async () => {
    await auth.projectConfigManager().updateProjectConfig({
      multiFactorConfig: { providerConfigs: [{ state: 'ENABLED', totpProviderConfig: { adjacentIntervals: 1 } }] },
      passwordPolicyConfig: {
        enforcementState: 'ENFORCE',
        forceUpgradeOnSignin: true,
        constraints: { requireUppercase: true, requireLowercase: true, requireNumeric: true, minLength: 10, maxLength: 128 },
      },
    });
    return 'TOTP habilitado (ventana ±1 periodo), contraseña ≥10 con Aa1';
  });
  if (!okMfa) { console.error('\nNo se pudo activar TOTP. ¿Está actualizado a Identity Platform (Authentication → Configuración)?'); process.exit(1); }

  if (dominiosArg) {
    await paso('Autorizar dominios', async () => {
      const actual = await adminRest('GET', CONFIG);
      const dominios = [...new Set([...(actual.authorizedDomains || []), ...dominiosArg.split(',')])];
      await adminRest('PATCH', `${CONFIG}?updateMask=authorizedDomains`, { authorizedDomains: dominios });
      return dominios.join(', ');
    });
  }

  const cred = leerCred();
  for (const s of SEMILLAS) {
    const password = cred[`SEED_${s.rol}_PASSWORD`];
    const claveSecreto = `${s.rol}_TOTP_SECRET`;
    await paso(`Cuenta ${s.email}`, async () => {
      let u;
      try {
        u = await auth.getUserByEmail(s.email);
        await auth.updateUser(u.uid, { password, emailVerified: true, displayName: s.nombre, disabled: false });
      } catch (e) {
        if (e.code !== 'auth/user-not-found') throw e;
        u = await auth.createUser({ email: s.email, password, emailVerified: true, displayName: s.nombre });
      }
      u = await auth.getUser(u.uid);
      const enrolado = u.multiFactor && u.multiFactor.enrolledFactors && u.multiFactor.enrolledFactors.length > 0;
      if (enrolado && cred[claveSecreto]) return `uid=${u.uid}, TOTP ya enrolado`;
      if (enrolado) await auth.updateUser(u.uid, { multiFactor: { enrolledFactors: null } });

      const login = await clienteRest('v1/accounts:signInWithPassword', { email: s.email, password, returnSecureToken: true });
      const inicio = await clienteRest('v2/accounts/mfaEnrollment:start', { idToken: login.idToken, totpEnrollmentInfo: {} });
      const info = inicio.totpSessionInfo;
      const opciones = { periodo: info.periodSec || 30, digitos: info.verificationCodeLength || 6, algoritmo: String(info.hashingAlgorithm || 'SHA1').toLowerCase().replace(/^hmac_?/, '').replace('_', '') };
      await clienteRest('v2/accounts/mfaEnrollment:finalize', {
        idToken: login.idToken, displayName: 'App autenticadora',
        totpVerificationInfo: { sessionInfo: info.sessionInfo, verificationCode: totp(info.sharedSecretKey, opciones) },
      });
      cred[claveSecreto] = info.sharedSecretKey;
      guardarCred(cred);
      return `uid=${u.uid}, TOTP enrolado`;
    });
  }

  // Página local con los QR para registrar las cuentas en una app autenticadora del teléfono.
  const filas = SEMILLAS.filter((s) => cred[`${s.rol}_TOTP_SECRET`]).map((s) => {
    const url = `otpauth://totp/${encodeURIComponent('Portal Incidentes TI3V62')}:${encodeURIComponent(s.email)}?secret=${cred[`${s.rol}_TOTP_SECRET`]}&issuer=${encodeURIComponent('Portal Incidentes TI3V62')}&algorithm=SHA1&digits=6&period=30`;
    const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
    return `<div class="c"><h2>${s.email}</h2><p>Contraseña: <code>${cred[`SEED_${s.rol}_PASSWORD`]}</code></p><img src="${qr.createDataURL(5, 8)}" alt="QR ${s.email}"><p>Clave: <code>${cred[`${s.rol}_TOTP_SECRET`]}</code></p></div>`;
  }).join('');
  const html = `<!doctype html><meta charset="utf-8"><title>Credenciales 2FA (NO COMPARTIR)</title><style>body{font-family:system-ui;margin:24px;background:#f4f6f9}h1{color:#b42318}.g{display:flex;gap:16px;flex-wrap:wrap}.c{background:#fff;border:1px solid #dde2ea;border-radius:10px;padding:16px;text-align:center}code{background:#eef1f5;padding:2px 6px;border-radius:4px;word-break:break-all}</style><h1>Credenciales de demostración y 2FA — NO COMPARTIR NI SUBIR</h1><p>Escanee cada QR con Google Authenticator / Microsoft Authenticator. Elimine este archivo después de usarlo.</p><div class="g">${filas}</div>`;
  const htmlPath = process.argv[6] || path.join(path.dirname(credPath), 'CREDENCIALES-2FA.html');
  fs.writeFileSync(htmlPath, html);
  console.log(`\nQR generados en: ${htmlPath}`);
  console.log(`Próximo periodo TOTP en ${Math.round(msHastaProximoPeriodo() / 1000)} s`);
  await sleep(10);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
