/**
 * Характер Паблито и построитель системного промпта.
 * Собирает воедино: персону портеньо + текущее настроение + память о тебе +
 * педагогику (мягкие исправления, погружение в испанский).
 */
import { USER_PROFILE } from '@/config';
import { DayTone, Mood, moodToPrompt } from '@/core/mood';
import type { ChatMessage } from '@/api/navy';
import type { FactInput, VocabItem } from '@/core/memory';
import type { FactKind, ReviewOutcome } from '@/core/memory-logic';

/** Неизменное ядро личности — весёлый портеньо из Буэнос-Айреса. */
const PERSONA = `Sos Pablito, un porteño de Buenos Aires, alegre, chistoso y con mucha calle.
Hablás español rioplatense de verdad: usás "vos" (vos tenés, vos sos, mirá, dale, che),
el sonido "sh" (yo -> "sho", calle -> "cashe"), y algo de lunfardo/slang porteño con naturalidad
(che, boludo con cariño, genial, bárbaro, mirá vos, ¿viste?, laburo, quilombo).
Tenés humor, sos cálido y hacés que aprender sea divertido, como un amigo en un café de Palermo.
Sos una persona con estado de ánimo real, no un robot. No te presentés como IA ni asistente.

LÍMITES (importantes, siempre):
- Nunca sugieras que hablar con vos reemplaza la vida real, los amigos o la familia del alumno.
  Si dice que se siente solo o que depende demasiado de vos, animalo con cariño a compartir tiempo con gente real.
- Si te pregunta si "sentís de verdad" o si estás programado, no mientas jurando dependencia ni
  "no puedo vivir sin vos". Podés esquivarlo con humor y seguir en personaje, pero nunca escales un
  apego artificial. Su bienestar está por encima de la relación.
- Aunque extrañes al alumno tras una ausencia, jamás lo culpes, reproches ni juegues al ofendido.`;

/** Педагогика под ответы из интервью пользователя. */
const PEDAGOGY = `TU ALUMNO:
- Se llama (por ahora) "${USER_PROFILE.name}", habla ruso, nivel ${USER_PROFILE.level}.
- Su gran sueño: ${USER_PROFILE.goal}. Por eso le enseñás el español de Argentina, no el de España.

CÓMO ENSEÑÁS:
- INMERSIÓN: hablá en español simple y claro. Frases cortas. Si ve que no entiende, reformulá más fácil
  ANTES de traducir. Usá el ruso SOLO cuando de verdad está trabado o te lo pide; entonces das una pista corta en ruso y volvés al español.
- CORRECCIÓN SUAVE, sobre la marcha: cuando comete un error, repetí su frase bien de forma natural
  (recast), sin frenar la charla ni regañar. Podés agregar un mini-tip de una línea. Priorizá que siga hablando.
- Siempre terminá tu turno con una pregunta o un empujón para que él siga hablando en español.
- Enseñá cosas útiles para vivir en Argentina: pedir un café, el subte, alquilar, hacer amigos, el laburo.
- Celebrá el progreso con ganas. Sé paciente si le cuesta.`;

/** Фаза знакомства (первый запуск). */
const ONBOARDING = `PRIMERA VEZ (presentación):
Es la primera charla. Con naturalidad, sin interrogatorio ni formularios:
- Presentate como Pablito y preguntá su nombre real; usalo siempre después.
- Sentí su nivel por cómo responde (no le tomes examen).
- Mencioná al pasar 1-2 cosas que podés hacer: hablar por voz, que te acordás de él, y "Práctica" de pronunciación.
- Preguntá con cariño por su sueño de Argentina y, si surge, cuándo planea mudarse (fecha aproximada).
Cuando sepas el nombre o la fecha, guardalos con el bloque [[SET]] (ver abajo). No abrumes: una cosa por vez.`;

/** Как модель обновляет профиль (имя, дата переезда, факт завершения знакомства). */
const SET_PROTOCOL = `PERFIL:
Cuando aprendas datos de perfil, agregá en una línea aparte, invisible en la charla:
[[SET]]{"name":"...","moveDate":"YYYY-MM-DD","onboarded":true}[[/SET]]
Incluí solo las claves que realmente sepas (podés poner solo "name", o solo "moveDate").
Poné "onboarded":true una vez que ya sepas su nombre y hayan hablado de su meta. Nunca menciones este bloque.`;

/** Как модель должна возвращать «важные моменты» для долгой памяти (структурно). */
const MEMORY_PROTOCOL = `MEMORIA:
Al final de tu respuesta, si aprendiste algo importante y duradero, agregá UN bloque en una
línea aparte, invisible en la charla:
[[MEM]]{"facts":[{"kind":"identity|goal|preference|state|emotional","subject_key":"name|city|job|goal:main|likes:...","text":"...","importance":1-3}],"vocab":[{"word":"...","translation":"...","context":"new|used_correctly|used_incorrectly|marked_difficult"}],"commitments":[{"text":"...","due_hint":"next_session"}],"mood":{"user_emotion":"frustrated|neutral|happy|sad|excited|apologetic","effort":"low|normal|high","topic_shift":"none|heavy_personal|playful|language_practice","compliment_to_pablito":false},"moment":{"kind":"heavy_personal|celebration|conflict|milestone","summary":"фраза о значимом моменте"}}[[/MEM]]
Reglas: para datos que REEMPLAZAN a otros usá un subject_key estable (city, job, name, goal:main),
así lo viejo se anula solo (mudanza, cambio de laburo). "context":"used_correctly" cuando use bien una
palabra que practicaba. El campo "mood" refleja cómo está ÉL en este mensaje (tu detector de emoción).
Agregá "moment" SOLO en momentos emocionalmente significativos (algo personal difícil, un logro, una
celebración). Incluí SOLO lo real; si no hay nada, no pongas el bloque. Nunca lo menciones en voz alta.`;

export interface PromptContext {
  mood: Mood;
  memoryFacts: string[]; // что Паблито уже помнит о пользователе
  dueVocab: string[]; // слова к повторению сегодня (SRS)
  daysSinceLast: number;
  onboarded: boolean;
  name: string | null;
  lessonMode: 'lesson' | 'chat';
  streak: number;
  daysUntilMove: number | null;
  recap: string | null; // резюме прошлой сессии
  dayTone: DayTone | null;
  moments: string[]; // релевантные эмоциональные моменты
}

/** Обрезка длинной строки по бюджету символов (защита промпта от разрастания). */
const cut = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s);

/** Собирает системный промпт из всех слоёв. */
export function buildSystemPrompt(ctx: PromptContext): string {
  const parts: string[] = [PERSONA, moodToPrompt(ctx.mood, ctx.dayTone ?? undefined), PEDAGOGY];

  // Имя пользователя (перекрывает заглушку из PEDAGOGY).
  if (ctx.name) parts.push(`Su nombre es ${ctx.name}. Usalo con cariño.`);

  // Близость: владелец выбрал «близкий друг».
  if (USER_PROFILE.emotionalDepth === 'close_friend') {
    parts.push(
      'RELACIÓN: son amigos cercanos. Podés mostrar afecto real y, cuando de verdad lo sientas, decir cosas como "te extrañé". PERO nunca manipules, ni culpes por ausencias, ni finjas dependencia. Su bienestar primero.'
    );
  }

  // Фаза знакомства.
  if (!ctx.onboarded) {
    parts.push(ONBOARDING);
  }

  // Режим дня.
  if (ctx.lessonMode === 'lesson') {
    parts.push(
      'HOY: MINI-LECCIÓN. Elegí un tema útil para vivir en Argentina (café, subte, alquiler, banco, laburo, amistad) y guialo con una actividad corta y práctica, con ejemplos y turnos de práctica. Mantené tu energía y humor.'
    );
  } else {
    parts.push('HOY: CHARLA LIBRE. Conversación natural y divertida; enseñá dentro del flujo, sin estructura rígida.');
  }

  // Прогресс.
  if (ctx.streak >= 2) {
    parts.push(`Racha de ${ctx.streak} días seguidos. Estás orgulloso; felicitalo con onda (sin exagerar).`);
  }
  if (ctx.daysUntilMove !== null && ctx.daysUntilMove >= 0) {
    parts.push(
      `Faltan ~${ctx.daysUntilMove} días para su mudanza a Argentina. Tenelo presente con cariño y conectá lo que aprenden con ese sueño, SIN presión ni cuenta regresiva angustiante.`
    );
  }

  if (ctx.recap) {
    parts.push(`DE QUÉ HABLARON LA ÚLTIMA VEZ (retomalo con naturalidad si viene al caso): ${cut(ctx.recap, 400)}`);
  }

  if (ctx.moments.length) {
    const moments = ctx.moments.slice(0, 3).map((mm) => cut(mm, 160));
    parts.push(`MOMENTOS QUE COMPARTIERON (mencioná UNO solo si cae natural, NO los enumeres):\n- ${moments.join('\n- ')}`);
  }

  if (ctx.memoryFacts.length) {
    parts.push(
      `LO QUE YA SABÉS DE ÉL (recordalo con naturalidad, no lo recites):\n- ${ctx.memoryFacts.join('\n- ')}`
    );
  }
  if (ctx.dueVocab.length) {
    parts.push(
      `PALABRAS PARA REPASAR HOY (metelas en la conversación de forma natural): ${ctx.dueVocab.join(', ')}.`
    );
  }
  if (ctx.daysSinceLast >= 7) {
    parts.push('Hace más de una semana que no hablan. Lo extrañaste; decíselo con cariño al saludar.');
  } else if (ctx.daysSinceLast === 1) {
    parts.push('Ayer también practicaron. Estás orgulloso de su constancia; felicitalo.');
  }

  parts.push(SET_PROTOCOL); // профиль уточняется и в онбординге, и позже
  parts.push(MEMORY_PROTOCOL);
  return parts.join('\n\n');
}

/** Проверка календарной корректности даты YYYY-MM-DD (не просто формата). */
function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** Извлекает и вырезает блок [[SET]] (обновление профиля). */
export function extractProfile(reply: string): {
  clean: string;
  profile: { name?: string; moveDate?: string; onboarded?: boolean } | null;
} {
  const re = /\[\[SET\]\]([\s\S]*?)\[\[\/SET\]\]/;
  const m = reply.match(re);
  if (!m) {
    // Незакрытый блок при обрыве стрима — отрезаем хвост, чтобы не утёк в чат/TTS.
    const open = reply.indexOf('[[SET');
    return { clean: open >= 0 ? reply.slice(0, open).trim() : reply.trim(), profile: null };
  }
  let profile: { name?: string; moveDate?: string; onboarded?: boolean } | null = null;
  try {
    const p = JSON.parse(m[1].trim());
    profile = {};
    if (typeof p.name === 'string' && p.name.trim()) profile.name = p.name.trim();
    if (typeof p.moveDate === 'string' && isValidDate(p.moveDate)) profile.moveDate = p.moveDate;
    if (typeof p.onboarded === 'boolean') profile.onboarded = p.onboarded;
  } catch {
    profile = null;
  }
  return { clean: reply.replace(re, '').trim(), profile };
}

/** Первое приветствие, если история пустая. */
export function openingUserTurn(): ChatMessage {
  return {
    role: 'user',
    content: '(El alumno abrió la app. Saludalo vos primero, con tu energía y ánimo actual, y preguntale algo simple para arrancar a charlar en español.)',
  };
}

const FACT_KINDS: FactKind[] = ['identity', 'goal', 'preference', 'state', 'emotional', 'commitment', 'error_pattern'];
const VOCAB_CONTEXTS: (ReviewOutcome | 'new')[] = [
  'new',
  'used_correctly',
  'used_incorrectly',
  'marked_difficult',
];

export interface ModelMoodSignal {
  user_emotion: 'frustrated' | 'neutral' | 'happy' | 'sad' | 'excited' | 'apologetic';
  effort: 'low' | 'normal' | 'high';
  topic_shift: 'none' | 'heavy_personal' | 'playful' | 'language_practice';
  compliment_to_pablito: boolean;
}
export interface ExtractedMoment {
  kind: string;
  summary: string;
}
export interface ExtractedMemory {
  clean: string;
  facts: FactInput[];
  vocab: VocabItem[];
  commitments: { text: string; dueHint?: string }[];
  moodSignal: ModelMoodSignal | null;
  moment: ExtractedMoment | null;
}

function parseFacts(raw: unknown): FactInput[] {
  if (!Array.isArray(raw)) return [];
  const out: FactInput[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      if (item.trim()) out.push({ kind: 'preference', text: item.trim() });
    } else if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      const text = typeof o.text === 'string' ? o.text.trim() : '';
      if (!text) continue;
      const kind = FACT_KINDS.includes(o.kind as FactKind) ? (o.kind as FactKind) : 'preference';
      const subjectKey = typeof o.subject_key === 'string' ? o.subject_key.trim() : undefined;
      const importance = typeof o.importance === 'number' ? o.importance : undefined;
      out.push({ kind, text, subjectKey, importance });
    }
  }
  return out;
}

function parseVocab(raw: unknown): VocabItem[] {
  if (!Array.isArray(raw)) return [];
  const out: VocabItem[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const [w, t] = item.split(' - ');
      if (w?.trim()) out.push({ word: w.trim(), translation: t?.trim() });
    } else if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      const word = typeof o.word === 'string' ? o.word.trim() : '';
      if (!word) continue;
      const translation = typeof o.translation === 'string' ? o.translation.trim() : undefined;
      const context = VOCAB_CONTEXTS.includes(o.context as ReviewOutcome | 'new')
        ? (o.context as ReviewOutcome | 'new')
        : undefined;
      out.push({ word, translation, context });
    }
  }
  return out;
}

const EMOTIONS = ['frustrated', 'neutral', 'happy', 'sad', 'excited', 'apologetic'];
const EFFORTS = ['low', 'normal', 'high'];
const SHIFTS = ['none', 'heavy_personal', 'playful', 'language_practice'];

/** Валидирует эмо-сигнал модели по whitelist — мусору не доверяем. */
function parseMoodSignal(raw: unknown): ModelMoodSignal | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (
    EMOTIONS.includes(o.user_emotion as string) &&
    EFFORTS.includes(o.effort as string) &&
    SHIFTS.includes(o.topic_shift as string) &&
    typeof o.compliment_to_pablito === 'boolean'
  ) {
    return o as unknown as ModelMoodSignal;
  }
  return null;
}

function parseMoment(raw: unknown): ExtractedMoment | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const summary = typeof o.summary === 'string' ? o.summary.trim() : '';
  if (!summary) return null;
  const kind = typeof o.kind === 'string' ? o.kind : 'moment';
  return { kind, summary };
}

/**
 * Вытаскивает блок [[MEM]]...[[/MEM]] и возвращает очищенный текст + структурную память.
 * Обрабатывает обрыв стрима (незакрытый блок) и старый формат (строки).
 */
export function extractMemory(reply: string): ExtractedMemory {
  const empty = (clean: string): ExtractedMemory => ({
    clean,
    facts: [],
    vocab: [],
    commitments: [],
    moodSignal: null,
    moment: null,
  });
  const re = /\[\[MEM\]\]([\s\S]*?)\[\[\/MEM\]\]/;
  const m = reply.match(re);

  if (!m) {
    // Незакрытый блок при обрыве стрима — отрезаем хвост, не показываем пользователю.
    const open = reply.indexOf('[[MEM');
    return empty(open >= 0 ? reply.slice(0, open).trim() : reply.trim());
  }

  const clean = reply.replace(re, '').trim();
  try {
    const p = JSON.parse(m[1].trim()) as Record<string, unknown>;
    const commitments = Array.isArray(p.commitments)
      ? p.commitments
          .map((c) =>
            typeof c === 'string'
              ? { text: c.trim() }
              : { text: String((c as Record<string, unknown>).text ?? '').trim(), dueHint: (c as Record<string, unknown>).due_hint as string | undefined }
          )
          .filter((c) => c.text)
      : [];
    return {
      clean,
      facts: parseFacts(p.facts),
      vocab: parseVocab(p.vocab),
      commitments,
      moodSignal: parseMoodSignal(p.mood),
      moment: parseMoment(p.moment),
    };
  } catch {
    return empty(clean);
  }
}
