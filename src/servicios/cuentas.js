// R3 y R4 · Estado de cuenta y morosos. Todo sale de v_saldo_mensualidad,
// la única fuente de verdad del saldo.
import { pool } from '../db/pg.js';
import { notificaciones } from '../db/mongo.js';
import { ErrorApp } from '../errores.js';
import { esMismaMora } from './mora.js';

const MENSUALIDADES = `
  SELECT s.id_mensualidad, s.id_alumno, a.nombres AS alumno, c.nombre AS curso,
         s.anio, s.mes, s.valor_total, s.pagado, s.saldo, s.fecha_vencimiento, s.estado_pago, s.dias_vencida
    FROM v_saldo_mensualidad s
    JOIN alumno a USING (id_alumno)
    JOIN v_curso c USING (id_curso)`;

const RESUMEN = `
  SELECT COALESCE(sum(total_cargado), 0)::numeric(10, 2) AS total_cargado,
         COALESCE(sum(total_pagado), 0)::numeric(10, 2) AS total_pagado,
         COALESCE(sum(saldo_total), 0)::numeric(10, 2) AS saldo_total,
         COALESCE(sum(saldo_vencido), 0)::numeric(10, 2) AS saldo_vencido,
         CASE WHEN bool_or(situacion = 'en_mora') THEN 'en_mora' ELSE 'al_dia' END AS situacion
    FROM v_estado_cuenta_alumno`;

export async function estadoCuentaRepresentante(id) {
  const { rows: [representante] } = await pool.query(
    'SELECT id_representante, cedula, nombres, telefono, correo FROM representante WHERE id_representante = $1',
    [id],
  );
  if (!representante) throw new ErrorApp(404, `No existe el representante ${id}`);

  const [resumen, alumnos, mensualidades, pagos] = await Promise.all([
    pool.query(`${RESUMEN} WHERE id_representante = $1`, [id]),
    pool.query('SELECT * FROM v_estado_cuenta_alumno WHERE id_representante = $1 ORDER BY alumno', [id]),
    pool.query(`${MENSUALIDADES} WHERE s.id_representante = $1 ORDER BY s.fecha_vencimiento, a.nombres, c.nombre`, [id]),
    pool.query(`
      SELECT p.id_pago, p.fecha_pago, m.nombre AS metodo, p.valor_total, p.estado, p.ref_comprobante
        FROM pago p
        JOIN metodo_pago m USING (id_metodo_pago)
       WHERE p.id_representante = $1
       ORDER BY p.fecha_pago DESC`, [id]),
  ]);

  return {
    representante,
    resumen: resumen.rows[0],
    alumnos: alumnos.rows,
    mensualidades: mensualidades.rows,
    pagos: pagos.rows,
  };
}

// La mora sale de PostgreSQL; el último aviso de cada
// representante sale de MongoDB. La respuesta combina ambos motores.
export async function listarMorosos() {
  const { rows: morosos } = await pool.query('SELECT * FROM v_morosos ORDER BY deuda_vencida DESC, nombres');

  const ultimos = await notificaciones.aggregate([
    { $match: { id_representante: { $in: morosos.map((m) => m.id_representante) } } },
    { $sort: { id_representante: 1, fecha_aviso: -1 } },
    { $group: { _id: '$id_representante', ultimo: { $first: '$$ROOT' } } },
  ]).toArray();
  const ultimoPorRepresentante = new Map(ultimos.map((u) => [u._id, u.ultimo]));

  return morosos.map((m) => {
    const ultimo = ultimoPorRepresentante.get(m.id_representante);
    return {
      ...m,
      ultimo_aviso: ultimo && {
        _id: ultimo._id,
        nivel: ultimo.nivel,
        canal: ultimo.canal,
        fecha_aviso: ultimo.fecha_aviso,
        estado: ultimo.estado,
        misma_mora: esMismaMora(ultimo, m.ids_mensualidades_vencidas),
      },
    };
  });
}
