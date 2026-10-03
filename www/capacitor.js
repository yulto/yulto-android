/* ═══════════════════════════════════════════════════════════════════
   OPSIN MEDICALS — native layer v7.0
   ═══════════════════════════════════════════════════════════════════ */
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { LocalNotifications } from '@capacitor/local-notifications';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';

const DB_NAME = 'yulto';
const DB_VER = 7;
const sqlite = new SQLiteConnection(CapacitorSQLite);
let db = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, mrn TEXT, dob TEXT, sex TEXT,
  diabetes INTEGER DEFAULT 0, pvd INTEGER DEFAULT 0, smoker INTEGER DEFAULT 0,
  hba1c REAL, notes TEXT, photoConsent INTEGER DEFAULT 0,
  createdAt INTEGER, updatedAt INTEGER
);
CREATE TABLE IF NOT EXISTS wounds (
  id TEXT PRIMARY KEY, patientId TEXT NOT NULL, label TEXT NOT NULL,
  type TEXT, location TEXT, status TEXT DEFAULT 'active', notes TEXT,
  stage TEXT, template TEXT, nextVisit INTEGER,
  baselineArea REAL, onsetDate INTEGER,
  createdAt INTEGER, updatedAt INTEGER
);
CREATE TABLE IF NOT EXISTS assessments (
  id TEXT PRIMARY KEY, woundId TEXT NOT NULL, imageId TEXT,
  areaCm2 REAL, perimeterCm REAL, lengthCm REAL, widthCm REAL,
  depthCm REAL, volumeCm3 REAL, tissue TEXT, infection REAL,
  healingIndex REAL, expectedDays INTEGER, optimisticDays INTEGER,
  pessimisticDays INTEGER, ratePerWeek REAL, calibrated INTEGER,
  pain INTEGER, exudate TEXT, odor TEXT, periwound TEXT,
  underminingCm REAL, tunnelingCm REAL, tags TEXT, clinician TEXT,
  imageQuality REAL, circularity REAL, elongation REAL, edgeIrregularity REAL,
  wbpScore INTEGER, designScore INTEGER, biofilm INTEGER,
  cultureResult TEXT, cultureOrganism TEXT,
  dressings TEXT, compression TEXT, offloading TEXT, debridement TEXT,
  notes TEXT, createdAt INTEGER
);
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY, woundId TEXT NOT NULL, dataUrl TEXT,
  width INTEGER, height INTEGER, annotation TEXT, createdAt INTEGER
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
    await migrate();
  } catch (e) { console.error('[opsin] SQLite open failed:', e); throw e; }
}

async function migrate() {
  const alters = [
    'ALTER TABLE wounds ADD COLUMN stage TEXT',
    'ALTER TABLE wounds ADD COLUMN template TEXT',
    'ALTER TABLE wounds ADD COLUMN nextVisit INTEGER',
    'ALTER TABLE wounds ADD COLUMN baselineArea REAL',
    'ALTER TABLE wounds ADD COLUMN onsetDate INTEGER',
    'ALTER TABLE assessments ADD COLUMN pain INTEGER',
    'ALTER TABLE assessments ADD COLUMN exudate TEXT',
    'ALTER TABLE assessments ADD COLUMN odor TEXT',
    'ALTER TABLE assessments ADD COLUMN periwound TEXT',
    'ALTER TABLE assessments ADD COLUMN underminingCm REAL',
    'ALTER TABLE assessments ADD COLUMN tunnelingCm REAL',
    'ALTER TABLE assessments ADD COLUMN tags TEXT',
    'ALTER TABLE assessments ADD COLUMN clinician TEXT',
    'ALTER TABLE assessments ADD COLUMN imageQuality REAL',
    'ALTER TABLE assessments ADD COLUMN circularity REAL',
    'ALTER TABLE assessments ADD COLUMN elongation REAL',
    'ALTER TABLE assessments ADD COLUMN edgeIrregularity REAL',
    'ALTER TABLE assessments ADD COLUMN notes TEXT',
    'ALTER TABLE assessments ADD COLUMN wbpScore INTEGER',
    'ALTER TABLE assessments ADD COLUMN designScore INTEGER',
    'ALTER TABLE assessments ADD COLUMN biofilm INTEGER',
    'ALTER TABLE assessments ADD COLUMN cultureResult TEXT',
    'ALTER TABLE assessments ADD COLUMN cultureOrganism TEXT',
    'ALTER TABLE assessments ADD COLUMN dressings TEXT',
    'ALTER TABLE assessments ADD COLUMN compression TEXT',
    'ALTER TABLE assessments ADD COLUMN offloading TEXT',
    'ALTER TABLE assessments ADD COLUMN debridement TEXT',
    'ALTER TABLE images ADD COLUMN annotation TEXT',
    'ALTER TABLE patients ADD COLUMN photoConsent INTEGER DEFAULT 0',
  ];
  for (const sql of alters) { try { await db.execute(sql); } catch (_) {} }
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
    const v = typeof value.v === 'object' ? JSON.stringify(value.v) : String(value.v);
    await db.run('INSERT OR REPLACE INTO settings (k, v) VALUES (?, ?)', [value.k, v]);
    return value;
  }
  const row = ser(value);
  const cols = Object.keys(row);
  const ph = cols.map(() => '?').join(',');
  await db.run(`INSERT OR REPLACE INTO ${store} (${cols.join(',')}) VALUES (${ph})`, cols.map(c => row[c]));
  return value;
}
async function get(store, key) {
  if (store === 'settings') {
    const r = await db.query('SELECT k, v FROM settings WHERE k = ?', [key]);
    const row = r.values?.[0];
    if (!row) return null;
    let v = row.v; try { v = JSON.parse(v); } catch {}
    return { k: row.k, v };
  }
  const r = await db.query(`SELECT * FROM ${store} WHERE id = ?`, [key]);
  const row = r.values?.[0];
  return row ? deser(row) : null;
}
async function all(store, idx, key) {
  const sql = key && idx ? `SELECT * FROM ${store} WHERE ${idx} = ?` : `SELECT * FROM ${store}`;
  const r = await db.query(sql, key ? [key] : []);
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
    app: 'OPSIN MEDICALS', version: '7.0-native',
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
  const filename = `opsin-backup-${stamp}.json`;
  try {
    await Filesystem.writeFile({
      path: `OPSIN_MEDICALS_BACKUPS/${filename}`,
      data: json, directory: Directory.Documents,
      encoding: Encoding.UTF8, recursive: true,
    });
  } catch (e) { console.warn('persist copy failed', e); }
  const cache = await Filesystem.writeFile({
    path: filename, data: json,
    directory: Directory.Cache, encoding: Encoding.UTF8,
  });
  await put('backups', { id: stamp, filename, ts: Date.now(), reason: reason || 'manual', size: json.length });
  await put('settings', { k: 'last_backup_ts', v: Date.now() });
  return { filename, uri: cache.uri };
}

async function shareBackup(reason) {
  const r = await exportBackup(reason);
  await Share.share({
    title: 'OPSIN MEDICALS backup',
    text: `Backup file: ${r.filename}. Email it to yourself or save to Drive.`,
    url: r.uri, dialogTitle: 'Send backup to…',
  });
  return r;
}

async function saveAndShareFile(base64Data, filename, mimeType) {
  const result = await Filesystem.writeFile({
    path: filename,
    data: base64Data,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  await Share.share({
    title: filename,
    url: result.uri,
    dialogTitle: 'Save or send file',
  });
  return result;
}

async function saveAndShareBinary(base64Data, filename, mimeType) {
  const result = await Filesystem.writeFile({
    path: filename,
    data: base64Data,
    directory: Directory.Cache,
  });
  await Share.share({
    title: filename,
    url: result.uri,
    dialogTitle: 'Save or send file',
  });
  return result;
}

async function shareText({ title, text }) {
  await Share.share({ title, text, dialogTitle: title });
}

async function speak(text) {
  try {
    await TextToSpeech.speak({
      text: text,
      lang: 'en-US',
      rate: 0.95,
      pitch: 1.0,
      volume: 1.0,
    });
  } catch (e) {
    console.warn('TTS failed', e);
  }
}
async function stopSpeaking() {
  try { await TextToSpeech.stop(); } catch (e) {}
}

async function startListening() {
  try {
    const perm = await SpeechRecognition.requestPermissions();
    if (perm.speechRecognition !== 'granted') return { error: 'permission denied' };
    const result = await SpeechRecognition.start({
      language: 'en-US',
      maxResults: 1,
      prompt: 'Speak now…',
      partialResults: false,
      popup: false,
    });
    if (result?.matches?.length) return { text: result.matches[0] };
    return { text: '' };
  } catch (e) {
    return { error: e.message };
  }
}
async function stopListening() {
  try { await SpeechRecognition.stop(); } catch (e) {}
}

async function scheduleBackupReminder() {
  try {
    await LocalNotifications.requestPermissions();
    await LocalNotifications.cancel({ notifications: [{ id: 1001 }] });
    const threeDays = Date.now() + 3*24*60*60*1000;
    await LocalNotifications.schedule({
      notifications: [{
        id: 1001,
        title: 'OPSIN MEDICALS',
        body: 'Time to back up your patient data. Tap to open.',
        schedule: { at: new Date(threeDays), allowWhileIdle: true },
        smallIcon: 'ic_stat_icon',
        channelId: 'opsin-backup',
      }],
    });
    await LocalNotifications.createChannel({
      id: 'opsin-backup',
      name: 'Backup reminders',
      importance: 3,
    });
  } catch (e) { console.warn('notification schedule failed', e); }
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
  exportBackup, shareBackup, shareText, importFromFileJson,
  saveAndShareFile, saveAndShareBinary,
  speak, stopSpeaking, startListening, stopListening,
  scheduleBackupReminder,
};
window.YULTO_READY = true;
console.log('[opsin] native layer v7.0 ready');
