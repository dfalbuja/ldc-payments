import { comprobantesPago } from './comprobantes_pago.js';
import { notificacionesMora } from './notificaciones_mora.js';

export const colecciones = [comprobantesPago, notificacionesMora];

export async function crearColecciones(db) {
  for (const { name, validator, indexes } of colecciones) {
    await db.createCollection(name, { validator, validationLevel: 'strict', validationAction: 'error' });
    await db.collection(name).createIndexes(indexes);
  }
}
