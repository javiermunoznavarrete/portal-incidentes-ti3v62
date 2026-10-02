'use strict';
// Integración con Firebase Authentication (Identity Platform) para autenticación multifactor (TOTP).
// El navegador autentica contra Firebase (contraseña + código TOTP) y entrega un ID token;
// el servidor lo verifica con el Admin SDK y exige que el segundo factor haya sido usado.
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

let auth = null;

function configuracion() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) return null;
  let web;
  try { web = JSON.parse(process.env.FIREBASE_WEB_CONFIG || '{}'); } catch { web = {}; }
  return { projectId, web };
}

function iniciar() {
  const cfg = configuracion();
  if (!cfg) return null;
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  const credencial = sa ? cert(JSON.parse(Buffer.from(sa, 'base64').toString('utf8'))) : undefined;
  initializeApp({ projectId: cfg.projectId, ...(credencial ? { credential: credencial } : {}) });
  auth = getAuth();
  return cfg;
}

// Verifica firma, emisor, audiencia, expiración y revocación del ID token.
async function verificarIdToken(idToken) {
  const t = await auth.verifyIdToken(idToken, true);
  if (!t.email || !t.email_verified) throw Object.assign(new Error('Correo no verificado en Firebase'), { codigo: 'email_no_verificado' });
  return {
    uid: t.uid,
    email: t.email.toLowerCase(),
    segundoFactor: (t.firebase && t.firebase.sign_in_second_factor) || null,
  };
}

async function crearUsuario({ email, password, nombre }) {
  const u = await auth.createUser({ email, password, displayName: nombre, emailVerified: true });
  return u.uid;
}

async function buscarUid(email) {
  try { return (await auth.getUserByEmail(email)).uid; } catch { return null; }
}

// Desactivar en Firebase + revocar tokens: el usuario no puede volver a autenticarse.
async function establecerActivo(uid, activo) {
  await auth.updateUser(uid, { disabled: !activo });
  if (!activo) await auth.revokeRefreshTokens(uid);
}

// Elimina los segundos factores enrolados (p. ej. pérdida del teléfono); deberá enrolar uno nuevo.
async function restablecerMfa(uid) {
  await auth.updateUser(uid, { multiFactor: { enrolledFactors: null } });
  await auth.revokeRefreshTokens(uid);
}

module.exports = { configuracion, iniciar, verificarIdToken, crearUsuario, buscarUid, establecerActivo, restablecerMfa };
