/**
 * Чистая логика памяти v2 (без БД) — легко тестируется.
 * Нормализация, важность фактов, SM-2-подобное повторение.
 */

export type FactKind =
  | 'identity'
  | 'goal'
  | 'preference'
  | 'state'
  | 'emotional'
  | 'commitment'
  | 'error_pattern';

/** Виды, где новый факт в той же теме ВЫТЕСНЯЕТ старый (переезд, смена работы, имя). */
export const VERSIONED_KINDS: FactKind[] = ['identity', 'state', 'goal'];

/** Слоты, закреплённые навсегда (importance=3) — не теряются никогда. */
export const PIN_SUBJECTS = ['name', 'goal:main'];

/** Нормализация для дедупликации: нижний регистр, без диакритики и пунктуации. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Итоговая важность факта 0..3. */
export function resolveImportance(kind: FactKind, subjectKey: string, given?: number): number {
  if (PIN_SUBJECTS.includes(subjectKey)) return 3;
  if (given != null) return clamp(Math.round(given), 0, 3);
  if (kind === 'identity') return 3;
  if (kind === 'goal') return 2;
  if (kind === 'emotional') return 2;
  return 1;
}

/** Стабильный ключ темы для не-версионируемых видов (накопление без замены). */
export function accumulateSubjectKey(kind: FactKind, normText: string): string {
  return `${kind}:${normText.slice(0, 48)}`;
}

/* --------------------------------- SRS (SM-2) --------------------------------- */

export type ReviewOutcome =
  | 'used_correctly'
  | 'used_incorrectly'
  | 'card_right'
  | 'card_wrong'
  | 'marked_difficult';

export interface SrsState {
  box: number;
  ease: number;
  seen: number;
  correct_streak: number;
  lapses: number;
}

export interface SrsResult extends SrsState {
  due_at: number;
  last_result: ReviewOutcome;
}

export const BASE_INTERVAL_DAYS = [0, 1, 2, 4, 8, 16];
export const DAY_MS = 86_400_000;
export const MAX_BOX = 5;

/** Обновляет состояние слова по исходу — множитель ease, как в SM-2, но 3 исхода. */
export function applyReviewSM2(row: SrsState, outcome: ReviewOutcome, now: number): SrsResult {
  let { box, ease, seen, correct_streak, lapses } = row;

  switch (outcome) {
    case 'used_correctly':
    case 'card_right':
      correct_streak += 1;
      ease = Math.min(ease + 0.05, 3.0);
      box = Math.min(box + 1, MAX_BOX);
      break;
    case 'used_incorrectly':
    case 'card_wrong':
      lapses += 1;
      correct_streak = 0;
      ease = Math.max(ease - 0.2, 1.3);
      box = 1;
      break;
    case 'marked_difficult':
      lapses += 1;
      ease = Math.max(ease - 0.1, 1.3);
      box = Math.max(box - 1, 1); // «трудное» ≠ «забытое» — шаг назад, не сброс
      break;
  }

  seen += 1;
  const intervalDays = BASE_INTERVAL_DAYS[box] * ease;
  const due_at = now + Math.round(intervalDays * DAY_MS);
  return { box, ease, seen, correct_streak, lapses, due_at, last_result: outcome };
}
