-- =====================================================================
-- Operaciones transaccionales. Cada llamada es atómica: si algo falla,
-- PostgreSQL revierte todo lo que la función alcanzó a escribir.
-- =====================================================================

-- R1 · Matricula al alumno y genera las mensualidades del periodo restante,
-- desde el mes de la matrícula hasta el último mes del periodo.
-- Se cobra el mes completo. Si la matrícula es posterior al día de
-- vencimiento, la primera mensualidad vence el mismo día de la matrícula.
CREATE FUNCTION fn_matricular(p_id_alumno integer, p_id_curso integer, p_fecha date DEFAULT current_date)
RETURNS TABLE (id_matricula_nueva integer, mensualidades_generadas integer)
LANGUAGE plpgsql AS $$
DECLARE
  v_curso   curso%ROWTYPE;
  v_periodo periodo%ROWTYPE;
BEGIN
  -- trg_matricula_validar bloquea el curso y valida cupo, edad y periodo.
  INSERT INTO matricula (id_alumno, id_curso, fecha_matricula)
  VALUES (p_id_alumno, p_id_curso, p_fecha)
  RETURNING id_matricula INTO id_matricula_nueva;

  SELECT * INTO v_curso FROM curso WHERE id_curso = p_id_curso;
  SELECT * INTO v_periodo FROM periodo WHERE id_periodo = v_curso.id_periodo;

  INSERT INTO mensualidad (id_matricula, anio, mes, valor_total, fecha_vencimiento)
  SELECT id_matricula_nueva,
         extract(year FROM g)::smallint,
         extract(month FROM g)::smallint,
         v_curso.valor_mensual,
         GREATEST(make_date(extract(year FROM g)::integer, extract(month FROM g)::integer, v_periodo.dia_vencimiento),
                  p_fecha)
    FROM generate_series(date_trunc('month', p_fecha::timestamp),
                         date_trunc('month', v_periodo.fecha_fin::timestamp),
                         interval '1 month') AS g;
  GET DIAGNOSTICS mensualidades_generadas = ROW_COUNT;

  RETURN NEXT;
END $$;


-- R2 · Registra un pago y su desglose contra cada mensualidad.
-- p_desglose: [{"id_mensualidad": 1, "valor": 25.00}, ...]
-- Sirve para pago total, parcial, de varios meses o de varios hijos.
CREATE FUNCTION fn_registrar_pago(
  p_id_representante integer,
  p_id_metodo_pago   integer,
  p_id_usuario       integer,
  p_valor_total      numeric,
  p_desglose         jsonb
) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_id_pago   integer;
  v_requiere  boolean;
  v_lineas    integer;
  v_distintas integer;
BEGIN
  IF jsonb_typeof(p_desglose) IS DISTINCT FROM 'array' OR jsonb_array_length(p_desglose) = 0 THEN
    RAISE EXCEPTION 'El desglose debe incluir al menos una mensualidad';
  END IF;

  SELECT count(*), count(DISTINCT e ->> 'id_mensualidad')
    INTO v_lineas, v_distintas
    FROM jsonb_array_elements(p_desglose) e;
  IF v_lineas <> v_distintas THEN
    RAISE EXCEPTION 'El desglose repite una mensualidad';
  END IF;

  SELECT requiere_comprobante INTO v_requiere
    FROM metodo_pago
   WHERE id_metodo_pago = p_id_metodo_pago;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El método de pago % no existe', p_id_metodo_pago;
  END IF;

  -- Bloquea las mensualidades afectadas siempre en el mismo orden para que
  -- dos pagos concurrentes no se bloqueen mutuamente (deadlock).
  PERFORM 1
     FROM mensualidad
    WHERE id_mensualidad IN (SELECT (e ->> 'id_mensualidad')::integer FROM jsonb_array_elements(p_desglose) e)
    ORDER BY id_mensualidad
      FOR UPDATE;

  INSERT INTO pago (id_representante, id_metodo_pago, id_usuario, valor_total, estado)
  VALUES (p_id_representante, p_id_metodo_pago, p_id_usuario, p_valor_total,
          CASE WHEN v_requiere THEN 'pendiente_comprobante' ELSE 'confirmado' END)
  RETURNING id_pago INTO v_id_pago;

  -- trg_detalle_pago_validar revisa saldo y representante en cada línea.
  INSERT INTO detalle_pago (id_pago, id_mensualidad, valor_aplicado)
  SELECT v_id_pago, (e ->> 'id_mensualidad')::integer, (e ->> 'valor')::numeric(10, 2)
    FROM jsonb_array_elements(p_desglose) e
   ORDER BY 2;

  -- Adelanta la verificación diferida para que un desglose que no cuadra
  -- falle aquí, con un mensaje claro, y no recién en el COMMIT. Luego la
  -- devuelve a DEFERRED: si no, el siguiente pago en la misma transacción
  -- se verificaría antes de tener sus líneas.
  SET CONSTRAINTS trg_pago_cuadra, trg_detalle_pago_cuadra IMMEDIATE;
  SET CONSTRAINTS trg_pago_cuadra, trg_detalle_pago_cuadra DEFERRED;

  RETURN v_id_pago;
END $$;

