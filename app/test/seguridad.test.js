'use strict';
const test = require('node:test');
const assert = require('node:assert');
const seg = require('../src/seguridad');
const { tienePermiso } = require('../src/rbac');

const SECRET = 'x'.repeat(40);

test('hash y verificación de contraseña', () => {
  const h = seg.hashPassword('Clave12345');
  assert.ok(h.startsWith('scrypt$'));
  assert.ok(seg.verifyPassword('Clave12345', h));
  assert.ok(!seg.verifyPassword('otra', h));
});

test('política de contraseñas', () => {
  assert.ok(seg.validarPoliticaPassword('corta'));
  assert.ok(seg.validarPoliticaPassword('sinmayusculas1'));
  assert.strictEqual(seg.validarPoliticaPassword('Valida12345'), null);
});

test('token firmado: válido, manipulado y expirado', () => {
  const t = seg.firmarToken({ uid: 1, rol: 'analista', exp: Date.now() + 60000 }, SECRET);
  assert.strictEqual(seg.verificarToken(t, SECRET).rol, 'analista');
  const [body, sig] = t.split('.');
  const falso = Buffer.from(JSON.stringify({ uid: 1, rol: 'admin', exp: Date.now() + 60000 })).toString('base64url');
  assert.strictEqual(seg.verificarToken(`${falso}.${sig}`, SECRET), null, 'escalada de rol rechazada');
  assert.strictEqual(seg.verificarToken(t, 'y'.repeat(40)), null, 'otra clave rechazada');
  const exp = seg.firmarToken({ uid: 1, exp: Date.now() - 1 }, SECRET);
  assert.strictEqual(seg.verificarToken(exp, SECRET), null, 'expirado rechazado');
  assert.ok(body);
});

test('matriz RBAC: mínimo privilegio', () => {
  assert.ok(tienePermiso('admin', 'usuarios:gestionar'));
  assert.ok(!tienePermiso('analista', 'usuarios:gestionar'));
  assert.ok(!tienePermiso('analista', 'auditoria:leer'));
  assert.ok(!tienePermiso('analista', 'incidentes:leer_todos'));
  assert.ok(tienePermiso('auditor', 'auditoria:leer'));
  assert.ok(!tienePermiso('auditor', 'incidentes:crear'));
  assert.ok(!tienePermiso('desconocido', 'incidentes:crear'));
});
