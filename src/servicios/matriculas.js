import { pool } from '../db/pg.js';

export async function matricular({ id_alumno, id_curso, fecha }) {
  const { rows: [matricula] } = await pool.query(
    'SELECT * FROM fn_matricular($1, $2, COALESCE($3::date, current_date))',
    [id_alumno, id_curso, fecha],
  );

  const { rows: mensualidades } = await pool.query(`
    SELECT id_mensualidad, anio, mes, valor_total, fecha_vencimiento, estado_pago
      FROM v_saldo_mensualidad
     WHERE id_matricula = $1
     ORDER BY anio, mes`,
  [matricula.id_matricula_nueva]);

  return {
    id_matricula: matricula.id_matricula_nueva,
    mensualidades_generadas: matricula.mensualidades_generadas,
    mensualidades,
  };
}
