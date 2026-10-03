// R5 · Comprobantes de pago en MongoDB.
import { Decimal128 } from 'mongodb';
import { comprobantes } from '../db/mongo.js';
import { ErrorApp } from '../errores.js';

// Campos que pide el formulario según el método de pago. Las reglas
// definitivas son las del validador $jsonSchema (db/mongo/comprobantes_pago.js):
// aquí solo se arma el documento con los tipos BSON correctos.
export const CAMPOS_COMPROBANTE = {
  transferencia: [
    { nombre: 'banco_origen', etiqueta: 'Banco de origen', tipo: 'texto', requerido: true, ayuda: 'Ej.: Banco Pichincha' },
    { nombre: 'num_referencia', etiqueta: 'N.º de referencia', tipo: 'texto', requerido: true, ayuda: 'Mínimo 4 caracteres' },
    { nombre: 'fecha_transaccion', etiqueta: 'Fecha de la transferencia', tipo: 'fecha', requerido: true },
    { nombre: 'archivo_url', etiqueta: 'URL de la imagen (opcional)', tipo: 'texto' },
  ],
  tarjeta: [
    {
      nombre: 'marca',
      etiqueta: 'Marca',
      tipo: 'opcion',
      opciones: ['Visa', 'Mastercard', 'Diners', 'American Express', 'Discover'],
      requerido: true,
    },
    { nombre: 'ultimos4', etiqueta: 'Últimos 4 dígitos', tipo: 'texto', requerido: true, ayuda: 'Solo 4 dígitos, nunca el número completo' },
    { nombre: 'cod_autorizacion', etiqueta: 'Código de autorización', tipo: 'texto', requerido: true, ayuda: 'Mínimo 4 caracteres' },
    { nombre: 'lote', etiqueta: 'Lote (opcional)', tipo: 'texto' },
  ],
  efectivo: [
    { nombre: 'num_recibo', etiqueta: 'N.º de recibo', tipo: 'texto', requerido: true, ayuda: 'Ej.: R-0001' },
    { nombre: 'valor_recibido', etiqueta: 'Valor recibido', tipo: 'dinero', requerido: true },
  ],
};

function armarDatos(metodo, entrada = {}) {
  const tipos = new Map((CAMPOS_COMPROBANTE[metodo] ?? []).map((c) => [c.nombre, c.tipo]));
  const datos = {};
  let archivo;

  for (const [clave, valor] of Object.entries(entrada)) {
    if (valor === '' || valor === null || valor === undefined) continue;
    if (clave === 'archivo_url') {
      archivo = { nombre: String(valor).split('/').pop() || 'comprobante', url: String(valor) };
      continue;
    }
    switch (tipos.get(clave)) {
      case 'fecha':
        datos[clave] = new Date(`${valor}T00:00:00`);
        if (Number.isNaN(datos[clave].getTime())) throw new ErrorApp(400, `${clave} no es una fecha válida`);
        break;
      case 'dinero':
        if (!/^\d+(\.\d{1,2})?$/.test(String(valor))) throw new ErrorApp(400, `${clave} no es un monto válido`);
        datos[clave] = Decimal128.fromString(String(valor));
        break;
      default:
        // Un campo desconocido se guarda tal cual y el validador decide.
        datos[clave] = String(valor);
    }
  }
  return { datos, archivo };
}

// pago: fila de PostgreSQL con id_pago, id_representante, metodo y valor_total.
export async function guardarComprobante(pago, entrada, usuario) {
  const { datos, archivo } = armarDatos(pago.metodo, entrada);
  const documento = {
    id_pago: pago.id_pago,
    id_representante: pago.id_representante,
    metodo: pago.metodo,
    monto: Decimal128.fromString(pago.valor_total),
    fecha_registro: new Date(),
    registrado_por: usuario,
    datos,
    ...(archivo && { archivo }),
  };

  try {
    const { insertedId } = await comprobantes.insertOne(documento);
    return { _id: insertedId, ...documento };
  } catch (err) {
    // Reintento tras una caída entre este insert y la confirmación en
    // PostgreSQL: el comprobante ya existe, se reutiliza.
    if (err.code === 11000 && err.keyPattern?.id_pago) {
      return comprobantes.findOne({ id_pago: pago.id_pago });
    }
    throw err;
  }
}

export const buscarPorPago = (id_pago) => comprobantes.findOne({ id_pago });

// Devuelve también la consulta ejecutada, como evidencia del patrón de acceso.
export async function buscarPorReferencia(referencia) {
  const filtro = { metodo: 'transferencia', 'datos.num_referencia': referencia };
  return {
    consulta: `db.${comprobantes.collectionName}.find(${JSON.stringify(filtro)})`,
    documentos: await comprobantes.find(filtro).toArray(),
  };
}
