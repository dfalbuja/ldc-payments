import { pool } from '../db/pg.js';
import { CAMPOS_COMPROBANTE } from './comprobantes.js';

export async function obtenerCatalogos() {
  const [cursos, alumnos, representantes, metodos] = await Promise.all([
    pool.query(`
      SELECT id_curso, nombre, edad_min, edad_max, horario, cupo_maximo, ocupados, valor_mensual
        FROM v_curso
       ORDER BY nombre`),
    pool.query(`
      SELECT a.id_alumno, a.nombres, date_part('year', age(a.fecha_nacimiento))::integer AS edad,
             a.id_representante, r.nombres AS representante
        FROM alumno a
        JOIN representante r USING (id_representante)
       WHERE a.estado = 'activo'
       ORDER BY a.nombres`),
    pool.query(`
      SELECT id_representante, cedula, nombres, telefono, correo
        FROM representante
       ORDER BY nombres`),
    pool.query(`
      SELECT id_metodo_pago, nombre, requiere_comprobante
        FROM metodo_pago
       ORDER BY id_metodo_pago`),
  ]);

  return {
    cursos: cursos.rows,
    alumnos: alumnos.rows,
    representantes: representantes.rows,
    metodos_pago: metodos.rows.map((m) => ({ ...m, campos_comprobante: CAMPOS_COMPROBANTE[m.nombre] ?? [] })),
  };
}
