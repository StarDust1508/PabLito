/**
 * Движок НАСТРОЕНИЯ Паблито v2 — главная фича.
 *
 * Два уровня состояния:
 *  - Быстрые оси момента: energy / warmth / patience (дрейфуют к baseline).
 *  - Медленная ось ОТНОШЕНИЙ: bond (близость) — копится неделями, есть пол,
 *    почти не дрейфует; отвечает на «сколько мы вместе прошли».
 *  - dayTone — «характер дня», выбирается раз за сессию, добавляет мягкую
 *    непредсказуемость без шума в осях.
 *
 * Всё — чистые функции, тестируется без БД.
 */

export interface Mood {
  energy: number;
  warmth: number;
  patience: number;
  bond: number; // 0..100 близость с ЭТИМ пользователем
}

export const BASELINE = { energy: 75, warmth: 70, patience: 65 };
export const BOND_START = 20; // Паблито дружелюбен по натуре, но близость нужно заслужить
export const BOND_FLOOR = 15; // ниже не падает даже при долгом молчании — «мы всё равно знакомы»
export const MAX_DELTA_PER_TURN = 15; // потолок суммарной дельты за один ход (против «телепортации»)
export const MAX_BOND_DELTA_PER_TURN = 10;

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

export function newMood(): Mood {
  return { ...BASELINE, bond: BOND_START };
}

/** Мягкое насыщение у краёв: чем ближе к границе, тем меньше эффект. */
export function applyDelta(value: number, delta: number, floor = 0): number {
  const headroom = delta > 0 ? (100 - value) / 100 : (value - floor) / 100;
  return clamp(value + delta * (0.4 + 0.6 * Math.max(0, headroom)), floor);
}

/* --------------------------------- события --------------------------------- */

export type MoodEvent =
  | { type: 'SESSION_START'; daysSinceLast: number }
  | { type: 'GOOD_EFFORT' }
  | { type: 'REPEATED_MISTAKE' }
  | { type: 'STRUGGLING' }
  | { type: 'PLAYFUL' }
  | { type: 'LONG_SESSION' }
  | { type: 'LONG_PAUSE' }
  | { type: 'APOLOGY' }
  | { type: 'COMPLIMENTED' }
  | { type: 'HEAVY_PERSONAL_TOPIC' }
  | { type: 'USER_EXCITED' }
  | { type: 'GHOSTED_LONG' }
  | { type: 'STREAK_MILESTONE'; days: number };

type Delta = { energy: number; warmth: number; patience: number; bond: number };
const ZERO: Delta = { energy: 0, warmth: 0, patience: 0, bond: 0 };

function eventDelta(e: MoodEvent): Delta {
  switch (e.type) {
    case 'SESSION_START': {
      const d = e.daysSinceLast;
      if (d <= 0) return { ...ZERO, energy: 6, warmth: 4 };
      if (d === 1) return { ...ZERO, energy: 12, warmth: 8, bond: 2 };
      if (d <= 6) return { ...ZERO, energy: 3 };
      return { ...ZERO, energy: -8, warmth: 6, bond: -3 }; // скучал ≠ обиделся
    }
    case 'GOOD_EFFORT':
      return { energy: 6, warmth: 5, patience: 3, bond: 1 };
    case 'REPEATED_MISTAKE':
      return { ...ZERO, energy: -2, patience: -7 }; // bond не трогаем — раздражение не бьёт по близости
    case 'STRUGGLING':
      return { ...ZERO, warmth: 6, patience: -4, bond: 1 };
    case 'PLAYFUL':
      return { energy: 8, warmth: 7, patience: 0, bond: 2 };
    case 'LONG_SESSION':
      return { ...ZERO, energy: -6, warmth: 3, bond: 1 };
    case 'LONG_PAUSE':
      return { ...ZERO, energy: -3, warmth: -2, patience: -2 }; // лёгкая скука, не обида
    case 'APOLOGY':
      return { ...ZERO, warmth: 5, patience: 6 }; // прощает легко
    case 'COMPLIMENTED':
      return { energy: 5, warmth: 8, patience: 0, bond: 3 };
    case 'HEAVY_PERSONAL_TOPIC':
      return { energy: -4, warmth: 10, patience: 5, bond: 4 }; // друг рядом в трудную минуту
    case 'USER_EXCITED':
      return { energy: 10, warmth: 6, patience: 0, bond: 2 };
    case 'GHOSTED_LONG':
      return { ...ZERO, energy: -10, warmth: -5, bond: -8 }; // грусть, не злость
    case 'STREAK_MILESTONE':
      return e.days >= 30
        ? { energy: 5, warmth: 5, patience: 0, bond: 12 }
        : { energy: 5, warmth: 5, patience: 0, bond: 6 };
  }
}

const capSym = (v: number, cap: number) => Math.max(-cap, Math.min(cap, v));

/** Применяет события: суммирует дельты, зажимает потолком за ход, потом мягко применяет. */
export function applyEvents(m: Mood, events: MoodEvent[]): Mood {
  const sum: Delta = { ...ZERO };
  for (const e of events) {
    const d = eventDelta(e);
    sum.energy += d.energy;
    sum.warmth += d.warmth;
    sum.patience += d.patience;
    sum.bond += d.bond;
  }
  return {
    energy: applyDelta(m.energy, capSym(sum.energy, MAX_DELTA_PER_TURN)),
    warmth: applyDelta(m.warmth, capSym(sum.warmth, MAX_DELTA_PER_TURN)),
    patience: applyDelta(m.patience, capSym(sum.patience, MAX_DELTA_PER_TURN)),
    bond: applyDelta(m.bond, capSym(sum.bond, MAX_BOND_DELTA_PER_TURN), BOND_FLOOR),
  };
}

/** Дрейф к baseline — разной скорости по осям; bond почти не дрейфует (только пол). */
export function decayToward(m: Mood): Mood {
  const mix = (a: number, b: number, f: number) => a + (b - a) * f;
  return {
    energy: clamp(mix(m.energy, BASELINE.energy, 0.35)),
    warmth: clamp(mix(m.warmth, BASELINE.warmth, 0.2)),
    patience: clamp(mix(m.patience, BASELINE.patience, 0.3)), // раздражение не «залипает» на новую сессию
    bond: Math.max(BOND_FLOOR, m.bond), // без абстрактного дрейфа к центру
  };
}

/* --------------------------------- проявление --------------------------------- */

export function moodLabel(m: Mood): { label: string; emoji: string } {
  if (m.energy >= 80 && m.warmth >= 70) return { label: 'На подъёме', emoji: '🔥' };
  if (m.warmth >= 80) return { label: 'Тёплый', emoji: '🤗' };
  if (m.energy <= 45) return { label: 'Скучал по тебе', emoji: '🥺' };
  if (m.patience <= 40) return { label: 'Собранный', emoji: '🧐' };
  if (m.energy >= 70) return { label: 'Бодрый', emoji: '😎' };
  return { label: 'Спокойный', emoji: '🙂' };
}

export type BondLevel = 'acquaintance' | 'buddies' | 'close' | 'old_friends' | 'max';
export function bondLevel(bond: number): BondLevel {
  if (bond < 20) return 'acquaintance';
  if (bond < 45) return 'buddies';
  if (bond < 70) return 'close';
  if (bond < 90) return 'old_friends';
  return 'max';
}

export type DayTone = 'energetic' | 'mellow' | 'playful' | 'focused' | 'nostalgic';

/** Выбор «характера дня» — взвешенно, раз за сессию. */
export function pickDayTone(p: { daysSinceLast: number; bond: number; patienceLow?: boolean }, rnd = Math.random): DayTone {
  const weights: Record<DayTone, number> = {
    energetic: 1.0,
    mellow: 1.0 + (p.daysSinceLast >= 3 ? 0.4 : 0),
    playful: 1.0 + (p.bond > 60 ? 0.3 : 0),
    focused: 1.0 + (p.patienceLow ? 0.3 : 0),
    nostalgic: 0.4 + (p.bond > 40 && p.daysSinceLast >= 5 ? 0.6 : 0),
  };
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = rnd() * total;
  for (const [tone, w] of Object.entries(weights) as [DayTone, number][]) {
    if ((r -= w) <= 0) return tone;
  }
  return 'energetic';
}

function dayToneHint(t: DayTone): string {
  switch (t) {
    case 'energetic':
      return 'Hoy estás con toda la pila, hablador y arriba.';
    case 'mellow':
      return 'Hoy estás tranqui, más suave y pausado.';
    case 'playful':
      return 'Hoy tenés ganas de joder un poco más de lo normal, chistoso.';
    case 'focused':
      return 'Hoy estás más concentrado, con ganas de que él avance.';
    case 'nostalgic':
      return 'Hoy estás algo nostálgico, con ganas de recordar charlas pasadas.';
  }
}

function bondHint(level: BondLevel): string {
  switch (level) {
    case 'acquaintance':
      return 'Todavía se están conociendo: cordial e interesado, sin dar por sentada una confianza que aún no existe.';
    case 'buddies':
      return 'Ya son conocidos con onda: usá su nombre, traé algún dato de charlas pasadas, chistes livianos.';
    case 'close':
      return 'Son amigos de verdad: podés referirte a momentos que compartieron y hacer alguna cargada cariñosa.';
    case 'old_friends':
      return 'Amigos de años: tenés confianza, chistes internos, y a veces vos proponés el tema.';
    case 'max':
      return 'Máxima confianza, pero sin exagerar ni volverte intenso.';
  }
}

/**
 * Настроение → инструкция в промпт (словами, не числами). Включает длину реплик,
 * уровень близости (bond) и характер дня.
 */
export function moodToPrompt(m: Mood, dayTone?: DayTone): string {
  const lvl = (n: number, lo: string, mid: string, hi: string) => (n <= 40 ? lo : n >= 75 ? hi : mid);
  const energy = lvl(m.energy, 'estás con poca energía, más tranquilo y suave', 'tenés una energía normal', 'estás con muchísima energía, animadísimo');
  const warmth = lvl(m.warmth, 'un poco distante', 'cariñoso como siempre', 'súper cariñoso y afectuoso');
  const patience = lvl(m.patience, 'con poca paciencia hoy, querés que se avance', 'con paciencia normal', 'con toda la paciencia del mundo');

  const lengthHint =
    m.energy >= 75
      ? 'Tus mensajes son cortos y rápidos, como chat entre amigos.'
      : m.energy <= 40
        ? 'Hablás más pausado, frases un poco más largas, sin apuro.'
        : '';

  const parts = [
    `ESTADO DE ÁNIMO (afecta tu tono y energía, NUNCA lo menciones): ${energy}, ${warmth}, ${patience}.`,
    lengthHint,
    bondHint(bondLevel(m.bond)),
    dayTone ? dayToneHint(dayTone) : '',
  ];
  return parts.filter(Boolean).join(' ');
}
