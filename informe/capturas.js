'use strict';
// Capturas de pantalla de la app desplegada usando Chrome headless vía CDP (sin dependencias).
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const BASE = process.argv[2];
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PERFIL = process.env.PERFIL_TMP;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${PERFIL}`, '--window-size=1366,800', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let ver;
  for (let i = 0; i < 30 && !ver; i++) { await sleep(500); try { ver = await (await fetch('http://127.0.0.1:9333/json/version')).json(); } catch {} }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
  const cmd = (method, params = {}, sessionId) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });

  async function pagina() {
    const { result: { browserContextId } } = await cmd('Target.createBrowserContext');
    const { result: { targetId } } = await cmd('Target.createTarget', { url: 'about:blank', browserContextId });
    const { result: { sessionId } } = await cmd('Target.attachToTarget', { targetId, flatten: true });
    await cmd('Emulation.setDeviceMetricsOverride', { width: 1366, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
    const ev = async (expr) => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId)).result;
    const ir = async (url) => { await cmd('Page.navigate', { url }, sessionId); await sleep(2500); };
    const foto = async (nombre) => {
      const { result } = await cmd('Page.captureScreenshot', { format: 'png' }, sessionId);
      fs.writeFileSync(`img/${nombre}.png`, Buffer.from(result.data, 'base64'));
      console.log('captura', nombre);
    };
    return { ev, ir, foto };
  }
  const login = (p, email, pass) => p.ev(`(async()=>{const f=document.querySelector('#form-login');f.email.value=${JSON.stringify(email)};f.password.value=${JSON.stringify(pass)};f.requestSubmit();await new Promise(r=>setTimeout(r,2500));return document.querySelector('#rol-badge').textContent})()`);
  const tab = (p, t) => p.ev(`(async()=>{document.querySelector('[data-tab=${t}]').click();await new Promise(r=>setTimeout(r,2000));return 1})()`);

  const p0 = await pagina();
  await p0.ir(BASE);
  await p0.foto('01-login');
  await login(p0, 'analista@portal.cl', 'contraseña-incorrecta');
  await p0.foto('02-login-fallido');

  const pa = await pagina();
  await pa.ir(BASE);
  console.log('rol', await login(pa, 'admin@portal.cl', process.env.ADMIN_PASS));
  await pa.foto('03-admin-incidentes');
  await tab(pa, 'usuarios'); await pa.foto('04-admin-usuarios');
  await tab(pa, 'auditoria'); await pa.foto('05-admin-auditoria');

  const pn = await pagina();
  await pn.ir(BASE);
  console.log('rol', await login(pn, 'analista@portal.cl', process.env.ANALISTA_PASS));
  await pn.foto('06-analista-incidentes');

  const pu = await pagina();
  await pu.ir(BASE);
  console.log('rol', await login(pu, 'auditor@portal.cl', process.env.AUDITOR_PASS));
  await pu.foto('07-auditor-incidentes');
  await tab(pu, 'auditoria'); await pu.foto('08-auditor-auditoria');

  ws.close(); proc.kill();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
