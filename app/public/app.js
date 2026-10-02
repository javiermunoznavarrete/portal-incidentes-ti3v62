'use strict';
// Cliente del portal. Todo contenido dinámico se inserta con textContent (prevención de XSS).
const $ = (s) => document.querySelector(s);
let yo = null;

async function api(metodo, ruta, cuerpo) {
  const r = await fetch(ruta, {
    method: metodo,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const servidor = r.headers.get('X-Served-By');
  if (servidor) $('#instancia').textContent = servidor;
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && ruta !== '/api/login' && ruta !== '/api/me') { mostrarLogin(); }
  if (!r.ok) throw Object.assign(new Error(data.error || `Error ${r.status}`), { status: r.status });
  return data;
}

function puede(p) { return yo && yo.permisos.includes(p); }

function mensaje(txt, error = false) {
  const m = $('#mensaje');
  m.textContent = txt;
  m.className = 'mensaje' + (error ? ' error' : '');
  if (txt) setTimeout(() => { if (m.textContent === txt) m.textContent = ''; }, 5000);
}

function fecha(s) { return s ? new Date(s).toLocaleString('es-CL') : ''; }

function tabla(el, columnas, filas, acciones) {
  el.replaceChildren();
  const thead = el.createTHead().insertRow();
  for (const [, titulo] of columnas) { const th = document.createElement('th'); th.textContent = titulo; thead.appendChild(th); }
  if (acciones) { const th = document.createElement('th'); th.textContent = 'Acciones'; thead.appendChild(th); }
  const tb = el.createTBody();
  if (!filas.length) {
    const td = tb.insertRow().insertCell();
    td.colSpan = columnas.length + (acciones ? 1 : 0);
    td.textContent = 'Sin registros';
    td.className = 'vacio';
  }
  for (const f of filas) {
    const tr = tb.insertRow();
    for (const [clave, , fmt] of columnas) {
      const td = tr.insertCell();
      if (fmt === fecha) td.className = 'fecha';
      const v = fmt ? fmt(f[clave], f) : f[clave];
      if (v instanceof Node) td.appendChild(v); else td.textContent = v == null ? '' : String(v);
    }
    if (acciones) tr.insertCell().appendChild(acciones(f));
  }
}

function chip(txt, cls) { const s = document.createElement('span'); s.className = `chip ${cls}`; s.textContent = txt; return s; }

function boton(txt, fn, cls = 'btn-mini') {
  const b = document.createElement('button');
  b.className = `btn ${cls}`;
  b.textContent = txt;
  b.addEventListener('click', fn);
  return b;
}

// ---------------------------------------------------------------- vistas
function mostrarLogin() {
  yo = null;
  $('#vista-login').classList.remove('oculto');
  $('#vista-app').classList.add('oculto');
  $('#sesion').classList.add('oculto');
}

function mostrarApp() {
  $('#vista-login').classList.add('oculto');
  $('#vista-app').classList.remove('oculto');
  $('#sesion').classList.remove('oculto');
  $('#usuario-info').textContent = `${yo.nombre} (${yo.email})`;
  $('#rol-badge').textContent = yo.rol;
  $('#rol-badge').className = `badge rol-${yo.rol}`;
  document.querySelectorAll('[data-permiso]').forEach((el) => el.classList.toggle('oculto', !puede(el.dataset.permiso)));
  cambiarTab('incidentes');
}

function cambiarTab(nombre) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('activo', t.dataset.tab === nombre));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('oculto', p.id !== `tab-${nombre}`));
  ({ incidentes: cargarIncidentes, usuarios: cargarUsuarios, auditoria: cargarAuditoria })[nombre]();
}

const ESTADOS = ['abierto', 'en_analisis', 'contenido', 'cerrado'];

async function cargarIncidentes() {
  try {
    const filas = await api('GET', '/api/incidentes');
    const editaTodos = puede('incidentes:actualizar');
    const editaPropios = puede('incidentes:actualizar_propios');
    const accion = (editaTodos || editaPropios || puede('incidentes:eliminar')) ? (f) => {
      const cont = document.createElement('div');
      cont.className = 'acciones';
      if (editaTodos || (editaPropios && f.creado_por === yo.email)) {
        const sel = document.createElement('select');
        for (const e of ESTADOS) { const o = new Option(e.replace('_', ' '), e, false, e === f.estado); sel.add(o); }
        sel.addEventListener('change', async () => {
          try { await api('PATCH', `/api/incidentes/${f.id}`, { estado: sel.value }); mensaje('Estado actualizado'); cargarIncidentes(); }
          catch (e) { mensaje(e.message, true); }
        });
        cont.appendChild(sel);
      }
      if (puede('incidentes:eliminar')) {
        cont.appendChild(boton('Eliminar', async () => {
          try { await api('DELETE', `/api/incidentes/${f.id}`); mensaje('Incidente eliminado'); cargarIncidentes(); }
          catch (e) { mensaje(e.message, true); }
        }, 'btn-mini btn-peligro'));
      }
      return cont;
    } : null;
    tabla($('#tabla-incidentes'), [
      ['id', '#'], ['titulo', 'Título'], ['severidad', 'Severidad', (v) => chip(v, `sev-${v}`)],
      ['estado', 'Estado', (v) => chip(v.replace('_', ' '), 'estado')], ['creado_por', 'Reportado por'],
      ['creado_en', 'Fecha', fecha],
    ], filas, accion);
  } catch (e) { mensaje(e.message, true); }
}

async function cargarUsuarios() {
  try {
    const filas = await api('GET', '/api/usuarios');
    const gestiona = puede('usuarios:gestionar');
    tabla($('#tabla-usuarios'), [
      ['id', '#'], ['nombre', 'Nombre'], ['email', 'Correo'], ['rol', 'Rol', (v) => chip(v, `rol-${v}`)],
      ['activo', 'Estado', (v, f) => {
        if (f.bloqueado_hasta && new Date(f.bloqueado_hasta) > new Date()) return chip('bloqueado', 'alerta');
        return chip(v ? 'activo' : 'inactivo', v ? 'ok' : 'off');
      }],
      ['creado_en', 'Creado', fecha],
    ], filas, gestiona ? (f) => {
      const cont = document.createElement('div');
      cont.className = 'acciones';
      if (f.email === yo.email) { cont.textContent = '(usted)'; return cont; }
      cont.appendChild(boton(f.activo ? 'Desactivar' : 'Activar', async () => {
        try { await api('PATCH', `/api/usuarios/${f.id}`, { activo: !f.activo }); cargarUsuarios(); }
        catch (e) { mensaje(e.message, true); }
      }));
      cont.appendChild(boton('Desbloquear', async () => {
        try { await api('PATCH', `/api/usuarios/${f.id}`, { desbloquear: true }); mensaje('Cuenta desbloqueada'); cargarUsuarios(); }
        catch (e) { mensaje(e.message, true); }
      }, 'btn-mini btn-sec'));
      return cont;
    } : null);
  } catch (e) { mensaje(e.message, true); }
}

async function cargarAuditoria() {
  try {
    const filas = await api('GET', '/api/auditoria');
    tabla($('#tabla-auditoria'), [
      ['ts', 'Fecha', fecha], ['evento', 'Evento', (v) => chip(v, /denegado|fallido|bloque|rate/.test(v) ? 'alerta' : 'info')],
      ['email', 'Usuario'], ['rol', 'Rol'], ['ip', 'IP'], ['instancia', 'Instancia'], ['detalle', 'Detalle'],
    ], filas);
  } catch (e) { mensaje(e.message, true); }
}

// ---------------------------------------------------------------- eventos
$('#form-login').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  $('#login-error').textContent = '';
  try {
    await api('POST', '/api/login', { email: f.get('email'), password: f.get('password') });
    ev.target.reset();
    yo = await api('GET', '/api/me');
    mostrarApp();
  } catch (e) { $('#login-error').textContent = e.message; }
});

$('#btn-logout').addEventListener('click', async () => { await api('POST', '/api/logout').catch(() => {}); mostrarLogin(); });

$('#tabs').addEventListener('click', (ev) => { if (ev.target.dataset.tab) cambiarTab(ev.target.dataset.tab); });

$('#form-incidente').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = Object.fromEntries(new FormData(ev.target));
  try { await api('POST', '/api/incidentes', f); ev.target.reset(); mensaje('Incidente registrado'); cargarIncidentes(); }
  catch (e) { mensaje(e.message, true); }
});

$('#form-usuario').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = Object.fromEntries(new FormData(ev.target));
  try { await api('POST', '/api/usuarios', f); ev.target.reset(); mensaje('Usuario creado'); cargarUsuarios(); }
  catch (e) { mensaje(e.message, true); }
});

(async () => {
  try { yo = await api('GET', '/api/me'); mostrarApp(); } catch { mostrarLogin(); }
})();
