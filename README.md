# ldc-payments

Prototipo del sistema de gestión de mensualidades y control de morosidad de la Liga Deportiva Cantonal "Antonio Ante".
Examen final de Tópicos Avanzados de Bases de Datos (UTM, Maestría en Ingeniería de Software), Momento 2.

Arquitectura híbrida: **PostgreSQL** como núcleo transaccional y **MongoDB** para los datos de estructura variable.

## Qué vive en cada motor

| Motor | Datos | Por qué |
|---|---|---|
| PostgreSQL | Periodos, disciplinas, cursos, representantes, alumnos, matrículas, mensualidades, pagos y su desglose | Matricular y pagar son transacciones multi-tabla con bloqueo de saldo y cupo (ACID). El saldo se calcula en una sola vista, así el estado de cuenta y el reporte de morosos nunca se contradicen. |
| MongoDB · `comprobantes_pago` | Un comprobante por pago, con campos distintos según el método | Transferencia, tarjeta y efectivo tienen campos diferentes, y se pueden agregar métodos nuevos sin migrar el esquema. Se escribe después del `COMMIT` del pago. |
| MongoDB · `notificaciones_mora` | Avisos de mora con la deuda congelada y el seguimiento embebido | La deuda notificada no debe cambiar aunque luego lleguen pagos, y el seguimiento crece como eventos dentro del mismo documento. |

Enlace entre motores: cada documento guarda `id_pago` o `id_representante` de PostgreSQL. A su vez, `pago.ref_comprobante` guarda el `_id` del comprobante en MongoDB.

## Requisitos

- Node.js 22.12 o superior
- pnpm 10 o superior. Si no lo tienes, `corepack enable pnpm` instala la versión fijada en `package.json`.
- PostgreSQL 16 o superior (probado con 18)
- MongoDB 6 o superior, corriendo en `localhost:27017`

El proyecto usa **pnpm**. `npm install` está bloqueado a propósito con `devEngines` en `package.json`, para que no se mezclen dos lockfiles.

## Puesta en marcha

```bash
git clone https://github.com/dfalbuja/ldc-payments.git
cd ldc-payments
pnpm install
cp .env.example .env    # en Windows: copy .env.example .env
pnpm db:reset
pnpm dev                # abre http://localhost:4300
```

`pnpm db:reset` **borra y recrea** las bases `ldc_payments` en ambos motores. Después aplica el esquema y carga los datos de prueba. Se puede ejecutar cuantas veces se quiera para volver al estado inicial.

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Levanta la API y la interfaz en http://localhost:4300 y se reinicia al guardar cambios |
| `pnpm start` | Lo mismo, sin reinicio automático |
| `pnpm db:reset` | Recrea ambas bases con los datos de prueba |
| `pnpm mora` | Ejecuta el proceso programado de mora con la fecha de hoy |
| `pnpm mora --fecha 2026-10-08` | Simula que el proceso corre ese día, para mostrar cómo escalan los avisos |

El puerto se cambia con `PORT` en `.env`.

Configuración de PostgreSQL en `.env`:

- **macOS con Homebrew:** no hace falta tocar nada. Se conecta con tu usuario del sistema y sin clave.
- **Windows con el instalador oficial:** descomentar `PGUSER=postgres` y poner en `PGPASSWORD` la clave elegida al instalar.

## Estructura

```
db/postgres/      01_esquema · 02_integridad (triggers) · 03_vistas · 04_funciones · 05_datos_prueba
db/mongo/         validadores $jsonSchema e índices de cada colección
src/servicios/    matriculas · pagos · cuentas (PostgreSQL) · comprobantes · mora (MongoDB)
src/rutas.js      API REST (Express)
public/           interfaz mínima (HTML + JS sin frameworks)
scripts/          db-reset.js · mora.js
```

## Flujo entre motores

1. **Matrícula (R1).** `fn_matricular` inserta la matrícula y sus mensualidades en una transacción. El trigger bloquea el curso y valida cupo, edad y periodo.
2. **Pago (R2).** `fn_registrar_pago` inserta el pago y su desglose, bloqueando el saldo de cada mensualidad en orden. Los triggers rechazan el sobrepago y las mensualidades de otro representante, y uno diferido verifica que el desglose cuadre con el total.
3. **Comprobante (R5).** Después del `COMMIT`, la API guarda el comprobante en MongoDB y marca el pago como `confirmado` con su `ref_comprobante`. Si MongoDB lo rechaza, el pago queda `pendiente_comprobante` y se puede adjuntar después.
4. **Estado de cuenta (R3) y morosos (R4).** Ambos salen de `v_saldo_mensualidad`.
5. **Mora (R6 y R7).** El proceso lee los morosos en PostgreSQL. Antes de avisar, revisa en MongoDB el último aviso del representante y guarda la deuda congelada, con el seguimiento embebido.
   - Es la *misma mora* mientras alguna mensualidad del último aviso siga impaga. En ese caso el aviso escala a nivel 2 a los 7 días y a nivel 3 a los 14, una sola vez cada uno.
   - Si el representante pagó todo lo que se le notificó, lo vencido es deuda nueva y vuelve al nivel 1.
   - El índice único `ux_episodio_nivel` impide avisos duplicados.

## API

| Método y ruta | Uso |
|---|---|
| `GET /api/catalogos` | Alumnos, cursos con su cupo, representantes y métodos de pago |
| `POST /api/matriculas` | `{ id_alumno, id_curso, fecha? }` |
| `GET /api/representantes/:id/estado-cuenta` | Resumen, saldo por alumno, mensualidades y pagos |
| `POST /api/pagos` | `{ id_representante, id_metodo_pago, valor_total, desglose: [{ id_mensualidad, valor }], comprobante: {...} }` |
| `GET /api/pagos/:id` | El pago visto en ambos motores: `{ postgresql, mongodb }` |
| `POST /api/pagos/:id/comprobante` | Adjunta el comprobante a un pago `pendiente_comprobante` |
| `GET /api/comprobantes?referencia=` | Busca un comprobante de transferencia por número de referencia bancaria. Devuelve `{ consulta, documentos }` |
| `GET /api/morosos` | Morosos (PostgreSQL) con su último aviso (MongoDB) |
| `POST /api/mora/ejecutar` | `{ fecha? }` ejecuta el proceso de mora |
| `GET /api/notificaciones` | Avisos registrados (`?id_representante=` opcional) |
| `POST /api/notificaciones/:id/seguimiento` | `{ evento, detalle?, fecha_compromiso? }` |

## Datos de prueba

Son los del plan del Momento 1: 3 disciplinas, 1 periodo, 5 cursos, 5 representantes y 10 alumnos con mensualidades de 3 meses. Las fechas se calculan desde el día en que se ejecuta `db:reset`: el periodo cubre el mes anterior, el actual y el siguiente, así que siempre hay mensualidades vencidas para demostrar la mora.

| Representante | Alumnos (edad) |
|---|---|
| María Fernanda Pozo | Mateo (8), Valentina (11), Sebastián (13) |
| Carlos Andrés Andrade | Emilia (7), Joaquín (10) |
| Lucía Guerrero | Daniel (12), Camila (9) |
| Jorge Luis Ruiz | Isabella (14), Martín (6) |
| Patricia Vaca | Samuel (10) |

- **Cursos:** Taekwondo Infantil y Juvenil, Ajedrez Formativo, y Fútbol Sub-10 y Sub-14. Ajedrez tiene cupo 3 y empieza con 2 alumnos.
- **Matrículas:** 13, que generan 39 mensualidades. Los 5 representantes empiezan en mora con el mes anterior vencido.
- **Usuarios:** `admin` y `proceso_mora`. El prototipo no tiene login.
- **Pagos y MongoDB:** no hay pagos y las colecciones empiezan vacías. Todo lo crea la demostración.

Casos que se pueden demostrar con estos datos:

- **Matrícula correcta:** Valentina en Ajedrez Formativo toma la última plaza y genera solo las mensualidades del mes actual y el siguiente.
- **Rechazos de matrícula:**
  - Samuel en Ajedrez Formativo, después de Valentina: cupo lleno.
  - Martín (6) en Taekwondo Juvenil: edad fuera de rango.
  - Mateo en Taekwondo Infantil otra vez: matrícula duplicada.
- **Pagos de María:**
  - Pago parcial de una mensualidad vencida.
  - Pago de varios meses y de varios hijos en una sola operación.
  - Sobrepago, que se rechaza.
- **Comprobantes:** uno por cada método (efectivo, transferencia y tarjeta), cada uno con campos distintos.
- **Mora:** aviso de nivel 1 para los 5 representantes, sin duplicar si el proceso se repite el mismo día. Después, seguimiento del aviso y escalada a nivel 2 con `pnpm mora --fecha` una semana después.

Si una operación se rechaza, PostgreSQL revierte la fila pero no la secuencia. Por eso el siguiente pago puede saltarse un número, por ejemplo pasar del #2 al #4.
