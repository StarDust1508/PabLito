/**
 * Оценка произношения (read-aloud) без спец-API.
 * Идея: пользователю дают фразу, он читает её вслух, whisper распознаёт РЕЧЬ,
 * и мы сравниваем услышанное с целевой фразой. Слова, которые whisper "не расслышал"
 * как надо, — вероятные проблемы произношения. Это не фонетический анализ акцента,
 * но честный практический сигнал: какие слова переговорить.
 */

export type WordStatus = 'ok' | 'partial' | 'wrong';

export interface WordMark {
  w: string; // слово как в задании (с оригинальным написанием)
  ok: boolean; // для обратной совместимости: status === 'ok'
  status: WordStatus; // ok / почти / мимо
  tip?: string; // подсказка по типичной ошибке (если есть)
}

export interface PronResult {
  score: number; // 0..100 — взвешенно (ok=1, partial=0.5, wrong=0)
  marks: WordMark[]; // пословная разметка для подсветки
  heard: string; // что услышал whisper (для показа)
  tips: string[]; // уникальные подсказки по произношению
}

/** Нормализация слова: нижний регистр, снятие ударений и пунктуации. */
function normToken(w: string): string {
  return w
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // убрать диакритику (á→a, ñ→n)
    .replace(/[^a-z0-9]/g, '');
}

function normPhrase(s: string): string[] {
  return s
    .split(/\s+/)
    .map(normToken)
    .filter(Boolean);
}

/** LCS: помечает, какие слова цели нашлись в услышанном (по порядку). */
function matchedByLcs(target: string[], heard: string[]): boolean[] {
  const n = target.length;
  const m = heard.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = target[i - 1] === heard[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const matched = new Array<boolean>(n).fill(false);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (target[i - 1] === heard[j - 1]) {
      matched[i - 1] = true;
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return matched;
}

/** Расстояние Левенштейна и похожесть 0..1 — для частичных баллов. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n];
}
function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);
}

/**
 * Подсказка по типичной ошибке русскоязычного в (риоплатском) испанском.
 * Сравниваем нормализованную цель и то, что услышал whisper.
 */
function detectTip(target: string, heard: string): string | undefined {
  if (target.includes('rr') && !heard.includes('rr'))
    return 'Раскатистое «rr»: кончик языка вибрирует у нёба (perro, не «pero»).';
  if (/r/.test(target) && /l/.test(heard) && !/l/.test(target))
    return 'Звук «r» не заменяй на «l» — лёгкий одиночный удар языком.';
  if ((/v/.test(target) && /b/.test(heard)) || (/b/.test(target) && /v/.test(heard)))
    return '«b» и «v» в испанском звучат одинаково — мягкий губной звук.';
  if (target.endsWith('s') && !heard.endsWith('s'))
    return 'Не проглатывай финальную «s».';
  if (/(ll|y)/.test(target))
    return 'В Аргентине «ll» и «y» звучат как «ш»: calle → «каше», yo → «шо».';
  if (/h/.test(target)) return '«h» в испанском немая: hola → «ола».';
  return undefined;
}

export function scorePronunciation(targetRaw: string, heardRaw: string): PronResult {
  const origWords = targetRaw.split(/\s+/).filter(Boolean);
  const pairs = origWords.map((w) => ({ orig: w, n: normToken(w) })).filter((p) => p.n);
  const target = pairs.map((p) => p.n);
  const heard = normPhrase(heardRaw);
  const matched = matchedByLcs(target, heard);

  let scoreSum = 0;
  const tipsSet = new Set<string>();

  const marks: WordMark[] = pairs.map((p, idx) => {
    if (matched[idx]) {
      scoreSum += 1;
      return { w: p.orig, ok: true, status: 'ok' as WordStatus };
    }
    // Не совпало точно — ищем ближайшее услышанное слово для частичного балла.
    let best = 0;
    let bestWord = '';
    for (const h of heard) {
      const s = similarity(p.n, h);
      if (s > best) {
        best = s;
        bestWord = h;
      }
    }
    const status: WordStatus = best >= 0.5 ? 'partial' : 'wrong';
    scoreSum += best >= 0.5 ? 0.5 : 0;
    const tip = detectTip(p.n, bestWord);
    if (tip) tipsSet.add(tip);
    return { w: p.orig, ok: false, status, tip };
  });

  const score = target.length ? Math.round((scoreSum / target.length) * 100) : 0;
  return { score, marks, heard: heardRaw.trim(), tips: Array.from(tipsSet) };
}

/** Короткий фидбек Паблито по счёту (озвучивается). */
export function feedback(score: number): string {
  if (score >= 90) return '¡Bárbaro, che! Casi perfecto. 🔥';
  if (score >= 70) return '¡Muy bien! Repasá las palabras en rojo y lo clavás.';
  if (score >= 45) return 'Vas bien. Practiquemos las rojas, más despacio.';
  return 'Tranqui, probá de nuevo, palabra por palabra. ¡Vos podés! 💪';
}

/** Набор риоплатских фраз по уровню сложности (офлайн-банк для практики). */
export interface Phrase {
  es: string;
  ru: string;
}

export const PHRASE_BANK: Record<'facil' | 'medio' | 'dificil', Phrase[]> = {
  facil: [
    { es: 'Hola, ¿cómo andás?', ru: 'Привет, как дела?' },
    { es: 'Me llamo así, mucho gusto.', ru: 'Меня зовут так-то, приятно.' },
    { es: 'Quiero un café, por favor.', ru: 'Я хочу кофе, пожалуйста.' },
    { es: '¿Dónde está el subte?', ru: 'Где метро?' },
  ],
  medio: [
    { es: 'Che, ¿me pasás el precio del alquiler?', ru: 'Слушай, скажешь цену аренды?' },
    { es: 'Estoy aprendiendo español para vivir en Argentina.', ru: 'Я учу испанский, чтобы жить в Аргентине.' },
    { es: 'Mañana tengo que ir a laburar temprano.', ru: 'Завтра мне рано на работу.' },
  ],
  dificil: [
    { es: 'Si llegás tarde, avisame así no me preocupo.', ru: 'Если опоздаешь, предупреди, чтобы я не волновался.' },
    { es: 'La verdad es que este barrio me parece bárbaro.', ru: 'По правде, этот район мне кажется отличным.' },
  ],
};
