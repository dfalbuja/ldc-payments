// Proceso programado de mora (actor de sistema), ejecutable a mano o desde cron.
// Uso: pnpm mora                       → corre con la fecha de hoy
//      pnpm mora --fecha 2026-10-08    → simula que corre ese día
import { parseArgs } from 'node:util';
import { pool } from '../src/db/pg.js';
import { cerrarMongo, conectarMongo } from '../src/db/mongo.js';
import { ejecutarProcesoMora } from '../src/servicios/mora.js';

const { values } = parseArgs({ options: { fecha: { type: 'string' } } });

await conectarMongo();
try {
  const { fecha_ejecucion, morosos_revisados, resultados } = await ejecutarProcesoMora({ fecha: values.fecha });
  console.log(`Proceso de mora · ${fecha_ejecucion.toISOString().slice(0, 10)} · ${morosos_revisados} morosos revisados`);
  console.table(resultados.map((r) => ({
    representante: r.representante,
    deuda: r.deuda_vencida,
    accion: r.accion,
    detalle: r.accion === 'notificado' ? `nivel ${r.nivel} por ${r.canal} a ${r.destino}` : r.motivo,
  })));
} finally {
  await Promise.all([pool.end(), cerrarMongo()]);
}
