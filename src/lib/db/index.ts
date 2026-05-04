import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL!;
const MAX_CONNECTIONS = parseInt(process.env.DB_MAX_CONNECTIONS || '10', 10);

const client = postgres(connectionString, {
  max: MAX_CONNECTIONS,
  idle_timeout: 20,
  connect_timeout: 10,
});
export const db = drizzle(client, { schema });
