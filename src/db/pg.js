import pg from 'pg';
import { config } from '../config.js';

pg.types.setTypeParser(pg.types.builtins.DATE, (valor) => valor);
pg.types.setTypeParser(pg.types.builtins.INT8, (valor) => Number(valor));

export const pool = new pg.Pool({ database: config.pg.database });
