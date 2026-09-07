// src/db.js - Universal Zero-Dependency SQLite Storage via node:sqlite
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

const DB_DIR = resolve(process.cwd(), 'data');
if (!existsSync(DB_DIR)) {
  mkdirSync(DB_DIR, { recursive: true });
}
const DB_PATH = resolve(DB_DIR, 'experiments.db');

class ExperimentDB {
  constructor() {
    this.db = new DatabaseSync(DB_PATH);
    this.initSchema();
  }

  initSchema() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS experiments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        iteration INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        hypothesis TEXT NOT NULL,
        rationale TEXT,
        code_diff TEXT,
        bpw REAL,
        degradation_pct REAL,
        pareto_score REAL,
        compression_ratio REAL,
        duration_sec REAL,
        status TEXT NOT NULL,
        stdout TEXT,
        stderr TEXT
      );

      CREATE TABLE IF NOT EXISTS state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  insertExperiment(exp) {
    const stmt = this.db.prepare(`
      INSERT INTO experiments (
        iteration, timestamp, hypothesis, rationale, code_diff,
        bpw, degradation_pct, pareto_score, compression_ratio,
        duration_sec, status, stdout, stderr
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      exp.iteration,
      exp.timestamp || new Date().toISOString(),
      exp.hypothesis,
      exp.rationale || '',
      exp.code_diff || '',
      exp.bpw !== undefined ? exp.bpw : null,
      exp.degradation_pct !== undefined ? exp.degradation_pct : null,
      exp.pareto_score !== undefined ? exp.pareto_score : null,
      exp.compression_ratio !== undefined ? exp.compression_ratio : null,
      exp.duration_sec !== undefined ? exp.duration_sec : null,
      exp.status,
      exp.stdout || '',
      exp.stderr || ''
    );
  }

  getAllExperiments() {
    const stmt = this.db.prepare(`
      SELECT id, iteration, timestamp, hypothesis, rationale,
             bpw, degradation_pct, pareto_score, compression_ratio,
             duration_sec, status
      FROM experiments
      ORDER BY iteration DESC
    `);
    return stmt.all();
  }

  getExperimentById(id) {
    const stmt = this.db.prepare(`SELECT * FROM experiments WHERE id = ?`);
    return stmt.get(id);
  }

  getBestExperiment() {
    const stmt = this.db.prepare(`
      SELECT * FROM experiments
      WHERE status = 'KEEP' AND pareto_score IS NOT NULL
      ORDER BY pareto_score ASC
      LIMIT 1
    `);
    return stmt.get();
  }

  setState(key, value) {
    const stmt = this.db.prepare(`
      INSERT INTO state (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    stmt.run(key, JSON.stringify(value));
  }

  getState(key, defaultValue = null) {
    const stmt = this.db.prepare(`SELECT value FROM state WHERE key = ?`);
    const row = stmt.get(key);
    if (!row) return defaultValue;
    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  }
}

export const db = new ExperimentDB();
