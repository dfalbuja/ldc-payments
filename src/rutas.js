import { Router } from 'express';
import { pool } from './db/pg.js';
import { pingMongo } from './db/mongo.js';
import { ErrorApp } from './errores.js';
import { desglose, dinero, entero, fechaOpcional } from './validar.js';
import { obtenerCatalogos } from './servicios/catalogos.js';
import { matricular } from './servicios/matriculas.js';
import { estadoCuentaRepresentante, listarMorosos } from './servicios/cuentas.js';
import { adjuntarComprobante, obtenerPago, registrarPago } from './servicios/pagos.js';
import { buscarPorReferencia } from './servicios/comprobantes.js';
import { ejecutarProcesoMora, listarNotificaciones, registrarSeguimiento } from './servicios/mora.js';

export const rutas = Router();

rutas.get('/salud', async (req, res) => {
  await Promise.all([pool.query('SELECT 1'), pingMongo()]);
  res.json({ postgresql: 'ok', mongodb: 'ok' });
});

rutas.get('/catalogos', async (req, res) => {
  res.json(await obtenerCatalogos());
});

// R1
rutas.post('/matriculas', async (req, res) => {
  const resultado = await matricular({
    id_alumno: entero(req.body.id_alumno, 'id_alumno'),
    id_curso: entero(req.body.id_curso, 'id_curso'),
    fecha: fechaOpcional(req.body.fecha, 'fecha'),
  });
  res.status(201).json(resultado);
});

// R3
rutas.get('/representantes/:id/estado-cuenta', async (req, res) => {
  res.json(await estadoCuentaRepresentante(entero(req.params.id, 'id')));
});

// R2 + R5
rutas.post('/pagos', async (req, res) => {
  const resultado = await registrarPago({
    id_representante: entero(req.body.id_representante, 'id_representante'),
    id_metodo_pago: entero(req.body.id_metodo_pago, 'id_metodo_pago'),
    valor_total: dinero(req.body.valor_total, 'valor_total'),
    desglose: desglose(req.body.desglose),
    comprobante: req.body.comprobante ?? {},
  });
  res.status(201).json(resultado);
});

rutas.get('/pagos/:id', async (req, res) => {
  res.json(await obtenerPago(entero(req.params.id, 'id')));
});

rutas.post('/pagos/:id/comprobante', async (req, res) => {
  const id = entero(req.params.id, 'id');
  await adjuntarComprobante(id, req.body.comprobante ?? {});
  res.status(201).json(await obtenerPago(id));
});

// R5 (lectura por número de referencia)
rutas.get('/comprobantes', async (req, res) => {
  const referencia = String(req.query.referencia ?? '').trim();
  if (!referencia) throw new ErrorApp(400, 'Indica el número de referencia');
  res.json(await buscarPorReferencia(referencia));
});

// R4 + R7
rutas.get('/morosos', async (req, res) => {
  res.json(await listarMorosos());
});

// R6 + R7
rutas.post('/mora/ejecutar', async (req, res) => {
  res.json(await ejecutarProcesoMora({ fecha: fechaOpcional(req.body.fecha, 'fecha') }));
});

rutas.get('/notificaciones', async (req, res) => {
  const id_representante = req.query.id_representante ? entero(req.query.id_representante, 'id_representante') : undefined;
  res.json(await listarNotificaciones({ id_representante }));
});

rutas.post('/notificaciones/:id/seguimiento', async (req, res) => {
  const documento = await registrarSeguimiento(req.params.id, {
    evento: req.body.evento,
    detalle: req.body.detalle?.trim() || undefined,
    fecha_compromiso: fechaOpcional(req.body.fecha_compromiso, 'fecha_compromiso'),
  });
  res.status(201).json(documento);
});

rutas.use((req, res) => {
  res.status(404).json({ error: `No existe la ruta ${req.method} ${req.originalUrl}` });
});
