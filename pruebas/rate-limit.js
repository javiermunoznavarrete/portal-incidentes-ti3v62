'use strict';
// Prueba de limitación de tasa del login (NIST AC-7 / SC-5).
// El límite es de 10 intentos por minuto por IP en CADA réplica (contador en memoria), por lo que con
// 2 réplicas balanceadas el bloqueo aparece entre el intento 11 y el ~21. Se envían 30 intentos seguidos.
// Uso: node rate-limit.js <BASE_URL> <salida>
const fs = require('node:fs');
const BASE = (process.argv[2] || 'http://localhost:8080').replace(/\/$/, '');
const SALIDA = process.argv[3] || 'evidencia-rate-limit';

(async () => {
  const filas = [];
  for (let i = 1; i <= 30; i++) {
    const r = await fetch(`${BASE}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify({ idToken: 'token-invalido-prueba-rate-limit', email: 'nadie@portal.cl', password: 'x' }),
    });
    filas.push({ intento: i, status: r.status, replica: r.headers.get('x-served-by') });
  }
  const primero429 = filas.find((f) => f.status === 429);
  const porReplica = {};
  for (const f of filas) {
    porReplica[f.replica] = porReplica[f.replica] || { aceptados: 0, bloqueados: 0 };
    if (f.status === 429) porReplica[f.replica].bloqueados++; else porReplica[f.replica].aceptados++;
  }
  const maxAceptadosPorReplica = Math.max(...Object.values(porReplica).map((v) => v.aceptados));
  const ok = Boolean(primero429) && maxAceptadosPorReplica <= 10;
  const lineas = [
    `Prueba de limitación de tasa sobre ${BASE} — ${new Date().toISOString()}`,
    `30 intentos de login seguidos desde la misma IP`,
    ...filas.map((f) => `  intento ${String(f.intento).padStart(2)}: HTTP ${f.status} (${f.replica})`),
    `Por réplica: ${JSON.stringify(porReplica)}`,
    `Primer HTTP 429 en el intento: ${primero429 ? primero429.intento : 'ninguno'}`,
    `[${ok ? 'OK ' : 'FALLA'}] Límite de 10 intentos/minuto por IP en cada réplica — ninguna réplica aceptó más de 10 (máximo: ${maxAceptadosPorReplica})`,
  ];
  console.log(lineas.join('\n'));
  fs.writeFileSync(`${SALIDA}.txt`, lineas.join('\n') + '\n');
  fs.writeFileSync(`${SALIDA}.json`, JSON.stringify({ base: BASE, fecha: new Date().toISOString(), ok, porReplica, primero429: primero429 && primero429.intento, filas }, null, 2));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
