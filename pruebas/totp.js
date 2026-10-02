'use strict';
// Generador TOTP (RFC 6238) para pruebas automatizadas y configuración inicial. Solo node:crypto.
const crypto = require('node:crypto');

function base32(secreto) {
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const limpio = secreto.replace(/[\s=]/g, '').toUpperCase();
  let bits = '';
  for (const c of limpio) {
    const v = alfabeto.indexOf(c);
    if (v < 0) throw new Error('Secreto base32 inválido');
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totp(secreto, { tiempo = Date.now(), periodo = 30, digitos = 6, algoritmo = 'sha1', clave } = {}) {
  const k = clave || base32(secreto);
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(Math.floor(tiempo / 1000 / periodo)));
  const h = crypto.createHmac(algoritmo, k).update(contador).digest();
  const o = h[h.length - 1] & 0x0f;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digitos).padStart(digitos, '0');
}

// Milisegundos que faltan para el próximo periodo (para no reutilizar un código ya consumido).
function msHastaProximoPeriodo(periodo = 30) {
  return periodo * 1000 - (Date.now() % (periodo * 1000));
}

module.exports = { totp, base32, msHastaProximoPeriodo };

if (require.main === module) {
  // Vectores de prueba del RFC 6238 (Apéndice B, SHA-1, 8 dígitos).
  const clave = Buffer.from('12345678901234567890');
  const casos = [[59, '94287082'], [1111111109, '07081804'], [1234567890, '89005924'], [2000000000, '69279037']];
  for (const [t, esperado] of casos) {
    const r = totp(null, { clave, tiempo: t * 1000, digitos: 8 });
    console.log(`t=${t} esperado=${esperado} obtenido=${r} ${r === esperado ? 'OK' : 'FALLA'}`);
  }
}
