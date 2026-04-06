import {Session} from '@shopify/shopify-api';
import type {SessionStorage} from '@shopify/shopify-app-session-storage';
import {SQLiteSessionStorage} from '@shopify/shopify-app-session-storage-sqlite';
import sqlite3 from 'sqlite3';

const SESSION_TABLE_NAME = 'shopify_sessions';

const REQUIRED_COLUMNS = [
  {
    name: 'refreshToken',
    sql: 'ALTER TABLE shopify_sessions ADD COLUMN refreshToken varchar(255)',
  },
  {
    name: 'refreshTokenExpires',
    sql: 'ALTER TABLE shopify_sessions ADD COLUMN refreshTokenExpires INTEGER',
  },
] as const;

function openDatabase(databasePath: string) {
  return new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(databasePath, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(database);
    });
  });
}

function all<T>(
  database: sqlite3.Database,
  query: string,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    database.all(query, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(rows as T[]);
    });
  });
}

function run(database: sqlite3.Database, query: string): Promise<void> {
  return new Promise((resolve, reject) => {
    database.run(query, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function close(database: sqlite3.Database): Promise<void> {
  return new Promise((resolve, reject) => {
    database.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function ensureSessionColumns(databasePath: string) {
  const database = await openDatabase(databasePath);

  try {
    const columns = await all<{name: string}>(
      database,
      `PRAGMA table_info('${SESSION_TABLE_NAME}')`,
    );
    const columnNames = new Set(columns.map((column) => column.name));

    for (const column of REQUIRED_COLUMNS) {
      if (!columnNames.has(column.name)) {
        await run(database, column.sql);
      }
    }
  } finally {
    await close(database);
  }
}

class CompatSQLiteSessionStorage implements SessionStorage {
  private readonly storage: SQLiteSessionStorage;
  private readonly ready: Promise<void>;

  constructor(databasePath: string) {
    this.storage = new SQLiteSessionStorage(databasePath);
    this.ready = this.storage.ready.then(() => ensureSessionColumns(databasePath));
  }

  async storeSession(session: Session): Promise<boolean> {
    await this.ready;
    return this.storage.storeSession(session);
  }

  async loadSession(id: string): Promise<Session | undefined> {
    await this.ready;
    return this.storage.loadSession(id);
  }

  async deleteSession(id: string): Promise<boolean> {
    await this.ready;
    return this.storage.deleteSession(id);
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    await this.ready;
    return this.storage.deleteSessions(ids);
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    await this.ready;
    return this.storage.findSessionsByShop(shop);
  }
}

export function createSessionStorage(databasePath: string): SessionStorage {
  return new CompatSQLiteSessionStorage(databasePath);
}
