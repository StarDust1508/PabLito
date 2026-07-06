/**
 * Конфигурация приложения. Значения берутся из .env через EXPO_PUBLIC_*.
 * Никакие ключи не хардкодятся в исходниках.
 */

const need = (v: string | undefined, name: string): string => {
  if (!v) {
    console.warn(`[config] Переменная ${name} не задана. Проверь .env`);
    return '';
  }
  return v;
};

export const CONFIG = {
  baseUrl: need(process.env.EXPO_PUBLIC_NAVY_BASE_URL, 'EXPO_PUBLIC_NAVY_BASE_URL'),
  apiKey: need(process.env.EXPO_PUBLIC_NAVY_API_KEY, 'EXPO_PUBLIC_NAVY_API_KEY'),
  // Необязательный общий токен при работе через прокси-воркер.
  clientToken: process.env.EXPO_PUBLIC_CLIENT_TOKEN ?? '',
  models: {
    chat: process.env.EXPO_PUBLIC_MODEL_CHAT ?? 'deepseek-v4-flash',
    deep: process.env.EXPO_PUBLIC_MODEL_DEEP ?? 'deepseek-v4-pro',
    stt: process.env.EXPO_PUBLIC_MODEL_STT ?? 'whisper-1',
  },
} as const;

/** Профиль пользователя из интервью — стартовые настройки Паблито. */
export const USER_PROFILE = {
  name: null as string | null, // до знакомства зовёт «che/amigo» (латиницей); настоящее имя узнаёт и запоминает в первой сессии
  nativeLanguage: 'русский',
  targetLanguage: 'испанский (риоплатский, Аргентина)',
  goal: 'переехать в Аргентину и свободно говорить',
  level: 'A1-A2 — знаю базовые слова и фразы',
  // Настройки из интервью:
  personality: 'porteno_alegre', // весёлый портеньо
  correctionStyle: 'gentle_inline', // мягко, по ходу разговора
  explanationLanguage: 'immersion', // максимум испанский, русский только когда застрял

  // Продуктовые решения (deep-dive):
  lessonMode: 'toggle', // каждый день сам выбираешь: урок или болталка
  emotionalDepth: 'close_friend', // может говорить «скучал», «ты мне дорог» при высокой близости
  notifications: 'daily', // максимум 1 в день, всё отключаемо
  goalMode: 'exact_date', // точная дата переезда + счётчик дней (рядом с вехами)
  moveDate: null as string | null, // ISO-дата; уточняется в онбординге

  // Решения из код-ревью/дизайна:
  pronunciationMode: 'heuristic', // оценка произношения без платного API
  proactiveMessages: true, // Паблито может писать первым (с тумблером и лимитом)
  encryptMemory: false, // память открытым текстом (личное использование)
  moodUiStyle: 'emoji_only', // в интерфейсе только эмодзи настроения (bond/тон дня скрыты)
} as const;

/**
 * Предохранители благополучия — НЕ отключаются в ущерб безопасности.
 * Даже при emotionalDepth='close_friend' Паблито не манипулирует, не винит за
 * паузы и не имитирует зависимость. При признаках одиночества/изоляции —
 * мягкая подсказка про живое общение от лица приложения, не от Паблито.
 */
export const WELLBEING = {
  noGuiltForAbsence: true,
  streakNeverResetsToZero: true,
  countdownWithMilestones: true, // счётчик всегда рядом с вехами, не как угроза
  gentleIsolationCheck: true,
} as const;
