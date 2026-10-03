// Borra y recrea ambas bases con el esquema y los datos de prueba.
// Uso: pnpm db:reset
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';
import { MongoClient } from 'mongodb';
import { config } from '../src/config.js';
import { colecciones, crearColecciones } from '../db/mongo/setup.js';

const SQL_DIR = new URL('../db/postgres/', import.meta.url);

async function resetPostgres() {
  const admin = new pg.Client({ database: 'postgres' });
  await admin.connect();
  const nombre = admin.escapeIdentifier(config.pg.database);
  await admin.query(`DROP DATABASE IF EXISTS ${nombre} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${nombre} ENCODING 'UTF8' TEMPLATE template0`);
  await admin.end();

  const client = new pg.Client({ database: config.pg.database });
  await client.connect();
  try {
    const archivos = (await readdir(SQL_DIR)).filter((f) => f.endsWith('.sql')).sort();
    for (const archivo of archivos) {
      await client.query(await readFile(new URL(archivo, SQL_DIR), 'utf8'));
      console.log(`  ✓ ${archivo}`);
    }
    const { rows: [conteo] } = await client.query(`
      SELECT (SELECT count(*) FROM curso)::int         AS cursos,
             (SELECT count(*) FROM representante)::int AS representantes,
             (SELECT count(*) FROM alumno)::int        AS alumnos,
             (SELECT count(*) FROM matricula)::int     AS matriculas,
             (SELECT count(*) FROM mensualidad)::int   AS mensualidades,
             (SELECT count(*) FROM v_morosos)::int     AS morosos`);
    console.log('  ', conteo);
  } finally {
    await client.end();
  }
}

async function resetMongo() {
  const client = new MongoClient(config.mongo.url, { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  try {
    const db = client.db(config.mongo.db);
    await db.dropDatabase();
    await crearColecciones(db);
    for (const { name, indexes } of colecciones) {
      console.log(`  ✓ ${name} (validador + ${indexes.length} índices, vacía)`);
    }
  } finally {
    await client.close();
  }
}

console.log(`PostgreSQL → ${config.pg.database}`);
await resetPostgres();
console.log(`MongoDB → ${config.mongo.db}`);
await resetMongo();
console.log('Listo.');
