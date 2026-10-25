import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config";

export const now = () => Date.now();
export const startOfDay = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
export const startOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};

/** Minimal async query surface. SQL is written Postgres-style ($1, $2); the SQLite path translates it. */
export interface Exec {
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(sql: string, params?: unknown[]): Promise<number>;
}

const usePg = !!config.databaseUrl;

/** 64-bit int type: BIGINT on Postgres (ms timestamps overflow int4), INTEGER on SQLite. */
const INT = usePg ? "BIGINT" : "INTEGER";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, google_id TEXT UNIQUE,
     name TEXT, picture TEXT, created_at ${INT} NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, fingerprint_hash TEXT, uses_count ${INT} NOT NULL DEFAULT 0,
     video_uses ${INT} NOT NULL DEFAULT 0, first_seen ${INT} NOT NULL, last_seen ${INT} NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS credit_ledger (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, delta ${INT} NOT NULL,
     reason TEXT NOT NULL, ref TEXT, created_at ${INT} NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ledger_ref ON credit_ledger(reason, ref) WHERE ref IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, user_id TEXT, device_id TEXT, ip TEXT, tool TEXT NOT NULL,
     source TEXT NOT NULL, paid_with TEXT NOT NULL, seconds REAL, credits_charged ${INT} NOT NULL DEFAULT 0,
     refunded ${INT} NOT NULL DEFAULT 0, ext_id TEXT, created_at ${INT} NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS jobs_ext ON jobs(ext_id)`,
  `CREATE INDEX IF NOT EXISTS jobs_user ON jobs(user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS jobs_device ON jobs(device_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS jobs_ip ON jobs(ip, created_at)`,
  `CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, key_hash TEXT UNIQUE NOT NULL,
     prefix TEXT NOT NULL, name TEXT NOT NULL, last_used_at ${INT}, revoked_at ${INT}, created_at ${INT} NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ad_sessions (id TEXT PRIMARY KEY, user_id TEXT, device_id TEXT NOT NULL, ip TEXT,
     tool TEXT NOT NULL, opts TEXT NOT NULL, required ${INT} NOT NULL, watched ${INT} NOT NULL DEFAULT 0,
     current_ad TEXT, ad_started_at ${INT}, redeemed ${INT} NOT NULL DEFAULT 0, created_at ${INT} NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ad_rewards (id TEXT PRIMARY KEY, ad_session_id TEXT NOT NULL, user_id TEXT,
     device_id TEXT NOT NULL, network_txn_id TEXT UNIQUE NOT NULL, created_at ${INT} NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, pack TEXT NOT NULL, amount ${INT} NOT NULL,
     credits ${INT} NOT NULL, status TEXT NOT NULL, payment_id TEXT, created_at ${INT} NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, email TEXT, message TEXT NOT NULL, url TEXT,
     created_at ${INT} NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS waitlist (email TEXT PRIMARY KEY, created_at ${INT} NOT NULL)`,
];

/** Serialize all DB access so a multi-statement transaction can't interleave with other work. */
let chain: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => {},
    () => {},
  );
  return run;
}

const clean = (params: unknown[] = []) =>
  params.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v));

type Backend = { raw: Exec; tx<T>(fn: (x: Exec) => Promise<T>): Promise<T>; init(): Promise<void> };

function sqliteBackend(): Backend {
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
  mkdirSync(dirname(config.dbPath), { recursive: true });
  const sdb = new DatabaseSync(config.dbPath);
  sdb.exec("PRAGMA journal_mode = WAL");
  const toQ = (sql: string, params: unknown[]) => {
    const args: unknown[] = [];
    const out = sql.replace(/\$(\d+)/g, (_, n: string) => {
      args.push(params[Number(n) - 1]);
      return "?";
    });
    return { out, args: clean(args) };
  };
  const raw: Exec = {
