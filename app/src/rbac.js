'use strict';
// Matriz de control de acceso basado en roles (RBAC).
// Principio de mínimo privilegio: cada rol recibe solo los permisos que su función requiere
// (ISO 27001 A.5.15 / A.8.2 — NIST SP 800-53 AC-2, AC-3, AC-6).

const ROLES = ['admin', 'analista', 'auditor'];

const PERMISOS = {
  admin: [
    'incidentes:leer_todos', 'incidentes:crear', 'incidentes:actualizar', 'incidentes:eliminar',
    'usuarios:leer', 'usuarios:gestionar',
    'auditoria:leer',
  ],
  analista: [
    'incidentes:leer_propios', 'incidentes:crear', 'incidentes:actualizar_propios',
  ],
  auditor: [
    'incidentes:leer_todos',
    'auditoria:leer',
  ],
};

function tienePermiso(rol, permiso) {
  return Boolean(PERMISOS[rol] && PERMISOS[rol].includes(permiso));
}

module.exports = { ROLES, PERMISOS, tienePermiso };
