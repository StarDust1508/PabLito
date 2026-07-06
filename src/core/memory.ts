/**
 * Долгая память Паблито v2 (SQLite / expo-sqlite).
 * - Типизированные факты с заменой устаревших (переезд → старый адрес аннулируется).
 * - Персистентный транскрипт (messages) + сессии с резюме.
 * - SM-2-подобная SRS (см. memory-logic.ts).
 * - Обещания (commitments), профиль, стрик, настроение, режим дня.
 * - Миграции по PRAGMA user_version, последовательная очередь записи против гонок.
 */
import * as SQLite from 'expo-sqlite';
import { DayTone, Mood, newMood } from '@/core/mood';
import { Streak } from '@/core/progress';
import {
  FactKind,
  ReviewOutcome,
  SrsState,
  VERSIONED_KINDS,
  accumulateSubjectKey,
  applyReviewSM2,
  normalize,
  resolveImportance,
} from '@/core/memory-logic';

const SCHEMA_VERSION = 2;

/* ------------------------- очередь записи (против гонок) ------------------------- */
let writeChain: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const p = writeChain.then(fn, fn) as Promise<T>;
  writeChain = p.then(
    () => undefined,
    () => undefined
  );
  return p;
}

/* ------------------------------ открытие + миграции ------------------------------ */
let _dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function columnsOf(d: SQLite.SQLiteDatabase, table: string): Promise<string[]> {
  const rows = await d.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.map((r) => r.name);
}

async function ensureColumns(
  d: SQLite.SQLiteDatabase,
  table: string,
  defs: { name: string; ddl: string }[]
): Promise<void> {
  const cols = await columnsOf(d, table);
  for (const def of defs) {
    if (!cols.includes(def.name)) {
      await d.execAsync(`ALTER TABLE ${table} ADD COLUMN ${def.ddl}`);
    }
  }
}

async function migrate(d: SQLite.SQLiteDatabase): Promise<void> {
  await d.execAsync(
    `PRAGMA journal_mode = WAL;
     CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);`
  );

  // ── facts: если старая плоская схема (без kind) — мигрируем с сохранением текста.
  const factCols = await columnsOf(d, 'facts');
  if (factCols.length === 0) {
    await d.execAsync(FACTS_DDL);
  } else if (!factCols.includes('kind')) {
    await d.execAsync('ALTER TABLE facts RENAME TO facts_old;');
    await d.execAsync(FACTS_DDL);
    const old = await d.getAllAsync<{ text: string; created_at: number }>(
      'SELECT text, created_at FROM facts_old'
    );
    const now = Date.now();
    for (const o of old) {
      const norm = normalize(o.text);
      if (!norm) continue;
      await d.runAsync(
        `INSERT OR IGNORE INTO facts (kind, subject_key, text, norm_text, importance, status, source, created_at, updated_at)
         VALUES ('preference', ?, ?, ?, 1, 'active', 'migrated', ?, ?)`,
        [accumulateSubjectKey('preference', norm), o.text, norm, o.created_at || now, o.created_at || now]
      );
    }
    await d.execAsync('DROP TABLE facts_old;');
  }
  await d.execAsync(FACTS_INDEXES);

  // ── vocab: добавляем недостающие SM-2 колонки к существующей таблице.
  const vocabCols = await columnsOf(d, 'vocab');
  if (vocabCols.length === 0) {
    await d.execAsync(VOCAB_DDL);
  } else {
    await ensureColumns(d, 'vocab', [
      { name: 'ease', ddl: 'ease REAL NOT NULL DEFAULT 2.5' },
      { name: 'correct_streak', ddl: 'correct_streak INTEGER NOT NULL DEFAULT 0' },
      { name: 'lapses', ddl: 'lapses INTEGER NOT NULL DEFAULT 0' },
      { name: 'last_result', ddl: 'last_result TEXT' },
      { name: 'source', ddl: "source TEXT NOT NULL DEFAULT 'model_mem'" },
      { name: 'created_at', ddl: 'created_at INTEGER NOT NULL DEFAULT 0' },
      { name: 'updated_at', ddl: 'updated_at INTEGER NOT NULL DEFAULT 0' },
    ]);
  }

  // ── sessions: добавляем недостающие колонки.
  const sessCols = await columnsOf(d, 'sessions');
  if (sessCols.length === 0) {
    await d.execAsync(SESSIONS_DDL);
  } else {
    await ensureColumns(d, 'sessions', [
      { name: 'ended_at', ddl: 'ended_at INTEGER' },
      { name: 'turn_count', ddl: 'turn_count INTEGER NOT NULL DEFAULT 0' },
      { name: 'mood_end', ddl: 'mood_end TEXT' },
    ]);
  }

  // ── новые таблицы.
  await d.execAsync(
    `CREATE TABLE IF NOT EXISTS messages (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       session_id INTEGER NOT NULL,
       turn_index INTEGER NOT NULL,
       role TEXT NOT NULL,
       content TEXT NOT NULL,
       created_at INTEGER NOT NULL
     );
     CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, turn_index);
     CREATE TABLE IF NOT EXISTS commitments (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       text TEXT NOT NULL,
       status TEXT NOT NULL DEFAULT 'open',
       due_hint TEXT,
       created_at INTEGER NOT NULL,
       resolved_at INTEGER
     );
     CREATE TABLE IF NOT EXISTS emotional_moments (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       ts INTEGER NOT NULL,
       kind TEXT NOT NULL,
       summary TEXT NOT NULL,
       warmth INTEGER,
       energy INTEGER,
       resurfaced INTEGER NOT NULL DEFAULT 0
     );`
  );

  await d.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

const FACTS_DDL = `CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  text TEXT NOT NULL,
  norm_text TEXT NOT NULL,
  value_json TEXT,
  importance INTEGER NOT NULL DEFAULT 2,
  status TEXT NOT NULL DEFAULT 'active',
  confidence REAL NOT NULL DEFAULT 0.8,
  source TEXT NOT NULL DEFAULT 'model_mem',
  session_id INTEGER,
  superseded_by INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_used_at INTEGER
);`;

const FACTS_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject_key, status);
  CREATE INDEX IF NOT EXISTS idx_facts_kind ON facts(kind, status, importance DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_facts_norm_active ON facts(subject_key, norm_text) WHERE status='active';
`;

const VOCAB_DDL = `CREATE TABLE IF NOT EXISTS vocab (
  word TEXT PRIMARY KEY,
  translation TEXT,
  box INTEGER NOT NULL DEFAULT 1,
  ease REAL NOT NULL DEFAULT 2.5,
  due_at INTEGER NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0,
  correct_streak INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  last_result TEXT,
  source TEXT NOT NULL DEFAULT 'model_mem',
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_vocab_due ON vocab(due_at);`;

const SESSIONS_DDL = `CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  turn_count INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  mood_end TEXT
);`;

async function db(): Promise<SQLite.SQLiteDatabase> {
  // Кэшируем ПРОМИС (не значение), чтобы параллельные первые вызовы не запустили
  // migrate() дважды (гонка на DDL при холодном старте).
  if (!_dbPromise) {
    _dbPromise = (async () => {
      const d = await SQLite.openDatabaseAsync('pablito.db');
      await migrate(d);
      return d;
    })();
  }
  return _dbPromise;
}

/* ------------------------------ kv-хелперы ------------------------------ */
async function kvGet(key: string): Promise<string | null> {
  const d = await db();
  const row = await d.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key]);
  return row?.value ?? null;
}
async function kvSet(key: string, value: string): Promise<void> {
  const d = await db();
  await d.runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', [key, value]);
}

/* ------------------------------ настроение ------------------------------ */
export async function loadMood(): Promise<Mood> {
  const v = await kvGet('mood');
  if (!v) return newMood();
  try {
    // merge с дефолтами — старые сохранения без bond получают BOND_START
    return { ...newMood(), ...(JSON.parse(v) as Partial<Mood>) };
  } catch {
    return newMood();
  }
}
export function saveMood(m: Mood): Promise<void> {
  return enqueue(() => kvSet('mood', JSON.stringify(m)));
}

/* ------------------------------ профиль ------------------------------ */
export interface Profile {
  name: string | null;
  moveDate: string | null;
  onboarded: boolean;
}
const EMPTY_PROFILE: Profile = { name: null, moveDate: null, onboarded: false };

export async function getProfile(): Promise<Profile> {
  const v = await kvGet('profile');
  if (!v) return { ...EMPTY_PROFILE };
  try {
    return { ...EMPTY_PROFILE, ...(JSON.parse(v) as Partial<Profile>) };
  } catch {
    return { ...EMPTY_PROFILE };
  }
}
export function setProfile(patch: Partial<Profile>): Promise<Profile> {
  return enqueue(async () => {
    const cur = await getProfile();
    const next = { ...cur, ...patch };
    await kvSet('profile', JSON.stringify(next));
    return next;
  });
}

/* ------------------------------ стрик ------------------------------ */
export async function getStreak(): Promise<Streak | null> {
  const v = await kvGet('streak');
  if (!v) return null;
  try {
    return JSON.parse(v) as Streak;
  } catch {
    return null;
  }
}
export function saveStreak(s: Streak): Promise<void> {
  return enqueue(() => kvSet('streak', JSON.stringify(s)));
}

/* ------------------------------ режим дня ------------------------------ */
export type LessonMode = 'lesson' | 'chat';
export async function getLessonMode(today: string): Promise<LessonMode | null> {
  const v = await kvGet('lesson_mode');
  if (!v) return null;
  try {
    const j = JSON.parse(v) as { day: string; mode: LessonMode };
    return j.day === today ? j.mode : null;
  } catch {
    return null;
  }
}
export function setLessonMode(mode: LessonMode, today: string): Promise<void> {
  return enqueue(() => kvSet('lesson_mode', JSON.stringify({ day: today, mode })));
}

/* ------------------------------ метки времени ------------------------------ */
export async function getLastSeen(): Promise<number | null> {
  const v = await kvGet('last_seen');
  return v ? Number(v) : null;
}
export function touchLastSeen(ts = Date.now()): Promise<void> {
  return enqueue(() => kvSet('last_seen', String(ts)));
}
export function daysBetween(from: number | null, to = Date.now()): number {
  if (!from) return 0;
  return Math.max(0, Math.floor((to - from) / 86_400_000)); // не уходим в минус при переводе часов
}

/* ------------------------------ факты (типизированные) ------------------------------ */
export interface FactInput {
  kind: FactKind;
  subjectKey?: string;
  text: string;
  importance?: number;
  valueJson?: string;
}
export interface ActiveFact {
  id: number;
  kind: FactKind;
  subjectKey: string;
  text: string;
  importance: number;
}

export function upsertFact(f: FactInput, sessionId: number | null = null): Promise<void> {
  return enqueue(async () => {
    const d = await db();
    const norm = normalize(f.text);
    if (!norm) return;
    const versioned = VERSIONED_KINDS.includes(f.kind);
    // Версионируемые (identity/state/goal) — по устойчивому subject_key (замена старого).
    // Остальные — накапливаются: ключ включает текст, так разные факты не вытесняют друг друга.
    const subject = versioned ? f.subjectKey?.trim() || accumulateSubjectKey(f.kind, norm) : accumulateSubjectKey(f.kind, norm);
    const importance = resolveImportance(f.kind, subject, f.importance);
    const now = Date.now();

    const existing = await d.getFirstAsync<{ id: number; norm_text: string }>(
      "SELECT id, norm_text FROM facts WHERE subject_key = ? AND status = 'active'",
      [subject]
    );

    if (existing) {
      if (existing.norm_text === norm) {
        await d.runAsync('UPDATE facts SET last_used_at = ?, updated_at = ? WHERE id = ?', [now, now, existing.id]);
        return;
      }
      if (versioned) {
        await d.runAsync("UPDATE facts SET status = 'superseded', updated_at = ? WHERE id = ?", [now, existing.id]);
        const res = await d.runAsync(
          `INSERT OR IGNORE INTO facts (kind, subject_key, text, norm_text, value_json, importance, session_id, created_at, updated_at, last_used_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [f.kind, subject, f.text, norm, f.valueJson ?? null, importance, sessionId, now, now, now]
        );
        await d.runAsync('UPDATE facts SET superseded_by = ? WHERE id = ?', [res.lastInsertRowId, existing.id]);
        return;
      }
      return; // не-версионируемый факт с той же темой уже есть — не дублируем
    }

    await d.runAsync(
      `INSERT OR IGNORE INTO facts (kind, subject_key, text, norm_text, value_json, importance, session_id, created_at, updated_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [f.kind, subject, f.text, norm, f.valueJson ?? null, importance, sessionId, now, now, now]
    );
  });
}

export async function getActiveFacts(): Promise<ActiveFact[]> {
  const d = await db();
  const rows = await d.getAllAsync<{
    id: number;
    kind: FactKind;
    subject_key: string;
    text: string;
    importance: number;
  }>(
    "SELECT id, kind, subject_key, text, importance FROM facts WHERE status='active' ORDER BY importance DESC, updated_at DESC"
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    subjectKey: r.subject_key,
    text: r.text,
    importance: r.importance,
  }));
}

export function updateFact(id: number, text: string): Promise<void> {
  return enqueue(async () => {
    const d = await db();
    await d.runAsync("UPDATE facts SET text = ?, norm_text = ?, source = 'user_edit', updated_at = ? WHERE id = ?", [
      text,
      normalize(text),
      Date.now(),
      id,
    ]);
  });
}

export function deleteFact(id: number): Promise<void> {
  return enqueue(async () => {
    const d = await db();
    await d.runAsync("UPDATE facts SET status = 'archived', updated_at = ? WHERE id = ?", [Date.now(), id]);
  });
}

/** Релевантные факты для промпта по бюджету символов (закреплённые + цели + эмоции + обещания + остальное). */
export async function getFactsForPrompt(budgetChars = 1500): Promise<string[]> {
  const d = await db();
  const q = (sql: string, args: unknown[] = []) => d.getAllAsync<{ text: string }>(sql, args as SQLite.SQLiteBindValue[]);

  const pinned = await q("SELECT text FROM facts WHERE importance=3 AND status='active' ORDER BY updated_at DESC");
  const goals = await q("SELECT text FROM facts WHERE kind='goal' AND status='active' ORDER BY updated_at DESC LIMIT 3");
  const emo = await q("SELECT text FROM facts WHERE kind='emotional' AND status='active' ORDER BY created_at DESC LIMIT 3");
  const commit = await q("SELECT text FROM commitments WHERE status='open' ORDER BY created_at DESC LIMIT 3");
  const rest = await q(
    "SELECT text FROM facts WHERE status='active' AND importance IN (1,2) ORDER BY importance DESC, updated_at DESC LIMIT 40"
  );

  const out: string[] = [];
  const seen = new Set<string>();
  let used = 0;
  const add = (t: string, force = false) => {
    if (seen.has(t)) return;
    if (!force && used + t.length > budgetChars) return;
    seen.add(t);
    out.push(t);
    used += t.length;
  };
  pinned.forEach((r) => add(r.text, true)); // закреплённые — всегда
  goals.forEach((r) => add(r.text, true));
  emo.forEach((r) => add(r.text));
  commit.forEach((r) => add(`обещание: ${r.text}`));
  rest.forEach((r) => add(r.text));
  return out;
}

/* ------------------------------ обещания ------------------------------ */
export function addCommitments(items: { text: string; dueHint?: string }[]): Promise<void> {
  return enqueue(async () => {
    if (!items.length) return;
    const d = await db();
    const now = Date.now();
    for (const it of items) {
      const text = it.text.trim();
      if (text) {
        await d.runAsync('INSERT INTO commitments (text, due_hint, created_at) VALUES (?, ?, ?)', [
          text,
          it.dueHint ?? null,
          now,
        ]);
      }
    }
  });
}

/* ------------------------------ словарь + SRS (SM-2) ------------------------------ */
export interface VocabItem {
  word: string;
  translation?: string;
  context?: ReviewOutcome | 'new';
}

export function upsertVocab(items: VocabItem[]): Promise<void> {
  return enqueue(async () => {
    const d = await db();
    const now = Date.now();
    for (const it of items) {
      const word = it.word?.trim();
      if (!word) continue;
      const existing = await d.getFirstAsync<SrsState & { word: string }>(
        'SELECT box, ease, seen, correct_streak, lapses FROM vocab WHERE word = ?',
        [word]
      );
      if (existing) {
        if (it.context && it.context !== 'new') {
          const r = applyReviewSM2(existing, it.context, now);
          await d.runAsync(
            'UPDATE vocab SET box=?, ease=?, seen=?, correct_streak=?, lapses=?, due_at=?, last_result=?, updated_at=? WHERE word=?',
            [r.box, r.ease, r.seen, r.correct_streak, r.lapses, r.due_at, r.last_result, now, word]
          );
        } else if (it.translation) {
          await d.runAsync('UPDATE vocab SET translation = COALESCE(?, translation), updated_at=? WHERE word=?', [
            it.translation,
            now,
            word,
          ]);
        }
      } else {
        await d.runAsync(
          `INSERT INTO vocab (word, translation, box, ease, due_at, seen, created_at, updated_at)
           VALUES (?, ?, 1, 2.5, ?, 0, ?, ?)`,
          [word, it.translation ?? null, now, now, now]
        );
      }
    }
  });
}

const NEW_PER_DAY = 3;
/** Слова к повторению: сначала просроченные, дозируем новые. */
export async function getDueVocab(limit = 6): Promise<string[]> {
  const d = await db();
  const now = Date.now();
  const newSlots = Math.min(NEW_PER_DAY, limit);
  // Резервируем слоты под новые слова, чтобы просроченные не вытеснили их полностью.
  const overdue = await d.getAllAsync<{ word: string; translation: string | null }>(
    'SELECT word, translation FROM vocab WHERE due_at <= ? AND seen > 0 ORDER BY due_at ASC LIMIT ?',
    [now, limit - newSlots]
  );
  const fresh = await d.getAllAsync<{ word: string; translation: string | null }>(
    'SELECT word, translation FROM vocab WHERE seen = 0 ORDER BY created_at ASC LIMIT ?',
    [newSlots]
  );
  const mixed = [...overdue, ...fresh].slice(0, limit);
  return mixed.map((r) => (r.translation ? `${r.word} (${r.translation})` : r.word));
}

export interface LearnedWord {
  word: string;
  translation: string | null;
  box: number;
  seen: number;
}
export async function getLearnedWords(): Promise<LearnedWord[]> {
  const d = await db();
  return d.getAllAsync<LearnedWord>(
    'SELECT word, translation, box, seen FROM vocab ORDER BY box DESC, seen DESC, word ASC'
  );
}
export async function learnedCount(): Promise<number> {
  const d = await db();
  const row = await d.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM vocab WHERE box >= 2');
  return row?.n ?? 0;
}

/* ------------------------------ транскрипт (messages) ------------------------------ */
export type MsgRole = 'user' | 'assistant' | 'system';
export function addMessage(sessionId: number, turnIndex: number, role: MsgRole, content: string): Promise<void> {
  return enqueue(async () => {
    const d = await db();
    await d.runAsync(
      'INSERT INTO messages (session_id, turn_index, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
      [sessionId, turnIndex, role, content, Date.now()]
    );
  });
}
export async function countMessages(sessionId: number): Promise<number> {
  const d = await db();
  const row = await d.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM messages WHERE session_id = ?', [sessionId]);
  return row?.n ?? 0;
}
export async function getLastMessages(sessionId: number, n: number): Promise<{ role: MsgRole; content: string }[]> {
  const d = await db();
  const rows = await d.getAllAsync<{ role: MsgRole; content: string }>(
    'SELECT role, content FROM messages WHERE session_id = ? ORDER BY turn_index DESC LIMIT ?',
    [sessionId, n]
  );
  return rows.reverse();
}

/* ------------------------------ сессии ------------------------------ */
export async function startSession(): Promise<number> {
  const d = await db();
  const res = await d.runAsync('INSERT INTO sessions (started_at) VALUES (?)', [Date.now()]);
  return res.lastInsertRowId;
}
export async function getOpenSession(): Promise<{ id: number; started_at: number } | null> {
  const d = await db();
  const row = await d.getFirstAsync<{ id: number; started_at: number }>(
    'SELECT id, started_at FROM sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1'
  );
  return row ?? null;
}
/** Время последней активности сессии (последнее сообщение) — для окна resume. */
export async function getSessionLastActivity(sessionId: number): Promise<number | null> {
  const d = await db();
  const row = await d.getFirstAsync<{ t: number }>('SELECT MAX(created_at) AS t FROM messages WHERE session_id = ?', [sessionId]);
  return row?.t ?? null;
}
export function finishSession(id: number, summary?: string, moodEnd?: Mood): Promise<void> {
  return enqueue(async () => {
    const d = await db();
    await d.runAsync('UPDATE sessions SET ended_at = ?, summary = COALESCE(?, summary), mood_end = COALESCE(?, mood_end) WHERE id = ?', [
      Date.now(),
      summary ?? null,
      moodEnd ? JSON.stringify(moodEnd) : null,
      id,
    ]);
  });
}
/** Резюме прошлой завершённой сессии — для блока «о чём говорили в прошлый раз». */
export async function getLastSessionSummary(excludeId?: number): Promise<string | null> {
  const d = await db();
  const row = await d.getFirstAsync<{ summary: string }>(
    'SELECT summary FROM sessions WHERE summary IS NOT NULL AND ended_at IS NOT NULL AND id != ? ORDER BY id DESC LIMIT 1',
    [excludeId ?? -1]
  );
  return row?.summary ?? null;
}

/* ------------------------------ тонус дня + счётчики ------------------------------ */
export async function getDayTone(today: string): Promise<DayTone | null> {
  const v = await kvGet('day_tone');
  if (!v) return null;
  try {
    const j = JSON.parse(v) as { day: string; tone: DayTone };
    return j.day === today ? j.tone : null;
  } catch {
    return null;
  }
}
export function setDayTone(tone: DayTone, today: string): Promise<void> {
  return enqueue(() => kvSet('day_tone', JSON.stringify({ day: today, tone })));
}

export async function getLongestStreak(): Promise<number> {
  const v = await kvGet('longest_streak');
  return v ? Number(v) : 0;
}
export function setLongestStreak(n: number): Promise<void> {
  return enqueue(() => kvSet('longest_streak', String(n)));
}
export async function bumpTotalSessions(): Promise<number> {
  const cur = Number((await kvGet('total_sessions')) ?? '0') + 1;
  await enqueue(() => kvSet('total_sessions', String(cur)));
  return cur;
}

/* ------------------------------ эмоциональные моменты ------------------------------ */
export interface Moment {
  id: number;
  ts: number;
  kind: string;
  summary: string;
  resurfaced: number;
}

export function addMoment(kind: string, summary: string, snapshot?: Mood): Promise<void> {
  return enqueue(async () => {
    const text = summary.trim();
    if (!text) return;
    const d = await db();
    await d.runAsync('INSERT INTO emotional_moments (ts, kind, summary, warmth, energy) VALUES (?, ?, ?, ?, ?)', [
      Date.now(),
      kind,
      text,
      snapshot?.warmth ?? null,
      snapshot?.energy ?? null,
    ]);
  });
}

/** 1-2 самых свежих и наименее «затёртых» момента для промпта; помечает их использованными. */
export async function getRelevantMoments(limit = 2): Promise<string[]> {
  const d = await db();
  const rows = await d.getAllAsync<{ id: number; summary: string }>(
    'SELECT id, summary FROM emotional_moments ORDER BY resurfaced ASC, ts DESC LIMIT ?',
    [limit]
  );
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    await enqueue(async () => {
      await d.runAsync(
        `UPDATE emotional_moments SET resurfaced = resurfaced + 1 WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
      );
    });
  }
  return rows.map((r) => r.summary);
}

/** Как getRelevantMoments, но БЕЗ инкремента resurfaced (для resume — не «затираем» лишний раз). */
export async function getMomentsPreview(limit = 2): Promise<string[]> {
  const d = await db();
  const rows = await d.getAllAsync<{ summary: string }>(
    'SELECT summary FROM emotional_moments ORDER BY resurfaced ASC, ts DESC LIMIT ?',
    [limit]
  );
  return rows.map((r) => r.summary);
}

export async function getAllMoments(): Promise<Moment[]> {
  const d = await db();
  return d.getAllAsync<Moment>('SELECT id, ts, kind, summary, resurfaced FROM emotional_moments ORDER BY ts DESC');
}

/* ------------------------------ экспорт / сброс ------------------------------ */
export async function exportMemory(): Promise<string> {
  const facts = await getActiveFacts();
  const words = await getLearnedWords();
  const moments = await getAllMoments();
  const d = await db();
  const commitments = await d.getAllAsync('SELECT text, status, created_at FROM commitments');
  return JSON.stringify({ exportedAt: new Date().toISOString(), facts, words, moments, commitments }, null, 2);
}

/**
 * Стереть то, «что Паблито обо мне знает»: факты, обещания, моменты И транскрипт
 * (иначе модель восстановила бы факты из истории сообщений). Словарь/прогресс не трогаем.
 */
export function clearKnowledge(): Promise<void> {
  return enqueue(async () => {
    const d = await db();
    await d.execAsync('DELETE FROM facts; DELETE FROM commitments; DELETE FROM emotional_moments; DELETE FROM messages;');
  });
}
