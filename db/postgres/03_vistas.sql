-- =====================================================================
-- Única fuente de verdad del saldo (R3 y R4).
-- El estado de cuenta y el reporte de morosos leen de v_saldo_mensualidad,
-- así nunca se contradicen. El saldo no se guarda: se deriva del desglose.
-- =====================================================================

CREATE VIEW v_saldo_mensualidad AS
SELECT m.id_mensualidad,
       m.id_matricula,
       mt.id_alumno,
       a.id_representante,
       mt.id_curso,
       m.anio,
       m.mes,
       m.valor_total,
       m.fecha_vencimiento,
       p.pagado,
       m.valor_total - p.pagado AS saldo,
       CASE
         WHEN m.estado = 'anulada' THEN 'anulada'
         WHEN m.valor_total - p.pagado = 0 THEN 'pagada'
         WHEN m.fecha_vencimiento < current_date THEN 'vencida'
         WHEN p.pagado > 0 THEN 'parcial'
         ELSE 'pendiente'
       END AS estado_pago,
       CASE
         WHEN m.estado = 'vigente' AND m.valor_total > p.pagado AND m.fecha_vencimiento < current_date
         THEN current_date - m.fecha_vencimiento
         ELSE 0
       END AS dias_vencida
  FROM mensualidad m
  JOIN matricula mt USING (id_matricula)
  JOIN alumno a USING (id_alumno)
  CROSS JOIN LATERAL (
    SELECT COALESCE(sum(d.valor_aplicado), 0)::numeric(10, 2) AS pagado
      FROM detalle_pago d
     WHERE d.id_mensualidad = m.id_mensualidad
  ) p;

-- Problema (1): saber rápido si un alumno está al día o en mora.
CREATE VIEW v_estado_cuenta_alumno AS
SELECT a.id_alumno,
       a.nombres AS alumno,
       a.id_representante,
       COALESCE(sum(s.valor_total) FILTER (WHERE s.estado_pago <> 'anulada'), 0)::numeric(10, 2) AS total_cargado,
       COALESCE(sum(s.pagado), 0)::numeric(10, 2) AS total_pagado,
       COALESCE(sum(s.saldo) FILTER (WHERE s.estado_pago <> 'anulada'), 0)::numeric(10, 2) AS saldo_total,
       COALESCE(sum(s.saldo) FILTER (WHERE s.estado_pago = 'vencida'), 0)::numeric(10, 2) AS saldo_vencido,
       count(*) FILTER (WHERE s.estado_pago = 'vencida') AS mensualidades_vencidas,
       CASE WHEN count(*) FILTER (WHERE s.estado_pago = 'vencida') > 0 THEN 'en_mora' ELSE 'al_dia' END AS situacion
  FROM alumno a
  LEFT JOIN v_saldo_mensualidad s USING (id_alumno)
 GROUP BY a.id_alumno, a.nombres, a.id_representante;

-- R4: representantes en mora con deuda vencida y antigüedad.
-- ids_mensualidades_vencidas permite comparar la deuda actual con la que ya
-- se notificó (snapshot en MongoDB) para no repetir avisos (R7).
CREATE VIEW v_morosos AS
SELECT r.id_representante,
       r.cedula,
       r.nombres,
       r.telefono,
       r.correo,
       sum(s.saldo) AS deuda_vencida,
       count(*) AS mensualidades_vencidas,
       count(DISTINCT s.id_alumno) AS alumnos_en_mora,
       min(s.fecha_vencimiento) AS vencimiento_mas_antiguo,
       max(s.dias_vencida) AS dias_mora,
       (array_agg(s.id_mensualidad ORDER BY s.fecha_vencimiento, s.id_mensualidad))[1] AS id_mensualidad_mas_antigua,
       array_agg(s.id_mensualidad ORDER BY s.fecha_vencimiento, s.id_mensualidad) AS ids_mensualidades_vencidas
  FROM v_saldo_mensualidad s
  JOIN representante r USING (id_representante)
 WHERE s.estado_pago = 'vencida'
 GROUP BY r.id_representante;

-- Curso con su nombre completo y cupo ocupado, para listas y reportes.
CREATE VIEW v_curso AS
SELECT c.id_curso,
       d.nombre || ' ' || c.categoria_edad AS nombre,
       c.id_periodo,
       c.edad_min,
       c.edad_max,
       c.horario,
       c.cupo_maximo,
       c.valor_mensual,
       (SELECT count(*) FROM matricula m WHERE m.id_curso = c.id_curso AND m.estado = 'activa') AS ocupados
  FROM curso c
  JOIN disciplina d USING (id_disciplina);
