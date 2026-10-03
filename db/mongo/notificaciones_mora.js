// R6 y R7 · Recordatorios de mora y su seguimiento.
// Cada documento congela la deuda al momento del aviso (snapshot), aunque
// después cambien los pagos en PostgreSQL. El seguimiento crece como
// eventos embebidos en el mismo documento: actualizarlo es una operación
// atómica sobre un solo documento y no necesita transacciones.

export const notificacionesMora = {
  name: 'notificaciones_mora',
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      title: 'Notificación de mora',
      required: ['id_representante', 'representante', 'episodio', 'nivel', 'canal', 'destino',
        'fecha_aviso', 'deuda', 'mensaje', 'estado', 'seguimiento'],
      properties: {
        id_representante: { bsonType: 'int', minimum: 1, description: 'representante.id_representante en PostgreSQL' },
        representante: {
          bsonType: 'object',
          required: ['cedula', 'nombres'],
          properties: {
            cedula: { bsonType: 'string', pattern: '^[0-9]{10}$' },
            nombres: { bsonType: 'string' },
          },
        },
        // El episodio identifica "esa mora": nace con el aviso de nivel 1 (su
        // mensualidad vencida más antigua) y lo heredan los avisos siguientes
        // mientras alguna mensualidad ya notificada siga impaga.
        episodio: {
          bsonType: 'object',
          required: ['id_mensualidad_inicial', 'fecha_vencimiento_inicial'],
          properties: {
            id_mensualidad_inicial: { bsonType: 'int', minimum: 1 },
            fecha_vencimiento_inicial: { bsonType: 'date' },
          },
        },
        nivel: { bsonType: 'int', enum: [1, 2, 3], description: '1: vencida, 2: +7 días, 3: +14 días' },
        canal: { enum: ['correo', 'whatsapp', 'sms'] },
        destino: { bsonType: 'string', description: 'Correo o teléfono al que se envió' },
        fecha_aviso: { bsonType: 'date' },
        deuda: {
          bsonType: 'object',
          required: ['total', 'fecha_corte', 'mensualidades'],
          properties: {
            total: { bsonType: 'decimal' },
            fecha_corte: { bsonType: 'date' },
            dias_mora: { bsonType: 'int', minimum: 0 },
            mensualidades: {
              bsonType: 'array',
              minItems: 1,
              items: {
                bsonType: 'object',
                required: ['id_mensualidad', 'alumno', 'curso', 'anio', 'mes', 'fecha_vencimiento', 'saldo'],
                properties: {
                  id_mensualidad: { bsonType: 'int' },
                  alumno: { bsonType: 'string' },
                  curso: { bsonType: 'string' },
                  anio: { bsonType: 'int' },
                  mes: { bsonType: 'int', minimum: 1, maximum: 12 },
                  fecha_vencimiento: { bsonType: 'date' },
                  saldo: { bsonType: 'decimal' },
                },
              },
            },
          },
        },
        mensaje: {
          bsonType: 'object',
          required: ['plantilla', 'cuerpo'],
          properties: {
            plantilla: { bsonType: 'string' },
            asunto: { bsonType: 'string' },
            cuerpo: { bsonType: 'string' },
          },
        },
        estado: { enum: ['enviado', 'entregado', 'respondido', 'compromiso_pago', 'cerrado'] },
        seguimiento: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            required: ['fecha', 'evento'],
            properties: {
              fecha: { bsonType: 'date' },
              evento: { enum: ['enviado', 'entregado', 'leido', 'respuesta', 'compromiso_pago', 'nota', 'cerrado'] },
              detalle: { bsonType: 'string' },
              fecha_compromiso: { bsonType: 'date' },
              registrado_por: { bsonType: 'string' },
            },
          },
        },
      },
      // La estructura varía por canal: un correo necesita asunto.
      anyOf: [
        { properties: { canal: { not: { enum: ['correo'] } } } },
        { properties: { mensaje: { required: ['asunto'] } } },
      ],
    },
  },
  indexes: [
    // R7: un solo aviso por nivel dentro del mismo episodio de mora.
    // Si el proceso intenta repetirlo, MongoDB lo rechaza (error 11000).
    {
      key: { id_representante: 1, 'episodio.id_mensualidad_inicial': 1, nivel: 1 },
      name: 'ux_episodio_nivel',
      unique: true,
    },
    // R7: último aviso de un representante (búsqueda por id ordenada por fecha).
    { key: { id_representante: 1, fecha_aviso: -1 }, name: 'ix_representante_fecha' },
  ],
};
