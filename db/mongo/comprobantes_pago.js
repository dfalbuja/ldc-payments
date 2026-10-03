// R5 · Comprobante de cada pago según su método.
// Los campos de `datos` cambian por método. Los métodos conocidos tienen
// reglas propias; un método nuevo solo necesita los campos comunes, así que
// se puede agregar sin migrar el esquema.

// "Si metodo es X, entonces datos cumple Y". $jsonSchema (draft 4) no tiene
// if/then, así que se expresa como: metodo no es X, o datos cumple Y.
const siMetodo = (metodo, esquemaDatos) => ({
  anyOf: [
    { properties: { metodo: { not: { enum: [metodo] } } } },
    { properties: { datos: esquemaDatos } },
  ],
});

export const comprobantesPago = {
  name: 'comprobantes_pago',
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      title: 'Comprobante de pago',
      required: ['id_pago', 'id_representante', 'metodo', 'monto', 'fecha_registro', 'registrado_por', 'datos'],
      properties: {
        id_pago: { bsonType: 'int', minimum: 1, description: 'pago.id_pago en PostgreSQL' },
        id_representante: { bsonType: 'int', minimum: 1 },
        metodo: { bsonType: 'string', description: 'metodo_pago.nombre en PostgreSQL' },
        monto: { bsonType: 'decimal' },
        fecha_registro: { bsonType: 'date' },
        registrado_por: { bsonType: 'string' },
        datos: { bsonType: 'object', description: 'Campos propios del método de pago' },
        archivo: {
          bsonType: 'object',
          required: ['nombre', 'url'],
          properties: {
            nombre: { bsonType: 'string' },
            url: { bsonType: 'string' },
            tipo_mime: { bsonType: 'string' },
          },
        },
      },
      allOf: [
        siMetodo('transferencia', {
          required: ['banco_origen', 'num_referencia', 'fecha_transaccion'],
          properties: {
            banco_origen: { bsonType: 'string', minLength: 2 },
            num_referencia: { bsonType: 'string', minLength: 4 },
            fecha_transaccion: { bsonType: 'date' },
          },
        }),
        // De la tarjeta solo se guardan los últimos 4 dígitos: additionalProperties
        // impide que se cuele el número completo en cualquier otro campo.
        siMetodo('tarjeta', {
          required: ['marca', 'ultimos4', 'cod_autorizacion'],
          additionalProperties: false,
          properties: {
            marca: { enum: ['Visa', 'Mastercard', 'Diners', 'American Express', 'Discover'] },
            ultimos4: { bsonType: 'string', pattern: '^[0-9]{4}$' },
            cod_autorizacion: { bsonType: 'string', minLength: 4 },
            lote: { bsonType: 'string' },
          },
        }),
        siMetodo('efectivo', {
          required: ['num_recibo', 'valor_recibido'],
          properties: {
            num_recibo: { bsonType: 'string' },
            valor_recibido: { bsonType: 'decimal' },
            cambio: { bsonType: 'decimal' },
          },
        }),
      ],
    },
  },
  indexes: [
    // Un comprobante por pago; también es la lectura por id_pago.
    { key: { id_pago: 1 }, name: 'ux_id_pago', unique: true },
    // Lectura por número de referencia y control de que una misma
    // transferencia no se use para dos pagos.
    {
      key: { 'datos.num_referencia': 1, 'datos.banco_origen': 1 },
      name: 'ux_transferencia_referencia',
      unique: true,
      partialFilterExpression: { metodo: 'transferencia' },
    },
    { key: { id_representante: 1, fecha_registro: -1 }, name: 'ix_representante_fecha' },
  ],
};
