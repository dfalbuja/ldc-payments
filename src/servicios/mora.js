// R6 y R7 · Proceso programado de mora. Lee la mora en PostgreSQL, revisa
// el historial de avisos en MongoDB y registra el aviso (envío simulado).
import { Decimal128, ObjectId } from 'mongodb';
import { config } from '../config.js';
import { pool } from '../db/pg.js';
import { notificaciones } from '../db/mongo.js';
import { ErrorApp } from '../errores.js';

const DIAS_ENTRE_AVISOS = 7;
const NIVEL_MAXIMO = 3;
const CANAL_POR_NIVEL = { 1: 'whatsapp', 2: 'correo', 3: 'sms' };
const ESTADO_POR_EVENTO = {
  entregado: 'entregado',
  respuesta: 'respondido',
  compromiso_pago: 'compromiso_pago',
  cerrado: 'cerrado',
};

const MS_POR_DIA = 24 * 60 * 60 * 1000;
const inicioDelDia = (fecha) => new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
// Días de calendario: un aviso del día 1 a las 18:00 y una ejecución del día 8
// a las 09:00 están a 7 días, aunque no hayan pasado 7 × 24 horas.
const diasEntre = (desde, hasta) => Math.round((inicioDelDia(hasta) - inicioDelDia(desde)) / MS_POR_DIA);
const aFecha = (texto) => new Date(`${texto}T00:00:00`);

// fecha (AAAA-MM-DD, opcional) simula el día en que corre el proceso, para
// demostrar el paso de un nivel de aviso al siguiente sin esperar 7 días.
export async function ejecutarProcesoMora({ fecha } = {}) {
  const fechaEjecucion = fecha ? new Date(`${fecha}T12:00:00`) : new Date();
  const { rows: morosos } = await pool.query('SELECT * FROM v_morosos ORDER BY id_representante');

  const resultados = [];
  for (const moroso of morosos) {
    resultados.push(await procesarMoroso(moroso, fechaEjecucion));
  }
  return { fecha_ejecucion: fechaEjecucion, morosos_revisados: morosos.length, resultados };
}

async function procesarMoroso(moroso, fechaEjecucion) {
  const resultado = {
    id_representante: moroso.id_representante,
    representante: moroso.nombres,
    deuda_vencida: moroso.deuda_vencida,
  };

  // R7: antes de avisar, el último aviso del representante.
  const ultimo = await notificaciones.findOne(
    { id_representante: moroso.id_representante },
    { sort: { fecha_aviso: -1 } },
  );
  const decision = decidirNivel(ultimo, moroso, fechaEjecucion);
  if (decision.omitir) return { ...resultado, accion: 'omitido', motivo: decision.motivo };

  const documento = await armarNotificacion(moroso, decision, fechaEjecucion);
  try {
    const { insertedId } = await notificaciones.insertOne(documento);
    return {
      ...resultado,
      accion: 'notificado',
      nivel: documento.nivel,
      canal: documento.canal,
      destino: documento.destino,
      id_notificacion: insertedId,
    };
  } catch (err) {
    if (err.code === 11000) {
      return { ...resultado, accion: 'omitido', motivo: 'El índice único ux_episodio_nivel rechazó un aviso repetido' };
    }
    throw err;
  }
}

// "Esa mora" (R7): si alguna mensualidad del último aviso sigue vencida, es la
// misma mora, aunque haya abonos. Si ya pagó todo lo notificado, lo que hoy
// esté vencido es deuda nueva y la secuencia vuelve a empezar en el nivel 1.
export function esMismaMora(ultimo, idsVencidas) {
  if (!ultimo) return false;
  const vencidas = new Set(idsVencidas);
  return ultimo.deuda.mensualidades.some((m) => vencidas.has(m.id_mensualidad));
}

function decidirNivel(ultimo, moroso, fechaEjecucion) {
  if (!esMismaMora(ultimo, moroso.ids_mensualidades_vencidas)) {
    return {
      nivel: 1,
      episodio: {
        id_mensualidad_inicial: moroso.id_mensualidad_mas_antigua,
        fecha_vencimiento_inicial: aFecha(moroso.vencimiento_mas_antiguo),
      },
    };
  }
  if (ultimo.nivel >= NIVEL_MAXIMO) {
    return { omitir: true, motivo: `Ya recibió el aviso de nivel ${NIVEL_MAXIMO}, el último de esta mora` };
  }
  const dias = diasEntre(ultimo.fecha_aviso, fechaEjecucion);
  if (dias < DIAS_ENTRE_AVISOS) {
    return {
      omitir: true,
      motivo: `Ya se le avisó (nivel ${ultimo.nivel}) hace ${Math.max(dias, 0)} día(s); el siguiente nivel va a los ${DIAS_ENTRE_AVISOS} días`,
    };
  }
  // Los avisos de la misma mora comparten episodio: así el índice único
  // ux_episodio_nivel impide repetir un nivel dentro de ella.
  return { nivel: ultimo.nivel + 1, episodio: ultimo.episodio };
}

async function armarNotificacion(moroso, { nivel, episodio }, fechaEjecucion) {
  const { rows: mensualidades } = await pool.query(`
    SELECT s.id_mensualidad, a.nombres AS alumno, c.nombre AS curso, s.anio, s.mes, s.fecha_vencimiento, s.saldo
      FROM v_saldo_mensualidad s
      JOIN alumno a USING (id_alumno)
      JOIN v_curso c USING (id_curso)
     WHERE s.id_representante = $1 AND s.estado_pago = 'vencida'
     ORDER BY s.fecha_vencimiento, s.id_mensualidad`, [moroso.id_representante]);

  let canal = CANAL_POR_NIVEL[nivel];
  if (canal === 'correo' && !moroso.correo) canal = 'whatsapp';
  const destino = canal === 'correo' ? moroso.correo : moroso.telefono;
  const total = `$${moroso.deuda_vencida}`;

  return {
    id_representante: moroso.id_representante,
    representante: { cedula: moroso.cedula, nombres: moroso.nombres },
    episodio,
    nivel,
    canal,
    destino,
    fecha_aviso: fechaEjecucion,
    // Snapshot: la deuda queda congelada tal como estaba al avisar.
    deuda: {
      total: Decimal128.fromString(moroso.deuda_vencida),
      fecha_corte: fechaEjecucion,
      dias_mora: Math.max(diasEntre(aFecha(moroso.vencimiento_mas_antiguo), fechaEjecucion), 0),
      mensualidades: mensualidades.map((m) => ({
        id_mensualidad: m.id_mensualidad,
        alumno: m.alumno,
        curso: m.curso,
        anio: m.anio,
        mes: m.mes,
        fecha_vencimiento: aFecha(m.fecha_vencimiento),
        saldo: Decimal128.fromString(m.saldo),
      })),
    },
    mensaje: {
      plantilla: `mora_nivel_${nivel}`,
      ...(canal === 'correo' && { asunto: `Aviso de mora (nivel ${nivel}) · Liga Deportiva Cantonal Antonio Ante` }),
      cuerpo: `Estimado/a ${moroso.nombres}: registra ${moroso.mensualidades_vencidas} mensualidad(es) vencida(s) `
        + `por ${total}. Le pedimos acercarse a regularizar el pago.`,
    },
    estado: 'enviado',
    seguimiento: [{
      fecha: fechaEjecucion,
      evento: 'enviado',
      detalle: `Envío simulado por ${canal} a ${destino}`,
      registrado_por: config.usuarioProcesoMora,
    }],
  };
}

export async function listarNotificaciones({ id_representante } = {}) {
  const filtro = id_representante ? { id_representante } : {};
  return notificaciones.find(filtro).sort({ fecha_aviso: -1 }).toArray();
}

// R6 · El seguimiento se agrega al mismo documento con $push: una operación
// atómica sobre un solo documento, sin transacciones.
export async function registrarSeguimiento(id, { evento, detalle, fecha_compromiso }, usuario = config.usuarioAdministrativo) {
  if (!ObjectId.isValid(id)) throw new ErrorApp(400, 'Identificador de notificación inválido');

  const nuevoEvento = {
    fecha: new Date(),
    evento,
    registrado_por: usuario,
    ...(detalle && { detalle }),
    ...(fecha_compromiso && { fecha_compromiso: aFecha(fecha_compromiso) }),
  };
  const cambios = { $push: { seguimiento: nuevoEvento } };
  if (ESTADO_POR_EVENTO[evento]) cambios.$set = { estado: ESTADO_POR_EVENTO[evento] };

  const documento = await notificaciones.findOneAndUpdate(
    { _id: new ObjectId(id) },
    cambios,
    { returnDocument: 'after' },
  );
  if (!documento) throw new ErrorApp(404, `No existe la notificación ${id}`);
  return documento;
}
