'use strict';
// Genera el Informe Final del Proyecto Integrador (Evaluación N°4, TI3V62) en formato .docx.
// Las tablas de pruebas se construyen desde los archivos de evidencia reales (../pruebas/*.json).
const fs = require('node:fs');
const path = require('node:path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, ImageRun, Header, Footer, PageNumber, PageBreak,
  TableOfContents, LevelFormat, VerticalAlign,
} = require('docx');

const URL_APP = 'https://portal-app-production-1269.up.railway.app';
const REPO = 'github.com/javiermunoznavarrete/portal-incidentes-ti3v62 (privado)';
const EV = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pruebas', f), 'utf8'));
const evLocal = EV('evidencia-local.json');
const evRailway = EV('evidencia-railway.json');
const evRedeploy = EV('evidencia-redeploy-railway.json');

const ANCHO = 9360; // Carta con márgenes de 1" (DXA)
const AZUL = '1F4E79';
const FUENTE = 'Calibri';

// ---------------------------------------------------------------- helpers
function runs(texto, base = {}) {
  // **negrita** simple
  return texto.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((t) => (t.startsWith('**')
    ? new TextRun({ ...base, text: t.slice(2, -2), bold: true })
    : new TextRun({ ...base, text: t })));
}
const P = (texto, opts = {}) => new Paragraph({ children: runs(texto), spacing: { after: 120, line: 276 }, alignment: AlignmentType.JUSTIFIED, ...opts });
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)], pageBreakBefore: true });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] });
const B = (texto, nivel = 0) => new Paragraph({ children: runs(texto), numbering: { reference: 'vinetas', level: nivel }, spacing: { after: 60, line: 264 } });
const N = (texto) => new Paragraph({ children: runs(texto), numbering: { reference: 'numeros', level: 0 }, spacing: { after: 60, line: 264 } });
const Leyenda = (t) => new Paragraph({ children: [new TextRun({ text: t, italics: true, size: 18, color: '5B6676' })], alignment: AlignmentType.CENTER, spacing: { after: 240 } });

const bordeTabla = { style: BorderStyle.SINGLE, size: 4, color: 'C9D1DC' };
const BORDES = { top: bordeTabla, bottom: bordeTabla, left: bordeTabla, right: bordeTabla };

function celda(contenido, ancho, { header = false, fill, bold = false, size = 18, align = AlignmentType.LEFT, color } = {}) {
  const parrafos = String(contenido).split('\n').map((linea) => new Paragraph({
    alignment: align,
    spacing: { after: 20 },
    children: runs(linea, { size, bold: header || bold, color: header ? 'FFFFFF' : color, font: FUENTE }),
  }));
  return new TableCell({
    width: { size: ancho, type: WidthType.DXA },
    borders: BORDES,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
    shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: AZUL } : (fill ? { type: ShadingType.CLEAR, color: 'auto', fill } : undefined),
    children: parrafos,
  });
}

function tabla(encabezados, filas, anchos, { size = 18, fillFila } = {}) {
  const total = anchos.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: anchos,
    rows: [
      new TableRow({ tableHeader: true, children: encabezados.map((h, i) => celda(h, anchos[i], { header: true, size })) }),
      ...filas.map((f, idx) => new TableRow({
        cantSplit: true,
        children: f.map((c, i) => {
          if (c && typeof c === 'object' && 'texto' in c) return celda(c.texto, anchos[i], { size, ...c });
          return celda(c, anchos[i], { size, fill: fillFila ? fillFila(f, idx) : (idx % 2 ? 'F6F8FB' : undefined) });
        }),
      })),
    ],
  });
}

function imagen(archivo, anchoPx, altoPx) {
  const data = fs.readFileSync(path.join(__dirname, 'img', archivo));
  return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }, children: [new ImageRun({ type: 'png', data, transformation: { width: anchoPx, height: altoPx } })] });
}

const espacio = () => new Paragraph({ children: [], spacing: { after: 80 } });

// ---------------------------------------------------------------- datos de riesgos
function nivel(v) {
  if (v >= 20) return { t: `${v} Crítico`, fill: 'F4C7C3' };
  if (v >= 10) return { t: `${v} Alto`, fill: 'FCE4D6' };
  if (v >= 5) return { t: `${v} Medio`, fill: 'FFF2CC' };
  return { t: `${v} Bajo`, fill: 'E2EFDA' };
}
// [id, activo, amenaza/vulnerabilidad, P, I, controles, ISO 27001:2022, NIST, CSA CCM, Pr, Ir]
const RIESGOS = [
  ['R01', 'Cuentas de usuario', 'Fuerza bruta o credenciales débiles permiten acceso no autorizado', 4, 5,
    'Política de contraseñas (≥10, Aa1); hash scrypt con sal; bloqueo tras 5 intentos (15 min); rate limit 10/min por IP; mensaje de error genérico',
    'A.5.17, A.8.5', 'PR.AA-01/03\nIA-5, AC-7', 'IAM', 1, 5],
  ['R02', 'Datos de incidentes', 'Escalada de privilegios o acceso a registros ajenos (IDOR)', 3, 5,
    'RBAC validado en servidor para cada endpoint; verificación de propiedad del registro; revalidación de rol y estado en BD por petición',
    'A.5.15, A.8.2, A.8.3', 'PR.AA-05\nAC-3, AC-6', 'IAM', 1, 5],
  ['R03', 'Sesiones', 'Robo o falsificación de cookie de sesión', 3, 4,
    'Token firmado HMAC-SHA256; cookie HttpOnly + Secure + SameSite=Strict; expiración 30 min; HTTPS forzado (HSTS)',
    'A.8.5, A.8.24', 'PR.AA-03, PR.DS-02\nAC-12, SC-8, SC-23', 'CEK, IAM', 1, 4],
  ['R04', 'Aplicación web', 'Inyección SQL o XSS', 3, 5,
    'Consultas 100% parametrizadas; render con textContent; Content-Security-Policy sin inline; validación y largo máximo de entradas',
    'A.8.26, A.8.28', 'PR.PS-06\nSI-10', 'AIS', 1, 5],
  ['R05', 'Aplicación web', 'Falsificación de peticiones (CSRF)', 3, 3,
    'Cookie SameSite=Strict + cabecera obligatoria X-Requested-With en peticiones que modifican estado',
    'A.8.28', 'PR.PS-06\nSC-23', 'AIS', 1, 3],
  ['R06', 'Base de datos', 'Exposición de PostgreSQL a Internet', 3, 5,
    'BD solo en red privada (postgres.railway.internal); sin dominio ni proxy TCP público; credenciales por referencia de variable',
    'A.8.20, A.8.22', 'PR.IR-01\nSC-7', 'IVS', 1, 5],
  ['R07', 'Secretos', 'Filtración de secretos (repositorio, logs)', 3, 5,
    'Secretos solo en variables de Railway; .gitignore; repositorio privado; contraseñas nunca se registran en logs',
    'A.5.17, A.8.12, A.8.24', 'PR.DS-01\nIA-5(7), SC-28', 'CEK, DSP', 1, 5],
  ['R08', 'Servicio web', 'Caída de instancia o indisponibilidad durante despliegues', 3, 4,
    '2 réplicas balanceadas; healthcheck /health; reinicio ON_FAILURE (10); despliegue con overlap 20 s y draining 10 s',
    'A.8.14, A.5.30', 'PR.IR-03/04\nCP-10, SC-5', 'BCR', 1, 4],
  ['R09', 'Datos', 'Pérdida o corrupción de datos', 2, 5,
    'Volumen persistente; eliminación solo por admin y auditada; respaldos programados del volumen (acción pendiente: activar)',
    'A.8.13', 'PR.DS-11\nCP-9', 'BCR', 2, 3],
  ['R10', 'Trazabilidad', 'Incidentes no detectados por falta de registros', 3, 3,
    'Log JSON por petición; tabla de auditoría (sin endpoint de borrado); eventos de login, denegaciones y cambios; logs de Railway',
    'A.8.15, A.8.16', 'DE.CM-01/03\nAU-2, AU-3, AU-9', 'LOG', 2, 3],
  ['R11', 'Plataforma cloud', 'Compromiso de cuenta Railway/GitHub del equipo', 2, 5,
    '2FA obligatorio; roles de proyecto mínimos (Viewer/Editor); Owner reservado; repositorio privado',
    'A.5.16, A.5.18, A.5.23', 'PR.AA-01/05\nAC-2, IA-2(1)', 'IAM', 1, 5],
  ['R12', 'Cadena de suministro', 'Dependencias o imagen base vulnerables', 3, 4,
    'Una sola dependencia (pg); npm ci con lockfile; imagen node:22-alpine; npm audit = 0 vulnerabilidades; contenedor sin root',
    'A.8.8, A.8.9', 'ID.RA-01, GV.SC\nRA-5, SR-3', 'TVM', 2, 3],
  ['R13', 'Servicio web', 'Denegación de servicio (DoS)', 3, 4,
    'Proxy de borde de Railway; límite de cuerpo 10 KB; timeouts de petición; rate limit en login; réplicas',
    'A.8.6, A.8.20', 'PR.IR-04\nSC-5', 'IVS', 2, 4],
];

// ---------------------------------------------------------------- portada
const portada = [
  new Paragraph({ spacing: { before: 1200 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'INSTITUTO PROFESIONAL', size: 22, color: '5B6676' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Área Informática, Ciberseguridad y Telecomunicaciones', size: 22, color: '5B6676' })] }),
  new Paragraph({ spacing: { before: 900 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'EVALUACIÓN N°4 — PROYECTO INTEGRADOR', bold: true, size: 26, color: AZUL })] }),
  new Paragraph({ spacing: { before: 200 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Informe Final', bold: true, size: 52, color: AZUL })] }),
  new Paragraph({ spacing: { before: 120 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Implementación de una solución de software en la nube, segura y disponible', size: 30 })] }),
  new Paragraph({ spacing: { before: 120 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Portal de Gestión de Incidentes de Seguridad desplegado en Railway', italics: true, size: 24, color: '5B6676' })] }),
  new Paragraph({ spacing: { before: 900 }, children: [] }),
  tabla(['Campo', 'Detalle'], [
    ['Asignatura', 'Gestión de Seguridad de la Información (TI3V62)'],
    ['Carrera / Sede', 'Ingeniería Informática — Puente Alto'],
    ['Docente', '[Nombre del docente]'],
    ['Integrantes', '[Integrante 1] — Arquitecto/a de solución\n[Integrante 2] — Desarrollador/a\n[Integrante 3] — Especialista en redes/seguridad\n[Integrante 4] — Documentación y pruebas'],
    ['Aplicación desplegada', URL_APP],
    ['Repositorio', REPO],
    ['Fecha', '05 de octubre de 2026'],
  ], [2600, 6760], { size: 20 }),
];

// ---------------------------------------------------------------- 1. descripción
const s1 = [
  H1('1. Descripción de la solución'),
  H2('1.1 Problema que resuelve'),
  P('Las organizaciones medianas y pequeñas suelen registrar sus incidentes de seguridad (phishing, malware, accesos sospechosos, fugas de información) en planillas o correos dispersos. Esto genera tres problemas: **(a)** la información sensible queda expuesta a cualquier persona con acceso a la planilla, **(b)** no existe trazabilidad de quién creó, modificó o consultó cada registro y **(c)** el registro deja de estar disponible justo cuando más se necesita, durante un incidente.'),
  P('El **Portal de Gestión de Incidentes de Seguridad** es una aplicación web desplegada en la nube que centraliza el registro y seguimiento de incidentes. Aplica control de acceso basado en roles, registra cada acción relevante en una bitácora de auditoría y se mantiene disponible ante la caída de una instancia gracias a la redundancia de réplicas.'),
  H2('1.2 Usuarios y roles de negocio'),
  tabla(['Rol', 'Quién lo usa', 'Qué puede hacer'], [
    ['admin', 'Jefatura de seguridad / TI', 'Gestiona usuarios y roles, ve y modifica todos los incidentes, elimina registros, consulta auditoría'],
    ['analista', 'Analista SOC / mesa de ayuda', 'Registra incidentes, ve y actualiza solo los propios'],
    ['auditor', 'Auditoría interna / cumplimiento', 'Lectura de todos los incidentes y de la bitácora de auditoría; no puede crear ni modificar'],
  ], [1500, 2900, 4960]),
  H2('1.3 Requerimientos (ingeniería de software — criterio 4.1.1)'),
  tabla(['ID', 'Requerimiento', 'Tipo', 'Cumplimiento'], [
    ['RF-01', 'Autenticación de usuarios con correo y contraseña', 'Funcional', 'POST /api/login con sesión firmada'],
    ['RF-02', 'Registro y seguimiento de incidentes (severidad, estado)', 'Funcional', 'CRUD /api/incidentes'],
    ['RF-03', 'Administración de usuarios y roles', 'Funcional', '/api/usuarios (solo admin)'],
    ['RF-04', 'Consulta de bitácora de auditoría', 'Funcional', '/api/auditoria (admin, auditor)'],
    ['RNF-01', 'Al menos 2 roles con permisos diferenciados', 'Seguridad', '3 roles con matriz RBAC'],
    ['RNF-02', 'Disponibilidad ante falla de una instancia', 'Disponibilidad', '2 réplicas + healthcheck + reinicio'],
    ['RNF-03', 'Base de datos no expuesta a Internet', 'Seguridad', 'Red privada de Railway'],
    ['RNF-04', 'Registro de accesos y eventos relevantes', 'Trazabilidad', 'Logs JSON + tabla auditoría'],
    ['RNF-05', 'Cifrado en tránsito', 'Seguridad', 'HTTPS/TLS en el borde + HSTS'],
  ], [1000, 4060, 1500, 2800]),
  H2('1.4 Selección de la tecnología cloud (criterio 4.1.2)'),
  P('El enunciado propone AWS, Azure o GCP en capa gratuita; el docente autorizó utilizar **Railway**, una plataforma como servicio (PaaS). La comparación siguiente justifica la elección y deja explícitas sus limitaciones.'),
  tabla(['Criterio', 'Railway (PaaS)', 'AWS / Azure / GCP (IaaS + PaaS)'], [
    ['Modelo de servicio', 'PaaS: el proveedor gestiona SO, red física, balanceo y TLS', 'IaaS: el equipo administra VM, SO, parches, balanceador'],
    ['Tiempo de puesta en marcha', 'Minutos (repositorio GitHub → despliegue)', 'Horas/días (VPC, subredes, ALB, ASG, IAM)'],
    ['Redundancia', 'Réplicas por región con 1 parámetro', 'Auto Scaling Group + balanceador multi-AZ'],
    ['Segmentación de red', 'Red privada por proyecto (*.railway.internal)', 'VPC, subredes, security groups, NACL (más granular)'],
    ['IAM', 'Roles de workspace y de proyecto (Owner/Editor/Viewer), tokens por entorno', 'Políticas JSON muy granulares por recurso y acción'],
    ['Costo', 'Plan Hobby / créditos de prueba', 'Free tier 12 meses, riesgo de cargos (NAT, ALB)'],
    ['Superficie de administración', 'Menor (menos componentes que configurar mal)', 'Mayor (más riesgo de mala configuración)'],
  ], [2300, 3530, 3530]),
  P('**Decisión:** Railway reduce la superficie de configuración y el tiempo de implementación, lo que permite concentrar el esfuerzo del equipo en los controles de la capa que le corresponde (aplicación, identidades, datos), según el modelo de responsabilidad compartida. La menor granularidad de IAM se compensa con un RBAC robusto en la aplicación y con roles de proyecto de mínimo privilegio.'),
  H2('1.5 Formación de roles del equipo'),
  tabla(['Rol del proyecto', 'Integrante', 'Responsabilidades principales'], [
    ['Arquitecto/a de solución', '[Integrante 1]', 'Diseño de capas, selección de Railway, integración app–BD–red, modelo de responsabilidad compartida'],
    ['Desarrollador/a', '[Integrante 2]', 'Aplicación Node.js, RBAC, sesiones, validación de entradas, Dockerfile'],
    ['Especialista en redes/seguridad', '[Integrante 3]', 'IAM de plataforma, red privada, hardening, secretos, matriz de riesgos'],
    ['Documentación y pruebas', '[Integrante 4]', 'Batería de pruebas automatizadas, evidencias, informe final'],
  ], [2600, 1900, 4860]),
];

// ---------------------------------------------------------------- 2. arquitectura
const s2 = [
  H1('2. Arquitectura'),
  P('La solución se organiza en tres capas de seguridad dentro de un proyecto de Railway, más un plano de gestión. Solo la capa de borde es alcanzable desde Internet; la capa de datos únicamente es accesible desde la aplicación a través de la red privada del proyecto.'),
  imagen('arquitectura.png', 620, 360),
  Leyenda('Figura 1. Arquitectura de la solución y capas de seguridad.'),
  H2('2.1 Componentes'),
  tabla(['Capa', 'Componente', 'Descripción y controles'], [
    ['1. Borde (pública)', 'Edge proxy de Railway', `Termina TLS para ${URL_APP.replace('https://', '')}, balancea entre réplicas y absorbe tráfico volumétrico. Único punto de entrada.`],
    ['2. Aplicación', 'Servicio portal-app (2 réplicas)', 'Node.js 22 sin framework (1 dependencia: pg). Imagen Docker alpine ejecutada como usuario no root. RBAC, sesiones HMAC, CSRF, CSP/HSTS, bloqueo de cuentas, logging.'],
    ['3. Datos (privada)', 'PostgreSQL 18 (postgres-ssl)', 'Volumen persistente de 50 GB. Accesible solo en postgres.railway.internal:5432. Sin dominio público ni proxy TCP.'],
    ['Gestión', 'IAM, variables, observabilidad', 'Roles de proyecto Railway, variables cifradas (secretos), logs de despliegue y HTTP, métricas, tabla de auditoría.'],
    ['Origen', 'GitHub (repositorio privado)', 'Cada push a main construye la imagen desde el Dockerfile y despliega automáticamente.'],
  ], [1700, 2300, 5360]),
  H2('2.2 Configuración aplicada en Railway'),
  tabla(['Parámetro', 'Valor', 'Propósito'], [
    ['Proyecto / entorno', 'portal-incidentes-ti3v62 / production', 'Aislamiento del proyecto'],
    ['Región', 'asia-southeast1 (app y BD en la misma región)', 'Latencia mínima app ↔ BD'],
    ['Réplicas portal-app', '2', 'Redundancia y balanceo'],
    ['Healthcheck', '/health (timeout 60 s), verifica conexión a BD', 'Solo réplicas sanas reciben tráfico'],
    ['Política de reinicio', 'ON_FAILURE, máx. 10 reintentos', 'Auto-recuperación'],
    ['Overlap / draining', '20 s / 10 s', 'Despliegues sin corte de servicio'],
    ['Root directory / builder', '/app — Dockerfile', 'Build reproducible'],
    ['DATABASE_URL', '${{Postgres.DATABASE_URL}} (referencia)', 'Credencial nunca escrita en código'],
    ['Postgres: networking', 'privateNetworkEndpoint=postgres; tcpProxies=[]; dominios=[]', 'Segmentación: BD no expuesta'],
  ], [2400, 3860, 3100]),
  H2('2.3 Modelo de responsabilidad compartida'),
  P('En un modelo PaaS la frontera de responsabilidad se desplaza hacia el proveedor en las capas inferiores, pero la seguridad de la aplicación, las identidades y los datos sigue siendo responsabilidad del cliente (CSA Security Guidance, dominio 1; ISO 27001 A.5.23).'),
  tabla(['Capa', 'Railway', 'Equipo del proyecto'], [
    ['Centro de datos, hardware, red física', '●', ''],
    ['Hipervisor, SO del host, orquestación', '●', ''],
    ['Borde: TLS, balanceo, mitigación DDoS L3/L4', '●', ''],
    ['Red privada del proyecto', '● (provee)', '● (decide qué exponer)'],
    ['Imagen del contenedor y dependencias', '', '●'],
    ['Código, RBAC, sesiones, validación', '', '●'],
    ['Identidades y accesos a la plataforma', '● (provee 2FA y roles)', '● (asigna y revisa)'],
    ['Secretos', '● (cifra y almacena)', '● (genera, rota, restringe)'],
    ['Datos y respaldos', '● (provee volúmenes y backups)', '● (programa, prueba restauración)'],
    ['Logging y monitoreo', '● (recolecta)', '● (define eventos y revisa)'],
  ], [4360, 2500, 2500]),
];

// ---------------------------------------------------------------- 3. matriz de riesgos
const s3 = [
  H1('3. Matriz de riesgos'),
  P('La evaluación sigue el proceso de ISO/IEC 27005 y NIST SP 800-30: se identifican activos y amenazas, se estima **probabilidad (P)** e **impacto (I)** en escala 1–5, y se calcula el riesgo inherente (P×I). Luego se aplican controles referenciados a **ISO/IEC 27001:2022 (Anexo A)**, **NIST CSF 2.0 / SP 800-53 Rev.5** y los dominios de la **CSA Cloud Controls Matrix v4**, y se recalcula el riesgo residual.'),
  tabla(['Nivel', 'Rango P×I', 'Tratamiento'], [
    [{ texto: 'Crítico', fill: 'F4C7C3' }, '20 – 25', 'Mitigar antes de salir a producción'],
    [{ texto: 'Alto', fill: 'FCE4D6' }, '10 – 19', 'Mitigar con controles prioritarios'],
    [{ texto: 'Medio', fill: 'FFF2CC' }, '5 – 9', 'Mitigar o aceptar con monitoreo'],
    [{ texto: 'Bajo', fill: 'E2EFDA' }, '1 – 4', 'Aceptar'],
  ], [2000, 2000, 5360]),
  espacio(),
];
const tablaRiesgos = new Table({
  width: { size: ANCHO, type: WidthType.DXA },
  columnWidths: [520, 1500, 900, 2700, 1180, 1300, 560, 700],
  rows: [
    new TableRow({ tableHeader: true, children: ['ID', 'Activo / amenaza', 'Riesgo inherente', 'Controles aplicados', 'ISO 27001:2022', 'NIST CSF / 800-53', 'CSA CCM', 'Riesgo residual']
      .map((h, i) => celda(h, [520, 1500, 900, 2700, 1180, 1300, 560, 700][i], { header: true, size: 15 })) }),
    ...RIESGOS.map((r) => {
      const inh = nivel(r[3] * r[4]);
      const res = nivel(r[9] * r[10]);
      const w = [520, 1500, 900, 2700, 1180, 1300, 560, 700];
      return new TableRow({ cantSplit: true, children: [
        celda(r[0], w[0], { size: 15, bold: true }),
        celda(`**${r[1]}**\n${r[2]}`, w[1], { size: 15 }),
        celda(`P${r[3]}×I${r[4]}\n${inh.t}`, w[2], { size: 15, fill: inh.fill }),
        celda(r[5], w[3], { size: 15 }),
        celda(r[6], w[4], { size: 15 }),
        celda(r[7], w[5], { size: 15 }),
        celda(r[8], w[6], { size: 15 }),
        celda(`P${r[9]}×I${r[10]}\n${res.t}`, w[7], { size: 15, fill: res.fill }),
      ] });
    }),
  ],
});
const promInh = (RIESGOS.reduce((a, r) => a + r[3] * r[4], 0) / RIESGOS.length).toFixed(1);
const promRes = (RIESGOS.reduce((a, r) => a + r[9] * r[10], 0) / RIESGOS.length).toFixed(1);
s3.push(tablaRiesgos, Leyenda('Tabla 3. Matriz de riesgos con controles y riesgo residual.'));
s3.push(P(`**Resultado:** el riesgo inherente promedio baja de **${promInh}** a **${promRes}** después de aplicar los controles. Ningún riesgo residual queda en nivel alto o crítico. Los riesgos residuales medios (R09, R10, R12, R13) se tratan como mejoras en la sección 7.`));

// ---------------------------------------------------------------- 4. IAM
const P_RBAC = [
  ['incidentes:leer_todos', '✔', '✘', '✔'],
  ['incidentes:leer_propios', '(incluido)', '✔', '(incluido)'],
  ['incidentes:crear', '✔', '✔', '✘'],
  ['incidentes:actualizar (todos)', '✔', '✘', '✘'],
  ['incidentes:actualizar_propios', '(incluido)', '✔', '✘'],
  ['incidentes:eliminar', '✔', '✘', '✘'],
  ['usuarios:leer', '✔', '✘', '✘'],
  ['usuarios:gestionar', '✔', '✘', '✘'],
  ['auditoria:leer', '✔', '✘', '✔'],
];
const s4 = [
  H1('4. Configuración IAM'),
  P('La gestión de identidades y accesos se implementa en dos niveles: **(1) plataforma**, que controla quién puede administrar la infraestructura en Railway y GitHub, y **(2) aplicación**, que controla qué puede hacer cada usuario final en el portal. En ambos niveles se aplica el principio de mínimo privilegio (ISO 27001 A.5.15, A.8.2; NIST AC-6).'),
  H2('4.1 Nivel plataforma (Railway y GitHub)'),
  P('Railway no tiene “cuenta raíz” como AWS. Su equivalente es el rol **Owner** del proyecto, que se reserva para la administración y la facturación y no se usa en la operación diaria. Los roles de proyecto disponibles son Owner (administración completa), Editor (despliega y configura, sin acciones destructivas) y Viewer (solo lectura, sin acceso a variables).'),
  tabla(['Integrante / identidad', 'Rol en Railway', 'Acceso GitHub', 'Justificación'], [
    ['Arquitecto/a (titular de la cuenta)', 'Owner + 2FA', 'Admin del repositorio', 'Administración y facturación; uso excepcional'],
    ['Desarrollador/a', 'Editor', 'Write', 'Despliega cambios; no puede borrar servicios'],
    ['Especialista redes/seguridad', 'Editor', 'Write', 'Configura red, variables y réplicas'],
    ['Documentación y pruebas', 'Viewer', 'Read', 'Revisa logs y estado; no ve secretos'],
    ['Docente (revisión)', 'Viewer', 'Read (opcional)', 'Evaluación sin capacidad de cambio'],
    ['Integración GitHub → Railway', 'App autorizada solo al repositorio', '—', 'Despliegue automático sin credenciales personales'],
  ], [2500, 1900, 1700, 3260]),
  P('**Procedimiento:** en Railway → Project Settings → Members, invitar a cada integrante con su rol; en Account → Security, activar 2FA. Para automatizaciones se usan **tokens de proyecto** (alcance de un entorno) en lugar de tokens de cuenta. Las cuentas se revisan al cierre del proyecto y se retiran los accesos (ISO 27001 A.5.18).'),
  H2('4.2 Nivel aplicación: RBAC'),
  P('Los permisos están definidos en una matriz única (src/rbac.js). Cada endpoint verifica el permiso **en el servidor**: ocultar botones en la interfaz es solo una ayuda visual y no constituye un control. En cada petición se revalida en la base de datos que la cuenta siga activa y conserve el mismo rol, de modo que desactivar a un usuario revoca su sesión de inmediato.'),
  tabla(['Permiso', 'admin', 'analista', 'auditor'], P_RBAC.map((r) => [r[0], ...r.slice(1).map((v) => ({ texto: v, align: AlignmentType.CENTER, fill: v === '✔' ? 'E2EFDA' : v === '✘' ? 'FBE5E3' : 'F6F8FB' }))]), [3960, 1800, 1800, 1800]),
  Leyenda('Tabla 4. Matriz RBAC de la aplicación.'),
  H2('4.3 Políticas de autenticación y sesión'),
  tabla(['Política', 'Configuración', 'Referencia'], [
    ['Almacenamiento de contraseñas', 'scrypt (N=16384) con sal aleatoria de 16 bytes; comparación en tiempo constante', 'A.8.24 / IA-5(1)'],
    ['Complejidad', 'Mínimo 10 caracteres, mayúsculas, minúsculas y números; máximo 128', 'A.5.17 / IA-5'],
    ['Bloqueo de cuenta', '5 intentos fallidos → bloqueo 15 minutos (HTTP 423)', 'AC-7'],
    ['Limitación de tasa', '10 intentos de login por minuto por IP (HTTP 429)', 'AC-7, SC-5'],
    ['Sesión', 'Token HMAC-SHA256, expira en 30 min; cookie HttpOnly, Secure, SameSite=Strict', 'AC-12, SC-23'],
    ['Segregación de funciones', 'Un admin no puede modificar su propia cuenta ni rol', 'A.5.3 / AC-5'],
    ['Cuentas iniciales', 'Contraseñas aleatorias generadas fuera del código y entregadas por canal separado', 'A.5.17'],
  ], [2500, 4660, 2200]),
];

// ---------------------------------------------------------------- 5. red y hardening
const s5 = [
  H1('5. Seguridad de red y hardening'),
  H2('5.1 Segmentación'),
  tabla(['Zona', 'Expuesta a Internet', 'Puede comunicarse con', 'Evidencia'], [
    ['Borde (edge proxy)', 'Sí, solo HTTPS 443', 'portal-app', 'Dominio *.up.railway.app'],
    ['Aplicación (portal-app)', 'Solo a través del borde', 'Postgres por red privada', 'describe-service: 1 dominio, 0 proxies TCP'],
    ['Datos (Postgres)', 'No', 'Solo servicios del proyecto', 'describe-service: 0 dominios, 0 proxies TCP'],
  ], [2100, 2100, 2300, 2860]),
  P('El entorno local de pruebas (infra/local/docker-compose.yml) reproduce la misma segmentación con dos redes Docker. La red **privada** está marcada como internal: true, por lo que no tiene salida a Internet. La base de datos solo está conectada a esa red y el balanceador solo a la red pública. Las pruebas automatizadas verifican que el balanceador no alcanza la BD, que la BD no sale a Internet y que no publica puertos al host.'),
  H2('5.2 Medidas de endurecimiento aplicadas'),
  tabla(['Ámbito', 'Medida', 'Referencia'], [
    ['Transporte', 'HTTPS obligatorio en el borde; Strict-Transport-Security 1 año', 'A.8.24 / SC-8'],
    ['Cabeceras HTTP', 'CSP restrictiva (sin scripts inline), X-Frame-Options DENY, nosniff, Referrer-Policy no-referrer, Permissions-Policy, COOP; sin X-Powered-By', 'A.8.9 / CM-6'],
    ['Contenedor', 'node:22-alpine (imagen mínima), usuario no root, solo dependencias de producción (npm ci --omit=dev), HEALTHCHECK', 'A.8.9 / CM-7'],
    ['Contenedor (local)', 'read_only, cap_drop ALL, no-new-privileges', 'CIS Docker Benchmark'],
    ['Aplicación', 'Consultas parametrizadas, límite de cuerpo 10 KB, timeouts, validación y truncado de entradas, errores sin detalles internos', 'A.8.28 / SI-10, SI-11'],
    ['Anti-CSRF', 'SameSite=Strict + cabecera X-Requested-With obligatoria', 'SC-23'],
    ['Secretos', 'Variables de Railway (cifradas); .gitignore; repositorio privado; nada sensible en logs', 'A.8.12 / SC-28'],
    ['Dependencias', '1 dependencia directa (pg), lockfile, npm audit: 0 vulnerabilidades', 'A.8.8 / RA-5'],
    ['Disponibilidad del arranque', 'Migración con pg_advisory_lock para que varias réplicas arranquen a la vez sin conflictos', 'A.8.14'],
  ], [1900, 5360, 2100]),
  H2('5.3 Registro de eventos (logging)'),
  P('Cada petición genera una línea JSON en la salida estándar (timestamp, instancia, método, ruta, estado, latencia, IP, usuario), que Railway centraliza en sus logs de despliegue. Los eventos de seguridad se guardan además en la tabla **auditoria**, que no tiene endpoint de modificación ni de borrado: login_exitoso, login_fallido, cuenta_bloqueada, login_rate_limit, acceso_denegado, incidente_creado/actualizado/eliminado, usuario_creado/actualizado y logout.'),
  imagen('08-auditor-auditoria.png', 600, 351),
  Leyenda('Figura 2. Bitácora de auditoría vista por el rol auditor: intentos fallidos, bloqueo de cuenta y la réplica que atendió cada evento.'),
];

// ---------------------------------------------------------------- 6. pruebas
const GRUPO_NIST = {
  disponibilidad: 'CP-10, SC-5', hardening: 'CM-6, SC-8', autenticacion: 'IA-2, IA-5, AC-7, AC-12',
  rbac: 'AC-3, AC-6', csrf: 'SC-23', inyeccion: 'SI-10', logging: 'AU-2, AU-3', red: 'SC-7',
};
function resumenGrupos(ev) {
  const g = {};
  for (const r of ev.resultados) { g[r.grupo] = g[r.grupo] || { n: 0, ok: 0 }; g[r.grupo].n++; if (r.ok) g[r.grupo].ok++; }
  return g;
}
const gl = resumenGrupos(evLocal);
const gr = resumenGrupos(evRailway);
const totL = evLocal.resultados.length; const okL = evLocal.resultados.filter((r) => r.ok).length;
const totR = evRailway.resultados.length; const okR = evRailway.resultados.filter((r) => r.ok).length;
const failover = evLocal.resultados.find((r) => r.nombre.startsWith('Servicio sigue respondiendo'));
const balanceo = evRailway.resultados.find((r) => r.nombre.startsWith('Peticiones distribuidas'));
const fechaR = new Date(evRailway.fecha).toLocaleString('es-CL', { timeZone: 'America/Santiago' });

const s6 = [
  H1('6. Pruebas de disponibilidad y validación de seguridad'),
  P('El procedimiento de validación (criterio 4.1.5) se automatizó en el script pruebas/pruebas.js, que ejecuta peticiones reales contra la aplicación y compara el resultado esperado con el obtenido. Se ejecutó en dos ambientes: **local**, donde se pueden provocar fallas de infraestructura con Docker, y **producción en Railway**. Cada grupo de pruebas está asociado al control NIST SP 800-53 que valida.'),
  H2('6.1 Resumen de resultados'),
  tabla(['Grupo de pruebas', 'Control NIST', 'Local (Docker)', 'Railway (producción)'],
    Object.keys(GRUPO_NIST).map((k) => [k, GRUPO_NIST[k],
      gl[k] ? { texto: `${gl[k].ok}/${gl[k].n}`, align: AlignmentType.CENTER, fill: gl[k].ok === gl[k].n ? 'E2EFDA' : 'FBE5E3' } : { texto: '—', align: AlignmentType.CENTER },
      gr[k] ? { texto: `${gr[k].ok}/${gr[k].n}`, align: AlignmentType.CENTER, fill: gr[k].ok === gr[k].n ? 'E2EFDA' : 'FBE5E3' } : { texto: 'n/a (solo local)', align: AlignmentType.CENTER }])
      .concat([[{ texto: 'TOTAL', bold: true }, '', { texto: `${okL}/${totL}`, bold: true, align: AlignmentType.CENTER, fill: 'E2EFDA' }, { texto: `${okR}/${totR}`, bold: true, align: AlignmentType.CENTER, fill: 'E2EFDA' }]]),
    [2600, 2560, 2100, 2100]),
  P(`Ejecución en Railway: ${fechaR} (hora de Chile), contra ${URL_APP}.`),
  H2('6.2 Pruebas de disponibilidad'),
  tabla(['Prueba', 'Procedimiento', 'Resultado esperado', 'Resultado obtenido'], [
    ['D1. Balanceo entre réplicas (Railway)', '40 peticiones a /health registrando la réplica que responde', 'Tráfico repartido en ≥ 2 réplicas', `${balanceo.obtenido} réplicas: ${balanceo.detalle}`],
    ['D2. Despliegue sin corte (Railway)', `Tráfico continuo durante ${evRedeploy.duracion_s} s (1 petición cada 250 ms) mientras se ejecuta un redeploy del servicio`, 'Disponibilidad ≥ 99 %', `${evRedeploy.disponibilidad_pct} % — ${evRedeploy.ok} OK / ${evRedeploy.fallo} fallos; se reemplazaron las 2 réplicas por 2 nuevas sin interrupción`],
    ['D3. Caída de una réplica (local)', 'Tráfico continuo durante 20 s; a los 3 s se detiene app1 (docker stop)', 'Disponibilidad ≥ 99 %', `${failover.obtenido}; reparto ${failover.detalle}`],
    ['D4. Recuperación (local)', 'Se reinicia app1 y se verifica que vuelva al pool', 'Ambas réplicas atienden', evLocal.resultados.find((r) => r.nombre.startsWith('Réplica recuperada')).obtenido],
    ['D5. Healthcheck', 'GET /health valida la conexión a la base de datos', 'HTTP 200 {"db":"ok"}', 'HTTP 200 en ambos ambientes'],
  ], [2000, 2860, 1800, 2700]),
  P('**Secuencia observada en D2** (cambio de réplicas durante el redeploy): ' + evRedeploy.eventos.join(' → ') + '.'),
  H2('6.3 Detalle de pruebas de seguridad en producción'),
  tabla(['Prueba', 'Esperado', 'Obtenido', 'OK'],
    evRailway.resultados.filter((r) => r.grupo !== 'disponibilidad').map((r) => [r.nombre, String(r.esperado), String(r.obtenido).slice(0, 60), { texto: r.ok ? '✔' : '✘', align: AlignmentType.CENTER, fill: r.ok ? 'E2EFDA' : 'FBE5E3' }]),
    [4400, 1900, 2460, 600], { size: 16 }),
  H2('6.4 Evidencia visual'),
  imagen('01-login.png', 560, 328), Leyenda('Figura 3. Pantalla de inicio de sesión (producción).'),
  imagen('02-login-fallido.png', 560, 328), Leyenda('Figura 4. Intento con credenciales inválidas: mensaje genérico que no revela si el usuario existe.'),
  imagen('03-admin-incidentes.png', 560, 328), Leyenda('Figura 5. Rol admin: ve todos los incidentes, cambia su estado y puede eliminarlos.'),
  imagen('04-admin-usuarios.png', 560, 328), Leyenda('Figura 6. Rol admin: gestión de usuarios; una cuenta aparece bloqueada tras 5 intentos fallidos.'),
  imagen('06-analista-incidentes.png', 560, 328), Leyenda('Figura 7. Rol analista: solo ve la pestaña Incidentes y únicamente sus propios registros.'),
  imagen('07-auditor-incidentes.png', 560, 328), Leyenda('Figura 8. Rol auditor: lectura de todos los incidentes, sin formularios de creación ni acciones.'),
];

// ---------------------------------------------------------------- 7. conclusiones
const s7 = [
  H1('7. Conclusiones'),
  H2('7.1 Evaluación de la seguridad de la solución (criterio 4.1.6)'),
  tabla(['Requisito mínimo del enunciado', 'Estado', 'Evidencia'], [
    ['Aplicación web funcional desplegada en la nube', { texto: 'Cumple', fill: 'E2EFDA' }, URL_APP],
    ['≥ 2 roles con permisos diferenciados', { texto: 'Cumple', fill: 'E2EFDA' }, '3 roles; 14/14 pruebas RBAC'],
    ['IAM propio, sin cuenta raíz para operación diaria', { texto: 'Cumple*', fill: 'FFF2CC' }, 'Roles Owner/Editor/Viewer (sección 4.1). *Requiere invitar a los integrantes'],
    ['Segmentación o aislamiento de componentes', { texto: 'Cumple', fill: 'E2EFDA' }, 'BD solo en red privada; 3/3 pruebas de red'],
    ['≥ 1 medida de disponibilidad', { texto: 'Cumple', fill: 'E2EFDA' }, `2 réplicas + healthcheck + reinicio; ${evRedeploy.disponibilidad_pct} % en redeploy`],
    ['Logging de accesos y eventos', { texto: 'Cumple', fill: 'E2EFDA' }, 'Logs JSON + tabla de auditoría; 5/5 pruebas'],
    ['Informe con matriz de riesgos, controles y pruebas', { texto: 'Cumple', fill: 'E2EFDA' }, 'Secciones 3, 5 y 6'],
  ], [3600, 1300, 4460]),
  P('Respecto de la **estrategia de gobierno TI**, la solución contribuye a los objetivos de COBIT 2019 APO13 (Gestionar la seguridad) y DSS05 (Gestionar servicios de seguridad), porque centraliza la gestión de incidentes con trazabilidad, y a DSS04 (Gestionar la continuidad), porque mantiene el servicio disponible ante fallas. Las decisiones de riesgo quedan documentadas y son revisables, lo que habilita su incorporación a un SGSI basado en ISO 27001 (cláusulas 6.1.2 y 8.2).'),
  H2('7.2 Aprendizajes del equipo'),
  B('**La seguridad no se delega por completo al proveedor.** Railway resuelve TLS, balanceo y aislamiento físico, pero el RBAC, la gestión de sesiones, la validación de entradas y la decisión de no exponer la base de datos dependen del equipo.'),
  B('**Un control solo existe si se puede probar.** Automatizar 43 pruebas permitió detectar dos supuestos incorrectos durante la validación (un puerto ocupado por otro proceso del equipo y el tiempo de reincorporación del balanceador) y corregirlos con evidencia.'),
  B('**La disponibilidad se diseña desde la aplicación.** Para que dos réplicas funcionen se necesitaron sesiones sin estado (firmadas), migraciones con bloqueo y un healthcheck que verifique la base de datos.'),
  B('**El mínimo privilegio se aplica en todos los niveles:** usuarios de la app, integrantes en la plataforma y el proceso del contenedor (no root).'),
  H2('7.3 Mejoras futuras'),
  tabla(['Mejora', 'Riesgo que reduce', 'Prioridad'], [
    ['Activar respaldos programados diarios del volumen de Postgres y probar una restauración', 'R09', 'Alta'],
    ['Base de datos en alta disponibilidad (plantilla postgres-ha: réplicas con failover automático)', 'R08, R09', 'Media'],
    ['MFA (TOTP) para los roles admin y auditor en la aplicación', 'R01, R02', 'Media'],
    ['Enviar logs a un SIEM y crear alertas ante ráfagas de login_fallido o acceso_denegado', 'R10', 'Media'],
    ['WAF y dominio propio (p. ej. Cloudflare) con reglas OWASP', 'R04, R13', 'Media'],
    ['Pipeline CI que ejecute pruebas, npm audit y escaneo de imagen antes de cada despliegue', 'R12', 'Media'],
    ['Mover el servicio a una región más cercana a Chile (p. ej. us-east) para reducir latencia', '—', 'Baja'],
    ['Rate limiting compartido entre réplicas (actualmente por réplica)', 'R01, R13', 'Baja'],
  ], [5560, 1900, 1900]),
];

// ---------------------------------------------------------------- anexo
const anexo = [
  H1('Anexo A. Estructura del repositorio y reproducción'),
  tabla(['Ruta', 'Contenido'], [
    ['app/src/server.js', 'Servidor HTTP, rutas, autenticación, autorización, logging'],
    ['app/src/rbac.js', 'Matriz de roles y permisos'],
    ['app/src/seguridad.js', 'scrypt, política de contraseñas, tokens HMAC'],
    ['app/src/db.js', 'Esquema, migración con advisory lock, usuarios iniciales'],
    ['app/public/', 'Interfaz web (HTML, JS sin inline, CSS)'],
    ['app/Dockerfile', 'Imagen endurecida (alpine, no root)'],
    ['app/test/', 'Pruebas unitarias (node --test)'],
    ['infra/local/', 'docker-compose con balanceador nginx, 2 réplicas y red interna'],
    ['pruebas/pruebas.js', 'Batería de pruebas de seguridad y disponibilidad'],
    ['pruebas/trafico-redeploy.js', 'Medición de disponibilidad durante un redeploy'],
    ['pruebas/evidencia-*.json|txt', 'Resultados de las ejecuciones usados en este informe'],
  ], [3200, 6160]),
  espacio(),
  P('**Reproducir localmente:** cd infra/local && docker compose up -d --build; luego node pruebas/pruebas.js http://localhost:8080 evidencia-local --local.'),
  P('**Probar producción:** ADMIN_PASS=… ANALISTA_PASS=… AUDITOR_PASS=… node pruebas/pruebas.js ' + URL_APP + ' evidencia-railway.'),
  P('**Credenciales de demostración:** se entregan al docente por un canal separado y no se incluyen en este documento ni en el repositorio (ISO 27001 A.5.17).'),
];

// ---------------------------------------------------------------- documento
const doc = new Document({
  creator: 'Equipo Proyecto Integrador TI3V62',
  title: 'Informe Final — Proyecto Integrador TI3V62',
  description: 'Implementación de una solución de software en la nube, segura y disponible',
  features: { updateFields: true },
  styles: {
    default: { document: { run: { font: FUENTE, size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, color: AZUL, font: FUENTE }, paragraph: { spacing: { before: 240, after: 200 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, color: AZUL, font: FUENTE }, paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 23, bold: true, color: '2E5C8A', font: FUENTE }, paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'vinetas', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } },
        { level: 1, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1080, hanging: 270 } } } }] },
      { reference: 'numeros', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 300 } } } }] },
    ],
  },
  sections: [
    {
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } }, titlePage: true },
      headers: {
        default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'C9D1DC', space: 4 } },
          children: [new TextRun({ text: 'TI3V62 · Proyecto Integrador · Informe Final', size: 16, color: '5B6676' })] })] }),
        first: new Header({ children: [new Paragraph({ children: [] })] }),
      },
      footers: {
        default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Página ', size: 16, color: '5B6676' }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '5B6676' }), new TextRun({ text: ' de ', size: 16, color: '5B6676' }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '5B6676' })] })] }),
        first: new Footer({ children: [new Paragraph({ children: [] })] }),
      },
      children: [
        ...portada,
        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({ children: [new TextRun({ text: 'Índice', bold: true, size: 32, color: AZUL })], spacing: { after: 200 } }),
        new TableOfContents('Índice', { hyperlink: true, headingStyleRange: '1-2' }),
        ...s1, ...s2, ...s3, ...s4, ...s5, ...s6, ...s7, ...anexo,
      ],
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  const salida = path.join(__dirname, 'Informe-Final-Proyecto-Integrador-TI3V62.docx');
  fs.writeFileSync(salida, buf);
  console.log('generado', salida, buf.length, 'bytes');
});
