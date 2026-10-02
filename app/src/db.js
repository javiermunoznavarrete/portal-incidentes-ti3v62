'use strict';
// Acceso a PostgreSQL. Todas las consultas son parametrizadas (prevención de inyección SQL, OWASP A03).
const { Pool } = require('pg');
const { hashPassword } = require('./seguridad');

const MIGRACION = `
CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('admin','analista','auditor')),
  password_hash TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  intentos_fallidos INT NOT NULL DEFAULT 0,
  bloqueado_hasta TIMESTAMPTZ,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS incidentes (
  id SERIAL PRIMARY KEY,
  titulo TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  severidad TEXT NOT NULL CHECK (severidad IN ('baja','media','alta','critica')),
  estado TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','en_analisis','contenido','cerrado')),
  creado_por INT NOT NULL REFERENCES usuarios(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auditoria (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  evento TEXT NOT NULL,
  usuario_id INT,
  email TEXT,
  rol TEXT,
  ip TEXT,
  detalle TEXT,
  instancia TEXT
);
CREATE INDEX IF NOT EXISTS auditoria_ts_idx ON auditoria (ts DESC);
`;

function crearPool(databaseUrl) {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}

// Migración + usuarios semilla protegidos por advisory lock: varias réplicas pueden arrancar a la vez.
async function inicializar(pool, semillas) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727001)');
    await client.query(MIGRACION);
    const { rows } = await client.query('SELECT count(*)::int AS n FROM usuarios');
    if (rows[0].n === 0) {
      for (const s of semillas) {
        if (!s.password) continue;
        await client.query(
          'INSERT INTO usuarios (email, nombre, rol, password_hash) VALUES ($1,$2,$3,$4)',
          [s.email, s.nombre, s.rol, hashPassword(s.password)],
        );
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
    client.release();
  }
}

module.exports = { crearPool, inicializar };
