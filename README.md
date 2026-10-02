# Portal de Gestión de Incidentes de Seguridad — Proyecto Integrador TI3V62

Aplicación web segura y disponible desplegada en **Railway**.

- Producción: https://portal-app-production-1269.up.railway.app
- Informe final: `informe/Informe-Final-Proyecto-Integrador-TI3V62.docx`

## Estructura
| Ruta | Contenido |
|---|---|
| `app/` | Aplicación Node.js (RBAC, sesiones HMAC, auditoría) + Dockerfile |
| `infra/local/` | docker-compose: nginx + 2 réplicas + Postgres en red interna |
| `pruebas/` | Batería de pruebas de seguridad/disponibilidad y evidencias |
| `informe/` | Generador del informe, diagrama y capturas |

## Uso
```bash
# Local
cd infra/local && docker compose up -d --build
node pruebas/pruebas.js http://localhost:8080 pruebas/evidencia-local --local

# Producción (credenciales entregadas por canal separado)
ADMIN_PASS=... ANALISTA_PASS=... AUDITOR_PASS=... node pruebas/pruebas.js https://portal-app-production-1269.up.railway.app pruebas/evidencia-railway

# Regenerar informe
cd informe && npm install && node generar-informe.js
```
