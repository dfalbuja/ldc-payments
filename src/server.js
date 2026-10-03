import { app } from './app.js';
import { config } from './config.js';
import { pool } from './db/pg.js';
import { cerrarMongo, conectarMongo } from './db/mongo.js';

try {
  await pool.query('SELECT 1 FROM pago LIMIT 1');
} catch (err) {
  console.error(`No se pudo usar PostgreSQL (${err.message}). ¿Está corriendo y ejecutaste "pnpm db:reset"?`);
  process.exit(1);
}
try {
  await conectarMongo();
} catch (err) {
  console.error(`No se pudo conectar a MongoDB en ${config.mongo.url} (${err.message}).`);
  process.exit(1);
}

const servidor = app.listen(config.port, () => {
  console.log(`LDC Payments en http://localhost:${config.port}`);
});
servidor.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE'
    ? `El puerto ${config.port} está ocupado por otra aplicación. Cambia PORT en .env.`
    : err.message);
  process.exit(1);
});

async function cerrar() {
  servidor.close();
  await Promise.all([pool.end(), cerrarMongo()]);
  process.exit(0);
}
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);
