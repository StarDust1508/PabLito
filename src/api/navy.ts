/**
 * Клиент NavyAI (api.navy) — OpenAI-совместимый API.
 * Эндпоинты (как у OpenAI):
 *   POST {base}/chat/completions       — чат
 *   POST {base}/audio/transcriptions   — распознавание речи (whisper-1)
 *   POST {base}/audio/speech           — синтез речи (TTS)
 *
 * Если у NavyAI какой-то эндпоинт называется иначе — правится только здесь,
 * остальному приложению всё равно.
 */
import { fetch as expoFetch } from 'expo/fetch';
import { CONFIG } from '@/config';

export type ChatRole = 'system' | 'user' | 'assistant';
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface ChatOptions {
  deep?: boolean; // true → модель посильнее (разборы), false → быстрая для чата
  temperature?: number;
  signal?: AbortSignal;
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${CONFIG.apiKey}`,
    ...extra,
  };
  if (CONFIG.clientToken) h['X-Client-Token'] = CONFIG.clientToken;
  return h;
}

/** Обычный (не потоковый) чат. Возвращает текст ответа Паблито. */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const model = opts.deep ? CONFIG.models.deep : CONFIG.models.chat;
  const res = await fetch(`${CONFIG.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    signal: opts.signal,
    body: JSON.stringify({
      model,
      messages,
      temperature: opts.temperature ?? 0.8,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`NavyAI chat ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const content: string | undefined = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('NavyAI: пустой ответ');
  return content.trim();
}

/**
 * §4: разбор фото. Картинка уходит ОДИН раз vision-модели (OpenAI-совместимый формат
 * content[]). base64 НЕ кладётся в постоянную историю чата — иначе пере-отправка каждый ход.
 * Если модель не поддерживает vision — бросает, вызывающий деградирует мягко.
 */
export async function chatVision(imageBase64: string, mime: string, systemPrompt: string): Promise<string> {
  const messages: unknown[] = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({
    role: 'user',
    content: [
      {
        type: 'text',
        text: 'Mirá esta foto y comentala en español rioplatense, con onda: describí brevemente lo que ves y hacele UNA pregunta al alumno sobre ella para seguir la charla. 1-3 frases, natural.',
      },
      { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } },
    ],
  });
  const res = await fetch(`${CONFIG.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ model: CONFIG.models.vision, messages, temperature: 0.7 }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`NavyAI vision ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const content: string | undefined = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('NavyAI vision: пустой ответ');
  return content.trim();
}

/** Перевод текста на русский (для «перевод по тапу»). Возвращает только перевод. */
export async function translate(text: string): Promise<string> {
  return chat(
    [
      { role: 'system', content: 'Traducí al ruso de forma natural. Devolvé SOLO la traducción, sin comillas ni notas.' },
      { role: 'user', content: text },
    ],
    { temperature: 0.2 }
  );
}

/**
 * Перевод ОДНОГО слова в контексте фразы — точнее, чем слово в отрыве
 * (banco = скамейка/банк решается по контексту). Возвращает краткий русский эквивалент.
 */
export async function translateWord(word: string, sentence: string): Promise<string> {
  return chat(
    [
      {
        role: 'system',
        content:
          'Sos un diccionario español→ruso. Te doy una palabra y la oración donde aparece. Devolvé SOLO la traducción al ruso de esa palabra EN ESE contexto (1-3 palabras), sin comillas ni explicaciones.',
      },
      { role: 'user', content: `Palabra: ${word}\nOración: ${sentence}` },
    ],
    { temperature: 0.2 }
  );
}

/**
 * Потоковый чат (SSE). Вызывает onDelta(полныйТекстНаТекущийМомент) по мере
 * прихода токенов и возвращает финальный текст. Использует expo/fetch, который
 * умеет читать тело ответа потоком. При любой ошибке потока бросает — вызывающий
 * код откатывается на обычный chat().
 */
export async function chatStream(
  messages: ChatMessage[],
  onDelta: (full: string) => void,
  opts: ChatOptions = {}
): Promise<string> {
  const model = opts.deep ? CONFIG.models.deep : CONFIG.models.chat;

  // Таймаут, чтобы зависшая сеть не заблокировала UI навсегда.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  if (opts.signal) opts.signal.addEventListener('abort', () => controller.abort());

  try {
    const res = await expoFetch(`${CONFIG.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      signal: controller.signal,
      body: JSON.stringify({ model, messages, temperature: opts.temperature ?? 0.8, stream: true }),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`NavyAI stream ${res.status}: ${t.slice(0, 200)}`);
    }
    if (!res.body) throw new Error('NavyAI stream: нет тела ответа');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta: string | undefined = json?.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            onDelta(full);
          }
        } catch {
          /* неполный/битый кусок — пропускаем */
        }
      }
    }
    return full.trim();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Распознавание речи. Принимает file:// URI записи (m4a/wav) и возвращает текст.
 * Использует multipart/form-data, как OpenAI /audio/transcriptions.
 */
export async function transcribe(fileUri: string, language = 'es'): Promise<string> {
  const form = new FormData();
  // React Native FormData принимает такой объект для файла:
  form.append('file', {
    uri: fileUri,
    name: 'speech.m4a',
    type: 'audio/m4a',
  } as unknown as Blob);
  form.append('model', CONFIG.models.stt);
  form.append('language', language);

  const res = await fetch(`${CONFIG.baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: authHeaders(), // Content-Type выставит fetch сам (boundary)
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`NavyAI STT ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data?.text ?? '').trim();
}

/**
 * Синтез речи. Возвращает ArrayBuffer с аудио (mp3).
 * voice — при поддержке NavyAI можно подобрать испаноязычный голос.
 * Если эндпоинт недоступен — приложение откатывается на expo-speech (см. voice.ts).
 */
export async function synthesize(text: string, voice = 'alloy'): Promise<ArrayBuffer> {
  const res = await fetch(`${CONFIG.baseUrl}/audio/speech`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      model: 'tts-1',
      voice,
      input: text,
      response_format: 'mp3',
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`NavyAI TTS ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.arrayBuffer();
}
