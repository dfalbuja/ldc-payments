try {
  process.loadEnvFile();
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

export const config = {
  pg: {
    database: process.env.PGDATABASE ?? 'ldc_payments',
  },
  mongo: {
    url: process.env.MONGO_URL ?? 'mongodb://localhost:27017',
    db: process.env.MONGO_DB ?? 'ldc_payments',
  },
  port: Number(process.env.PORT ?? 4300),
  usuarioAdministrativo: 'admin',
  usuarioProcesoMora: 'proceso_mora',
};
