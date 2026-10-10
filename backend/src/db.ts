import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { RequestView } from "./shared.js";

export class Db {
  private db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        reqId INTEGER PRIMARY KEY AUTOINCREMENT,
        vault TEXT NOT NULL,
        body TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS labels (address TEXT PRIMARY KEY, label TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS hcs (seq INTEGER PRIMARY KEY, consensus TEXT NOT NULL, ref INTEGER, raw TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS hcs_ref ON hcs (ref);
      CREATE TABLE IF NOT EXISTS posted (k TEXT PRIMARY KEY);
    `);
  }

  createRequest(vault: string, r: Omit<RequestView, "reqId">): RequestView {
    const res = this.db
      .prepare("INSERT INTO requests (vault, body, createdAt) VALUES (?, ?, ?)")
      .run(vault, JSON.stringify(r), Math.floor(Date.now() / 1000));
    const reqId = Number(res.lastInsertRowid);
    const full = { ...r, reqId };
    this.saveRequest(full);
    return full;
  }

  saveRequest(r: RequestView): void {
    this.db.prepare("UPDATE requests SET body = ? WHERE reqId = ?").run(JSON.stringify(r), r.reqId);
  }

  getRequest(reqId: number): RequestView | null {
    const row = this.db.prepare("SELECT body FROM requests WHERE reqId = ?").get(reqId) as { body: string } | undefined;
    return row ? (JSON.parse(row.body) as RequestView) : null;
  }

  listRequests(vault: string, limit = 50): RequestView[] {
    const rows = this.db
      .prepare("SELECT body FROM requests WHERE vault = ? ORDER BY reqId DESC LIMIT ?")
      .all(vault, limit) as { body: string }[];
    return rows.map((r) => JSON.parse(r.body) as RequestView);
  }

  labels(): Record<string, string> {
    const rows = this.db.prepare("SELECT address, label FROM labels").all() as { address: string; label: string }[];
    return Object.fromEntries(rows.map((r) => [r.address, r.label]));
  }

  setLabel(address: string, label: string): void {
    this.db.prepare("INSERT INTO labels (address, label) VALUES (?, ?) ON CONFLICT(address) DO UPDATE SET label = excluded.label").run(address, label);
  }

  get(k: string): string | null {
    const row = this.db.prepare("SELECT v FROM kv WHERE k = ?").get(k) as { v: string } | undefined;
    return row?.v ?? null;
  }

  set(k: string, v: string): void {
    this.db.prepare("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, v);
  }

  posted(key: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM posted WHERE k = ?").get(key);
  }

  markPosted(key: string): void {
    this.db.prepare("INSERT OR IGNORE INTO posted (k) VALUES (?)").run(key);
  }

  addHcs(seq: number | null, consensus: string, raw: string): number {
    let ref: number | null = null;
    try {
      const r = (JSON.parse(raw) as { ref?: unknown }).ref;
      ref = typeof r === "number" ? r : null;
    } catch {
      ref = null;
    }
    const n = seq ?? this.lastHcsSeq() + 1;
    this.db.prepare("INSERT OR IGNORE INTO hcs (seq, consensus, ref, raw) VALUES (?, ?, ?, ?)").run(n, consensus, ref, raw);
    return n;
  }

  lastHcsSeq(): number {
    const row = this.db.prepare("SELECT MAX(seq) AS m FROM hcs").get() as { m: number | null };
    return row.m ?? 0;
  }

  listHcs(limit: number): { seq: number; consensus: string; raw: string }[] {
    return this.db.prepare("SELECT seq, consensus, raw FROM hcs ORDER BY seq DESC LIMIT ?").all(limit) as { seq: number; consensus: string; raw: string }[];
  }

  hcsByRef(ref: number): { seq: number; consensus: string; raw: string }[] {
    return this.db.prepare("SELECT seq, consensus, raw FROM hcs WHERE ref = ? ORDER BY seq ASC").all(ref) as { seq: number; consensus: string; raw: string }[];
  }

  openRequest(vault: string, source: string): RequestView | null {
    return this.listRequests(vault, 20).find((r) => r.source === source && r.status === "waiting_puck") ?? null;
  }

  wipe(): void {
    this.db.exec("DELETE FROM requests; DELETE FROM hcs; DELETE FROM posted; DELETE FROM kv;");
  }
}
