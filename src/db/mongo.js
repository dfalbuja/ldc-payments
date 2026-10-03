import { MongoClient } from 'mongodb';
import { config } from '../config.js';
import { comprobantesPago } from '../../db/mongo/comprobantes_pago.js';
import { notificacionesMora } from '../../db/mongo/notificaciones_mora.js';

const cliente = new MongoClient(config.mongo.url, { serverSelectionTimeoutMS: 3000 });
const db = cliente.db(config.mongo.db);

export const comprobantes = db.collection(comprobantesPago.name);
export const notificaciones = db.collection(notificacionesMora.name);

export const conectarMongo = () => cliente.connect();
export const cerrarMongo = () => cliente.close();
export const pingMongo = () => db.command({ ping: 1 });
