// R2 · Registro de pagos. PostgreSQL primero (transacción ACID), MongoDB
// después: el comprobante no participa en la transacción.
import { config } from '../config.js';
import { pool } from '../db/pg.js';
import { ErrorApp, traducirError } from '../errores.js';
import { buscarPorPago, guardarComprobante } from './comprobantes.js';

export async function registrarPago(
  { id_representante, id_metodo_pago, valor_total, desglose, comprobante },
  usuario = config.usuarioAdministrativo,
) {
  // 1. PostgreSQL: pago + desglose en una sola llamada. Al volver ya hizo COMMIT.
  const { rows: [{ id_pago }] } = await pool.query(
    `SELECT fn_registrar_pago($1, $2, (SELECT id_usuario FROM usuario WHERE usuario = $3), $4, $5) AS id_pago`,
    [id_representante, id_metodo_pago, usuario, valor_total, JSON.stringify(desglose)],
  );

  // 2. MongoDB: comprobante. Si falla, el pago queda pendiente_comprobante
  //    (visible en PostgreSQL) y se puede adjuntar después.
  let error_comprobante = null;
  const pago = await leerPago(id_pago);
  if (pago.estado === 'pendiente_comprobante') {
    try {
      await adjuntarComprobante(id_pago, comprobante, usuario);
    } catch (err) {
      error_comprobante = traducirError(err).cuerpo;
    }
  }

  return { ...(await obtenerPago(id_pago)), error_comprobante };
}

export async function adjuntarComprobante(id_pago, entrada, usuario = config.usuarioAdministrativo) {
  const pago = await leerPago(id_pago);
  if (pago.estado === 'confirmado') {
    throw new ErrorApp(409, `El pago ${id_pago} ya tiene su comprobante`);
  }

  const documento = await guardarComprobante(pago, entrada, usuario);
  await pool.query(
    `UPDATE pago SET estado = 'confirmado', ref_comprobante = $2
      WHERE id_pago = $1 AND estado = 'pendiente_comprobante'`,
    [id_pago, documento._id.toHexString()],
  );
  return documento;
}

// Vista de evidencia: qué guardó cada motor para un mismo pago.
export async function obtenerPago(id_pago) {
  const { rows: [pago] } = await pool.query(`
    SELECT p.id_pago, p.id_representante, r.nombres AS representante, p.fecha_pago, m.nombre AS metodo,
           p.valor_total, p.estado, p.ref_comprobante, u.usuario AS registrado_por
      FROM pago p
      JOIN representante r USING (id_representante)
      JOIN metodo_pago m USING (id_metodo_pago)
      JOIN usuario u USING (id_usuario)
     WHERE p.id_pago = $1`, [id_pago]);
  if (!pago) throw new ErrorApp(404, `No existe el pago ${id_pago}`);

  const [{ rows: detalle }, comprobante] = await Promise.all([
    pool.query(`
      SELECT d.id_mensualidad, a.nombres AS alumno, c.nombre AS curso, s.anio, s.mes,
             d.valor_aplicado, s.saldo AS saldo_actual
        FROM detalle_pago d
        JOIN v_saldo_mensualidad s USING (id_mensualidad)
        JOIN alumno a ON a.id_alumno = s.id_alumno
        JOIN v_curso c ON c.id_curso = s.id_curso
       WHERE d.id_pago = $1
       ORDER BY d.id_mensualidad`, [id_pago]),
    buscarPorPago(id_pago),
  ]);

  return { postgresql: { pago, detalle }, mongodb: { comprobante } };
}

async function leerPago(id_pago) {
  const { rows: [pago] } = await pool.query(`
    SELECT p.id_pago, p.id_representante, m.nombre AS metodo, p.valor_total, p.estado
      FROM pago p
      JOIN metodo_pago m USING (id_metodo_pago)
     WHERE p.id_pago = $1`, [id_pago]);
  if (!pago) throw new ErrorApp(404, `No existe el pago ${id_pago}`);
  return pago;
}
