-- =====================================================================
-- Datos de prueba del plan del Momento 1: 3 disciplinas, 1 periodo,
-- 5 cursos, 5 representantes y 10 alumnos con mensualidades de 3 meses.
--
-- Las fechas son relativas al día en que se ejecuta el script: el periodo
-- cubre el mes anterior, el actual y el siguiente. Así siempre hay una
-- mensualidad vencida (mora), una del mes en curso y una futura.
--
-- Casos que permiten estos datos:
--   · Valentina → Ajedrez Formativo: toma la última plaza (3 de 3) y genera
--     las mensualidades del periodo restante.
--   · Samuel → Ajedrez Formativo, después de Valentina: cupo lleno.
--   · Martín (6) → Taekwondo Juvenil (10–15): edad fuera de rango.
--   · Mateo → Taekwondo Infantil otra vez: matrícula duplicada.
--   · María tiene 3 hijos con mensualidades vencidas: pago parcial, de varios
--     meses, de varios hijos y sobrepago rechazado.
--   · Los 5 representantes empiezan en mora: avisos, seguimiento y no duplicados.
-- Sin pagos ni documentos en MongoDB: los crea la demostración.
-- =====================================================================

INSERT INTO rol (nombre) VALUES ('administrativo'), ('sistema');

INSERT INTO usuario (id_rol, usuario)
SELECT id_rol, u.usuario
  FROM (VALUES ('admin', 'administrativo'), ('proceso_mora', 'sistema')) AS u(usuario, rol)
  JOIN rol ON rol.nombre = u.rol;

INSERT INTO metodo_pago (nombre, requiere_comprobante)
VALUES ('efectivo', true), ('transferencia', true), ('tarjeta', true);

INSERT INTO periodo (nombre, fecha_inicio, fecha_fin, dia_vencimiento)
SELECT 'Periodo ' || to_char(inicio, 'YYYY-MM') || ' a ' || to_char(fin, 'YYYY-MM'), inicio, fin, 10
  FROM (SELECT (date_trunc('month', current_date) - interval '1 month')::date AS inicio,
               (date_trunc('month', current_date) + interval '2 months' - interval '1 day')::date AS fin) d;

INSERT INTO disciplina (nombre) VALUES ('Taekwondo'), ('Ajedrez'), ('Fútbol');

-- Ajedrez tiene cupo 3 a propósito: con 2 matriculados sirve para demostrar
-- la última plaza disponible y el rechazo por cupo lleno.
INSERT INTO curso (id_disciplina, id_periodo, categoria_edad, edad_min, edad_max, horario, cupo_maximo, valor_mensual)
SELECT d.id_disciplina, p.id_periodo, c.categoria, c.edad_min, c.edad_max, c.horario, c.cupo, c.valor
  FROM (VALUES
    ('Taekwondo', 'Infantil',  6,  9, 'Lun y Mié 16:00-17:00', 12, 25.00),
    ('Taekwondo', 'Juvenil',  10, 15, 'Lun y Mié 17:00-18:30', 12, 25.00),
    ('Ajedrez',   'Formativo', 6, 15, 'Sáb 09:00-11:00',        3, 20.00),
    ('Fútbol',    'Sub-10',    6, 10, 'Mar y Jue 15:30-17:00', 20, 30.00),
    ('Fútbol',    'Sub-14',   11, 14, 'Mar y Jue 17:00-18:30', 20, 30.00)
  ) AS c(disciplina, categoria, edad_min, edad_max, horario, cupo, valor)
  JOIN disciplina d ON d.nombre = c.disciplina
 CROSS JOIN periodo p;

INSERT INTO representante (cedula, nombres, telefono, correo) VALUES
  ('1002345671', 'María Fernanda Pozo Terán',     '0987654321', 'mfpozo@example.com'),
  ('1003456782', 'Carlos Andrés Andrade Vinueza', '0991234567', 'candrade@example.com'),
  ('1004567893', 'Lucía Guerrero Cevallos',       '0979876543', 'lguerrero@example.com'),
  ('1005678904', 'Jorge Luis Ruiz Benítez',       '0963456789', 'jruiz@example.com'),
  ('1006789015', 'Patricia Vaca Montalvo',        '0958765432', 'pvaca@example.com');

-- La fecha de nacimiento se calcula para que la edad sea estable al
-- matricular al inicio del periodo o el día de la demostración.
INSERT INTO alumno (id_representante, cedula, nombres, fecha_nacimiento)
SELECT r.id_representante, a.cedula, a.nombres,
       (current_date - make_interval(years => a.edad, months => 3))::date
  FROM (VALUES
    ('1002345671', '1050000011', 'Mateo Pozo',        8),
    ('1002345671', '1050000029', 'Valentina Pozo',   11),
    ('1002345671', '1050000037', 'Sebastián Pozo',   13),
    ('1003456782', '1050000045', 'Emilia Andrade',    7),
    ('1003456782', '1050000052', 'Joaquín Andrade',  10),
    ('1004567893', '1050000060', 'Daniel Guerrero',  12),
    ('1004567893', '1050000078', 'Camila Guerrero',   9),
    ('1005678904', '1050000086', 'Isabella Ruiz',    14),
    ('1005678904', '1050000094', 'Martín Ruiz',       6),
    ('1006789015', '1050000102', 'Samuel Vaca',      10)
  ) AS a(cedula_representante, cedula, nombres, edad)
  JOIN representante r ON r.cedula = a.cedula_representante;

-- Las matrículas pasan por fn_matricular, igual que en la aplicación, así
-- las mensualidades se generan con la misma regla.
SELECT fn_matricular(a.id_alumno, c.id_curso, p.fecha_inicio)
  FROM (VALUES
    ('1050000011', 'Taekwondo', 'Infantil'),
    ('1050000011', 'Fútbol',    'Sub-10'),
    ('1050000029', 'Taekwondo', 'Juvenil'),
    ('1050000037', 'Fútbol',    'Sub-14'),
    ('1050000037', 'Ajedrez',   'Formativo'),
    ('1050000045', 'Taekwondo', 'Infantil'),
    ('1050000052', 'Fútbol',    'Sub-10'),
    ('1050000060', 'Taekwondo', 'Juvenil'),
    ('1050000060', 'Ajedrez',   'Formativo'),
    ('1050000078', 'Taekwondo', 'Infantil'),
    ('1050000086', 'Fútbol',    'Sub-14'),
    ('1050000094', 'Fútbol',    'Sub-10'),
    ('1050000102', 'Taekwondo', 'Juvenil')
  ) AS m(cedula, disciplina, categoria)
  JOIN alumno a ON a.cedula = m.cedula
  JOIN disciplina d ON d.nombre = m.disciplina
  JOIN curso c ON c.id_disciplina = d.id_disciplina AND c.categoria_edad = m.categoria
 CROSS JOIN periodo p;
