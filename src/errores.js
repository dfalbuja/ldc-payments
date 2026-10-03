
export class ErrorApp extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const STATUS_POSTGRES = {
  P0001: 422, // RAISE EXCEPTION de nuestros triggers y funciones
  23505: 409, // unique_violation
  23503: 422, // foreign_key_violation
  23514: 422, // check_violation
  '22P02': 400, // invalid_text_representation
  22003: 400, // numeric_value_out_of_range
};

export function traducirError(err) {
  if (err instanceof ErrorApp) {
    return { status: err.status, cuerpo: { error: err.message } };
  }
  if (err.type === 'entity.parse.failed') {
    return { status: 400, cuerpo: { error: 'El cuerpo de la petición no es JSON válido' } };
  }
  // node-postgres: los errores del servidor traen severity y un SQLSTATE de 5 caracteres.
  if (err.severity && typeof err.code === 'string' && err.code.length === 5) {
    return {
      status: STATUS_POSTGRES[err.code] ?? 500,
      cuerpo: { error: err.message, motor: 'PostgreSQL', codigo: err.code, restriccion: err.constraint },
    };
  }
  if (err.code === 121) {
    return {
      status: 422,
      cuerpo: {
        error: 'MongoDB rechazó el documento: no cumple el validador $jsonSchema de la colección',
        motor: 'MongoDB',
        reglas: reglasIncumplidas(err.errInfo),
      },
    };
  }
  if (err.code === 11000) {
    const indice = /index: (\S+)/.exec(err.message)?.[1];
    return {
      status: 409,
      cuerpo: {
        error: `MongoDB rechazó el documento: ya existe uno con ${JSON.stringify(err.keyValue)} (índice único ${indice})`,
        motor: 'MongoDB',
      },
    };
  }
  return { status: 500, cuerpo: { error: 'Error interno del servidor' } };
}

const DESCRIBIR_REGLA = {
  minLength: ({ minLength }) => `debe tener al menos ${minLength} caracteres`,
  maxLength: ({ maxLength }) => `debe tener como máximo ${maxLength} caracteres`,
  pattern: ({ pattern }) => `no cumple el formato ${pattern}`,
  enum: (regla) => `debe ser uno de: ${regla.enum.join(', ')}`,
  bsonType: ({ bsonType }) => `debe ser de tipo ${bsonType}`,
  minimum: ({ minimum }) => `debe ser al menos ${minimum}`,
  maximum: ({ maximum }) => `debe ser como máximo ${maximum}`,
  minItems: ({ minItems }) => `debe tener al menos ${minItems} elementos`,
};

function reglasIncumplidas(errInfo) {
  const reglas = new Set();
  const recorrer = (nodo, ruta) => {
    if (Array.isArray(nodo)) return nodo.forEach((hijo) => recorrer(hijo, ruta));
    if (!nodo || typeof nodo !== 'object') return;
    // "not" es la rama "el método no es X" de las reglas condicionales del
    // validador: siempre falla cuando el método sí es X, no es un error del usuario.
    if (nodo.operatorName === 'not') return;
    const campo = (nombre) => (ruta ? `${ruta}.${nombre}` : nombre);
    if (typeof nodo.propertyName === 'string') return recorrer(nodo.details, campo(nodo.propertyName));
    if (typeof nodo.itemIndex === 'number') return recorrer(nodo.details, `${ruta}[${nodo.itemIndex}]`);

    const describir = DESCRIBIR_REGLA[nodo.operatorName];
    if (describir) {
      const recibido = 'consideredValue' in nodo ? ` (recibido: ${JSON.stringify(nodo.consideredValue)})` : '';
      reglas.add(`${ruta || 'documento'}: ${describir(nodo.specifiedAs)}${recibido}`);
    }
    if (Array.isArray(nodo.missingProperties)) nodo.missingProperties.forEach((p) => reglas.add(`${campo(p)}: es obligatorio`));
    if (Array.isArray(nodo.additionalProperties)) nodo.additionalProperties.forEach((p) => reglas.add(`${campo(p)}: campo no permitido`));
    for (const clave of ['details', 'schemasNotSatisfied', 'schemaRulesNotSatisfied', 'propertiesNotSatisfied']) {
      recorrer(nodo[clave], ruta);
    }
  };
  recorrer(errInfo?.details, '');
  return [...reglas];
}
