'use strict';
// Genera tráfico continuo contra /health durante N segundos y mide disponibilidad (para pruebas de redeploy en Railway).
const fs = require('node:fs');
const BASE = process.argv[2];
const SEG = Number(process.argv[3] || 150);
const SALIDA = process.argv[4] || 'evidencia-redeploy';
(async () => {
  const t0 = Date.now(); let ok = 0, fallo = 0; const inst = {}; const eventos = [];
  let ultimoSet = '';
  while (Date.now() - t0 < SEG * 1000) {
    try {
      const r = await fetch(BASE + '/health', { signal: AbortSignal.timeout(5000) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 200) { ok++; inst[j.instancia] = (inst[j.instancia] || 0) + 1; } else { fallo++; eventos.push(`${((Date.now()-t0)/1000).toFixed(1)}s HTTP ${r.status}`); }
    } catch (e) { fallo++; eventos.push(`${((Date.now()-t0)/1000).toFixed(1)}s ${e.name}`); }
    const set = Object.keys(inst).sort().join(',');
    if (set !== ultimoSet) { eventos.push(`${((Date.now()-t0)/1000).toFixed(1)}s instancias vistas: ${set}`); ultimoSet = set; }
    await new Promise((r) => setTimeout(r, 250));
  }
  const res = { base: BASE, duracion_s: SEG, ok, fallo, disponibilidad_pct: +(100 * ok / (ok + fallo)).toFixed(3), por_instancia: inst, eventos };
  fs.writeFileSync(SALIDA + '.json', JSON.stringify(res, null, 2));
  console.log(JSON.stringify(res, null, 2));
})();
