// Validación mínima de entrada. Las reglas de negocio las hacen cumplir
// PostgreSQL (triggers y funciones) y MongoDB (validadores).
import { ErrorApp } from './errores.js';

export function entero(valor, nombre) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero <= 0) {
    throw new ErrorApp(400, `${nombre} debe ser un entero positivo`);
  }
  return numero;
}

export function dinero(valor, nombre) {
  const texto = String(valor ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(texto) || Number(texto) <= 0) {
    throw new ErrorApp(400, `${nombre} debe ser un monto mayor que cero con hasta 2 decimales`);
  }
  return texto;
}

export function fechaOpcional(valor, nombre) {
  if (valor === undefined || valor === null || valor === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    throw new ErrorApp(400, `${nombre} debe tener el formato AAAA-MM-DD`);
  }
  return valor;
}

export function desglose(valor) {
  if (!Array.isArray(valor) || valor.length === 0) {
    throw new ErrorApp(400, 'El desglose debe incluir al menos una mensualidad');
  }
  return valor.map((linea) => ({
    id_mensualidad: entero(linea?.id_mensualidad, 'id_mensualidad'),
    valor: dinero(linea?.valor, 'valor'),
  }));
}
