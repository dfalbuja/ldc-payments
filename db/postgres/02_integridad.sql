-- =====================================================================
-- Reglas de integridad que una FK o un CHECK no pueden expresar.
-- Viven en triggers para que se cumplan sin importar quién escriba
-- (la aplicación, un script o una sesión de psql).
-- =====================================================================

-- R1 · Matrícula: cupo, edad, periodo activo y alumno activo.
-- El FOR UPDATE sobre el curso serializa las matrículas concurrentes al
-- mismo curso: la segunda espera y luego cuenta el cupo ya actualizado.
CREATE FUNCTION fn_tg_matricula_validar() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_curso      curso%ROWTYPE;
  v_periodo    periodo%ROWTYPE;
  v_alumno     alumno%ROWTYPE;
  v_disciplina disciplina%ROWTYPE;
  v_nombre     text;
  v_edad       integer;
  v_ocupados   integer;
BEGIN
  SELECT * INTO v_curso FROM curso WHERE id_curso = NEW.id_curso FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El curso % no existe', NEW.id_curso;
  END IF;

  SELECT * INTO v_alumno FROM alumno WHERE id_alumno = NEW.id_alumno;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El alumno % no existe', NEW.id_alumno;
  END IF;
  IF v_alumno.estado <> 'activo' THEN
    RAISE EXCEPTION 'El alumno % está inactivo', v_alumno.nombres;
  END IF;

  SELECT * INTO v_disciplina FROM disciplina WHERE id_disciplina = v_curso.id_disciplina;
  IF NOT v_disciplina.activo THEN
    RAISE EXCEPTION 'La disciplina % no está activa', v_disciplina.nombre;
  END IF;
  v_nombre := v_disciplina.nombre || ' ' || v_curso.categoria_edad;

  -- El UNIQUE (id_alumno, id_curso) ya lo impide; esto solo da un mensaje claro.
  IF EXISTS (SELECT 1 FROM matricula WHERE id_alumno = NEW.id_alumno AND id_curso = NEW.id_curso) THEN
    RAISE EXCEPTION 'El alumno % ya está matriculado en %', v_alumno.nombres, v_nombre;
  END IF;

  SELECT * INTO v_periodo FROM periodo WHERE id_periodo = v_curso.id_periodo;
  IF v_periodo.estado <> 'activo' THEN
    RAISE EXCEPTION 'El periodo % está cerrado', v_periodo.nombre;
  END IF;
  IF NEW.fecha_matricula NOT BETWEEN v_periodo.fecha_inicio AND v_periodo.fecha_fin THEN
    RAISE EXCEPTION 'La fecha de matrícula % está fuera del periodo % (% a %)',
      NEW.fecha_matricula, v_periodo.nombre, v_periodo.fecha_inicio, v_periodo.fecha_fin;
  END IF;

  v_edad := date_part('year', age(NEW.fecha_matricula, v_alumno.fecha_nacimiento));
  IF v_edad NOT BETWEEN v_curso.edad_min AND v_curso.edad_max THEN
    RAISE EXCEPTION 'El alumno % tiene % años y % admite de % a % años',
      v_alumno.nombres, v_edad, v_nombre, v_curso.edad_min, v_curso.edad_max;
  END IF;

  SELECT count(*) INTO v_ocupados
    FROM matricula
   WHERE id_curso = NEW.id_curso AND estado = 'activa';
  IF v_ocupados >= v_curso.cupo_maximo THEN
    RAISE EXCEPTION 'Cupo lleno: % ya tiene % de % alumnos',
      v_nombre, v_ocupados, v_curso.cupo_maximo;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_matricula_validar
  BEFORE INSERT ON matricula
  FOR EACH ROW EXECUTE FUNCTION fn_tg_matricula_validar();


-- R2 · Cada línea del desglose: nunca supera el saldo de la mensualidad y
-- solo puede pagar mensualidades de alumnos del representante que paga.
-- El FOR UPDATE sobre la mensualidad impide que dos pagos simultáneos
-- sobre-apliquen el mismo saldo.
CREATE FUNCTION fn_tg_detalle_pago_validar() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_mensualidad record;
  v_rep_pago    integer;
  v_aplicado    numeric(10, 2);
BEGIN
  SELECT m.valor_total, m.estado, a.id_representante, a.nombres AS alumno
    INTO v_mensualidad
    FROM mensualidad m
    JOIN matricula mt USING (id_matricula)
    JOIN alumno a USING (id_alumno)
   WHERE m.id_mensualidad = NEW.id_mensualidad
     FOR UPDATE OF m;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La mensualidad % no existe', NEW.id_mensualidad;
  END IF;
  IF v_mensualidad.estado = 'anulada' THEN
    RAISE EXCEPTION 'La mensualidad % está anulada', NEW.id_mensualidad;
  END IF;

  SELECT id_representante INTO v_rep_pago FROM pago WHERE id_pago = NEW.id_pago;
  IF v_rep_pago IS DISTINCT FROM v_mensualidad.id_representante THEN
    RAISE EXCEPTION 'La mensualidad % es de % y no está a cargo del representante que paga',
      NEW.id_mensualidad, v_mensualidad.alumno;
  END IF;

  SELECT COALESCE(sum(valor_aplicado), 0) INTO v_aplicado
    FROM detalle_pago
   WHERE id_mensualidad = NEW.id_mensualidad
     AND id_detalle_pago <> NEW.id_detalle_pago;
  IF v_aplicado + NEW.valor_aplicado > v_mensualidad.valor_total THEN
    RAISE EXCEPTION 'Sobrepago: la mensualidad % tiene saldo % y se intenta aplicar %',
      NEW.id_mensualidad, v_mensualidad.valor_total - v_aplicado, NEW.valor_aplicado;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_detalle_pago_validar
  BEFORE INSERT OR UPDATE ON detalle_pago
  FOR EACH ROW EXECUTE FUNCTION fn_tg_detalle_pago_validar();


-- R2 · La suma del desglose debe igualar el valor del pago.
-- Es un constraint trigger diferido: se evalúa al final de la transacción,
-- cuando ya existen el pago y todas sus líneas.
CREATE FUNCTION fn_tg_pago_cuadra() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_id_pago integer;
  v_total   numeric(10, 2);
  v_suma    numeric(10, 2);
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_id_pago := OLD.id_pago;
  ELSE
    v_id_pago := NEW.id_pago;
  END IF;

  SELECT valor_total INTO v_total FROM pago WHERE id_pago = v_id_pago;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(sum(valor_aplicado), 0) INTO v_suma
    FROM detalle_pago
   WHERE id_pago = v_id_pago;
  IF v_suma <> v_total THEN
    RAISE EXCEPTION 'El desglose del pago % suma % pero el pago es por %', v_id_pago, v_suma, v_total;
  END IF;

  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_pago_cuadra
  AFTER INSERT OR UPDATE OF valor_total ON pago
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_tg_pago_cuadra();

CREATE CONSTRAINT TRIGGER trg_detalle_pago_cuadra
  AFTER INSERT OR UPDATE OR DELETE ON detalle_pago
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_tg_pago_cuadra();
