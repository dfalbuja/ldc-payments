-- =====================================================================
-- Núcleo transaccional en PostgreSQL
--
-- Vive aquí todo lo que exige consistencia fuerte: catálogos, matrícula,
-- mensualidades, pagos y su desglose. Los comprobantes de pago y las
-- notificaciones de mora viven en MongoDB (ver db/mongo/); por eso las
-- tablas COMPROBANTE, RECORDATORIO, RECORDATORIO_MENSUALIDAD y
-- SEGUIMIENTO_RECORDATORIO del DLR inicial no existen en este esquema.
-- =====================================================================

CREATE TABLE rol (
  id_rol integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre varchar(40) NOT NULL UNIQUE
);

CREATE TABLE usuario (
  id_usuario integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_rol     integer NOT NULL REFERENCES rol,
  usuario    varchar(40) NOT NULL UNIQUE,
  hash_clave varchar(100),
  estado     varchar(10) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo'))
);
COMMENT ON COLUMN usuario.hash_clave IS 'Sin login en el prototipo (fuera de alcance); queda para una versión futura.';

CREATE TABLE periodo (
  id_periodo      integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre          varchar(60) NOT NULL UNIQUE,
  fecha_inicio    date NOT NULL,
  fecha_fin       date NOT NULL,
  dia_vencimiento smallint NOT NULL DEFAULT 10 CHECK (dia_vencimiento BETWEEN 1 AND 28),
  estado          varchar(10) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'cerrado')),
  CHECK (fecha_fin > fecha_inicio)
);
COMMENT ON COLUMN periodo.dia_vencimiento IS 'Día del mes en que vence cada mensualidad del periodo.';

CREATE TABLE disciplina (
  id_disciplina integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre        varchar(60) NOT NULL UNIQUE,
  activo        boolean NOT NULL DEFAULT true
);

CREATE TABLE curso (
  id_curso       integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_disciplina  integer NOT NULL REFERENCES disciplina,
  id_periodo     integer NOT NULL REFERENCES periodo,
  categoria_edad varchar(40) NOT NULL,
  edad_min       smallint NOT NULL CHECK (edad_min >= 3),
  edad_max       smallint NOT NULL,
  horario        varchar(80) NOT NULL,
  cupo_maximo    smallint NOT NULL CHECK (cupo_maximo > 0),
  valor_mensual  numeric(10, 2) NOT NULL CHECK (valor_mensual > 0),
  CHECK (edad_max >= edad_min),
  UNIQUE (id_disciplina, id_periodo, categoria_edad)
);
COMMENT ON COLUMN curso.categoria_edad IS 'Etiqueta visible (Sub-10, Juvenil...). La validación usa edad_min/edad_max.';

CREATE TABLE representante (
  id_representante integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cedula           char(10) NOT NULL UNIQUE CHECK (cedula ~ '^[0-9]{10}$'),
  nombres          varchar(100) NOT NULL,
  telefono         varchar(15),
  correo           varchar(120)
);

CREATE TABLE alumno (
  id_alumno        integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_representante integer NOT NULL REFERENCES representante,
  cedula           char(10) UNIQUE CHECK (cedula ~ '^[0-9]{10}$'),
  nombres          varchar(100) NOT NULL,
  fecha_nacimiento date NOT NULL,
  estado           varchar(10) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo'))
);
CREATE INDEX ix_alumno_representante ON alumno (id_representante);

CREATE TABLE matricula (
  id_matricula    integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_alumno       integer NOT NULL REFERENCES alumno,
  id_curso        integer NOT NULL REFERENCES curso,
  fecha_matricula date NOT NULL DEFAULT current_date,
  fecha_retiro    date,
  estado          varchar(10) NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'retirada')),
  UNIQUE (id_alumno, id_curso),
  CHECK ((estado = 'retirada') = (fecha_retiro IS NOT NULL)),
  CHECK (fecha_retiro IS NULL OR fecha_retiro >= fecha_matricula)
);
CREATE INDEX ix_matricula_curso ON matricula (id_curso);

CREATE TABLE mensualidad (
  id_mensualidad    integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_matricula      integer NOT NULL REFERENCES matricula,
  anio              smallint NOT NULL,
  mes               smallint NOT NULL CHECK (mes BETWEEN 1 AND 12),
  valor_total       numeric(10, 2) NOT NULL CHECK (valor_total > 0),
  fecha_vencimiento date NOT NULL,
  estado            varchar(10) NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente', 'anulada')),
  UNIQUE (id_matricula, anio, mes)
);
CREATE INDEX ix_mensualidad_vencimiento ON mensualidad (fecha_vencimiento);
COMMENT ON COLUMN mensualidad.estado IS
  'Estado administrativo. El estado de pago (pendiente, parcial, pagada, vencida) no se guarda: se calcula en v_saldo_mensualidad.';

CREATE TABLE metodo_pago (
  id_metodo_pago       integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre               varchar(40) NOT NULL UNIQUE,
  requiere_comprobante boolean NOT NULL DEFAULT true
);

CREATE TABLE pago (
  id_pago          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_representante integer NOT NULL REFERENCES representante,
  id_metodo_pago   integer NOT NULL REFERENCES metodo_pago,
  id_usuario       integer NOT NULL REFERENCES usuario,
  fecha_pago       timestamptz NOT NULL DEFAULT now(),
  valor_total      numeric(10, 2) NOT NULL CHECK (valor_total > 0),
  ref_comprobante  char(24) CHECK (ref_comprobante ~ '^[0-9a-f]{24}$'),
  estado           varchar(25) NOT NULL DEFAULT 'pendiente_comprobante'
                   CHECK (estado IN ('pendiente_comprobante', 'confirmado')),
  CHECK (ref_comprobante IS NULL OR estado = 'confirmado')
);
CREATE INDEX ix_pago_representante ON pago (id_representante);
COMMENT ON COLUMN pago.ref_comprobante IS '_id del documento en MongoDB comprobantes_pago (enlace entre motores).';
COMMENT ON COLUMN pago.estado IS
  'pendiente_comprobante hasta que MongoDB confirma el comprobante; así un fallo entre motores queda visible y no se pierde.';

CREATE TABLE detalle_pago (
  id_detalle_pago integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_pago         integer NOT NULL REFERENCES pago,
  id_mensualidad  integer NOT NULL REFERENCES mensualidad,
  valor_aplicado  numeric(10, 2) NOT NULL CHECK (valor_aplicado > 0),
  UNIQUE (id_pago, id_mensualidad)
);
CREATE INDEX ix_detalle_pago_mensualidad ON detalle_pago (id_mensualidad);
