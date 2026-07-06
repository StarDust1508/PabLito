/**
 * Прогресс и мотивация — чистые функции (легко тестируются).
 * Стрик занятий, вехи и мягкий счётчик до переезда.
 * Принцип из решений владельца: стрик НИКОГДА не падает в 0, счётчик — рядом
 * с вехами, а не как тревожный таймер.
 */

export interface Streak {
  count: number;
  lastDay: string; // YYYY-MM-DD (локальная дата)
}

/** Локальная дата в формате YYYY-MM-DD. */
export function todayKey(now = Date.now()): string {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shiftDay(key: string, deltaDays: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  return todayKey(dt.getTime());
}

/**
 * Обновляет стрик по факту визита сегодня.
 * - первый визит → 1
 * - уже был сегодня → без изменений
 * - был вчера → +1 (непрерывность)
 * - пропуск → старт заново с 1 (никогда не 0)
 */
export function computeStreak(prev: Streak | null, today = todayKey()): Streak {
  if (!prev) return { count: 1, lastDay: today };
  if (prev.lastDay === today) return prev;
  if (prev.lastDay === shiftDay(today, -1)) return { count: prev.count + 1, lastDay: today };
  return { count: 1, lastDay: today };
}

/** Дней до даты переезда (может быть отрицательным, если уже прошла). */
export function daysUntil(moveDateISO: string | null, now = Date.now()): number | null {
  if (!moveDateISO) return null;
  const target = new Date(moveDateISO);
  if (isNaN(target.getTime())) return null;
  const a = new Date(todayKey(now));
  const b = new Date(todayKey(target.getTime()));
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export interface Milestone {
  key: string;
  label: string;
  reached: boolean;
}

export interface ProgressStats {
  learnedWords: number; // слов в SRS выше начальной коробки
  streak: number;
  spanishOnlyTurn: boolean; // был ли ход полностью без русского
}

/** Вехи — тёплые ориентиры вместо давящего таймера. */
export function milestones(s: ProgressStats): Milestone[] {
  return [
    { key: 'first_words', label: 'Первые 10 слов', reached: s.learnedWords >= 10 },
    { key: 'fifty_words', label: '50 слов', reached: s.learnedWords >= 50 },
    { key: 'streak7', label: '7 дней подряд', reached: s.streak >= 7 },
    { key: 'no_russian', label: 'Первый разговор без русского', reached: s.spanishOnlyTurn },
    { key: 'hundred_words', label: '100 слов', reached: s.learnedWords >= 100 },
  ];
}

/** Красивая подпись счётчика для шапки. */
export function countdownLabel(days: number | null): string | null {
  if (days === null) return null;
  if (days < 0) return '¡Ya en Argentina! 🎉';
  if (days === 0) return '¡Hoy es el día! ✈️';
  return `${days} дн. до Аргентины ✈️`;
}
