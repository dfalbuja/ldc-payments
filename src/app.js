import { fileURLToPath } from 'node:url';
import express from 'express';
import { rutas } from './rutas.js';
import { traducirError } from './errores.js';

export const app = express();

// Decimal128 de MongoDB se serializa como { $numberDecimal: "25.00" };
// se envía como texto, igual que los numeric de PostgreSQL.
app.set('json replacer', (clave, valor) =>
  valor && typeof valor === 'object' && typeof valor.$numberDecimal === 'string' ? valor.$numberDecimal : valor);

app.use(express.json());
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
app.use('/api', rutas);

app.use((err, req, res, next) => {
  const { status, cuerpo } = traducirError(err);
  if (status >= 500) console.error(err);
  res.status(status).json(cuerpo);
});
