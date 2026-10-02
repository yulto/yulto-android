/* ═══════════════════════════════════════════════════════════════════
   YULTO CARE — native layer
   Real SQLite database + real backup files, on the phone.
   ═══════════════════════════════════════════════════════════════════ */
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const DB_NAME = 'yulto';
const DB_VER = 1;
const sqlite = new SQLiteConnection(CapacitorSQLite);
let db = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, mrn TEXT, dob TEXT, sex TEXT,
  diabetes INTEGER DEFAULT 0, pvd INTEGER DEFAULT 0, smoker INTEGER DEFAULT 0,
  hba1c REAL, notes TEXT, createdAt INTEGER, updatedAt INTEGER
);
CREATE TABLE IF NOT EXISTS wounds (
  id TEXT PRIMARY KEY, patientId TEXT NOT NULL, label TEXT NOT NULL,
  type TEXT, location TEXT, status TEXT DEFAULT 'active', notes TEXT,
  createdAt INTEGER, updatedAt INTEGER
);
CREATE TABLE IF NOT EXISTS assessments (
  id TEXT PRIMARY KEY, woundId TEXT NOT NULL, imageId TEXT,
  areaCm2 REAL, perimeterCm REAL, lengthCm REAL, widthCm REAL,
  depthCm REAL, volumeCm3 REAL, tissue TEXT, infection REAL,
  healingIndex REAL, expectedDays INTEGER, optimisticDays INTEGER,
  pessimisticDays INTEGER, ratePerWeek REAL, calibrated INTEGER,
  createdAt INTEGER
);
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY, woundId TEXT NOT NULL, dataUrl TEXT,
  width INTEGER, height INTEGER, createdAt INTEGER
);
CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS audit (
  id TEXT PRIMARY KEY, action TEXT, details TEXT, ts INTEGER
);
CREATE TABLE IF NOT EXISTS backups (
  id TEXT PRIMARY KEY, filename TEXT, ts INTEGER, reason TEXT, size INTEGER
);
CREATE INDEX IF NOT EXISTS idx_wounds_patient ON wounds(patientId);
CREATE INDEX IF NOT EXISTS idx_assessments_wound ON assessments(woundId);
CREATE INDEX IF NOT EXISTS idx_images_wound ON images(woundId);
`;

async function openDB() {
  try {
    const isConn = (await sqlite.isConnection(DB_NAME, false)).result;
    db = isConn
      ? await sqlite.retrieveConnection(DB_NAME, false)
      : await sqlite.createConnection(DB_NAME, false, 'no-encryption', DB_VER, false);
    await db.open();
    await db.execute(SCHEMA);
    console.log('[yulto] SQLite opened:', DB_NAME);
  } catch (e) {
    console.error('[yulto] SQLite open failed:', e);
    throw e;
  }
}

function ser(value) {
  const out = {};
  for (const k in value) {
    const v = value[k];
    if (v === undefined) continue;
    if (v === null) out[k] = null;
    else if (typeof v === 'object') out[k] = JSON.stringify(v);
    else if (typeof v === 'boolean') out[k] = v ? 1 : 0;
    else out[k] = v;
  }
  return out;
}

function deser(row) {
  const out = {};
  for (const k in row) {
    const v = row[k];
    if (typeof v === 'string' && (v.startsWith('{') || v.startsWith('['))) {
      try { out[k] = JSON.parse(v); } catch { out[k] = v; }
    } else out[k] = v;
  }
  return out;
}

async function put(store, value) {
  if (store === 'settings') {
    const k = value.k;
    const v = typeof value.v === 'object' ? JSON.stringify(value.v) : String(value.v);
    await db.run('INSERT OR REPLACE INTO settings (k, v) VALUES (?, ?)', [k, v]);
    return value;
  }
  const row = ser(value);
  const cols = Object.keys(row);
  const ph = cols.map(() => '?').join(',');
  await db.run(
    `INSERT OR REPLACE INTO ${store} (${cols.join(',')}) VALUES (${ph})`,
    cols.map(c => row[c])
  );
  return value;
}

async function get(store, key) {
  if (store === 'settings') {
    const r = await db.query('SELECT k, v FROM settings WHERE k = ?', [key]);
    const row = r.values?.[0];
    if (!row) return null;
    let v = row.v;
    try { v = JSON.parse(v); } catch {}
    return { k: row.k, v };
  }
  const r = await db.query(`SELECT * FROM ${store} WHERE id = ?`, [key]);
  const row = r.values?.[0];
  return row ? deser(row) : null;
}

async function all(store, idx, key) {
  let sql, params = [];
  if (key && idx) { sql = `SELECT * FROM ${store} WHERE ${idx} = ?`; params = [key]; }
  else sql = `SELECT * FROM ${store}`;
  const r = await db.query(sql, params);
  return (r.values || []).map(deser);
}

async function del(store, key) {
  if (store === 'settings') await db.run('DELETE FROM settings WHERE k = ?', [key]);
  else await db.run(`DELETE FROM ${store} WHERE id = ?`, [key]);
}

async function clearAll() {
  for (const t of ['patients','wounds','assessments','images','audit','backups']) {
    await db.execute(`DELETE FROM ${t}`);
  }
}

async function buildPayload() {
  return {
    app: 'YULTO CARE',
    version: '4.0-native',
    exportedAt: new Date().toISOString(),
    patients: await all('patients'),
    wounds: await all('wounds'),
    assessments: await all('assessments'),
    images: await all('images'),
    audit: await all('audit'),
  };
}

async function exportBackup(reason) {
  const payload = await buildPayload();
  const json = JSON.stringify(payload);
  const stamp = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
  const filename = `yulto-backup-${stamp}.json`;

  try {
    await Filesystem.writeFile({
      path: `YULTO_CARE_BACKUPS/${filename}`,
      data: json,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true,
    });
  } catch (e) { console.warn('persist copy failed', e); }

  const cache = await Filesystem.writeFile({
    path: filename,
    data: json,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });

  await put('backups', { id: stamp, filename, ts: Date.now(), reason: reason || 'manual', size: json.length });
  await put('settings', { k: 'last_backup_ts', v: Date.now() });
  return { filename, uri: cache.uri };
}

async function shareBackup(reason) {
  const r = await exportBackup(reason);
  await Share.share({
    title: 'YULTO CARE backup',
    text: `Backup file: ${r.filename}. Email it to yourself or save to Drive.`,
    url: r.uri,
    dialogTitle: 'Send backup to…',
  });
  return r;
}

async function importFromFileJson(jsonText) {
  const data = JSON.parse(jsonText);
  await clearAll();
  for (const p of data.patients || []) await put('patients', p);
  for (const w of data.wounds || []) await put('wounds', w);
  for (const a of data.assessments || []) await put('assessments', a);
  for (const i of data.images || []) await put('images', i);
  for (const a of data.audit || []) await put('audit', a);
  return true;
}

window.yultoDB = {
  openDB, put, get, all, del, clearAll,
  exportBackup, shareBackup, importFromFileJson,
};
window.YULTO_READY = true;
console.log('[yulto] native layer ready');
