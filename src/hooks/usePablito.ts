/**
 * "Мозг" Паблито: память v2 + настроение v2 (bond, dayTone) + прогресс + api.navy.
 * - Ответы потоком, транскрипт в SQLite, восстановление сессии, резюме при уходе в фон.
 * - События настроения: гибрид сигнала модели ([[MEM]].mood) и регексов-фолбэка.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { chat, chatStream, type ChatMessage } from '@/api/navy';
import { speak } from '@/core/voice';
import { buildSystemPrompt, extractMemory, extractProfile, openingUserTurn, type ModelMoodSignal } from '@/core/personality';
import { DayTone, Mood, MoodEvent, applyEvents, decayToward, moodLabel, pickDayTone } from '@/core/mood';
import { Streak, computeStreak, daysUntil, todayKey } from '@/core/progress';
import * as mem from '@/core/memory';

export interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

const uid = () => Math.random().toString(36).slice(2);
const KEEP_TURNS = 20;
const RESUME_WINDOW_MS = 30 * 60 * 1000;
const STREAK_MILESTONES = [7, 14, 30, 60, 100];

function windowed(hist: ChatMessage[]): ChatMessage[] {
  const hasSys = hist[0]?.role === 'system';
  const sys = hasSys ? [hist[0]] : [];
  const rest = hasSys ? hist.slice(1) : hist;
  return [...sys, ...rest.slice(-KEEP_TURNS)];
}

function stripLive(text: string): string {
  let cut = text.length;
  for (const tag of ['[[MEM', '[[SET']) {
    const i = text.indexOf(tag);
    if (i >= 0) cut = Math.min(cut, i);
  }
  return text.slice(0, cut).trim();
}

/** Гибрид: сигнал модели приоритетен, регексы — фолбэк; плюс паузы и извинения. */
function resolveMoodEvents(p: {
  userText: string;
  signal: ModelMoodSignal | null;
  pauseMs: number;
  sessionMsgCount: number;
}): MoodEvent[] {
  const t = p.userText.toLowerCase();
  const events: MoodEvent[] = [];

  if (/perd[oó]n|disculp|извини|прости|sorry/.test(t)) events.push({ type: 'APOLOGY' });
  if (p.pauseMs > 3 * 60_000 && p.sessionMsgCount > 2) events.push({ type: 'LONG_PAUSE' });

  const s = p.signal;
  if (s) {
    if (s.compliment_to_pablito) events.push({ type: 'COMPLIMENTED' });
    if (s.topic_shift === 'heavy_personal' && (s.user_emotion === 'sad' || s.user_emotion === 'frustrated'))
      events.push({ type: 'HEAVY_PERSONAL_TOPIC' });
    if (s.user_emotion === 'excited') events.push({ type: 'USER_EXCITED' });
    if (s.topic_shift === 'playful') events.push({ type: 'PLAYFUL' });
    if (s.effort === 'high') events.push({ type: 'GOOD_EFFORT' });
    if (s.effort === 'low' && s.topic_shift === 'language_practice') events.push({ type: 'STRUGGLING' });
  } else {
    if (/не понимаю|no entiendo|no sé|\?\?/.test(t)) events.push({ type: 'STRUGGLING' });
    if (/jaja|jeje|ха-?ха|😂|😄|\bche\b/.test(t)) events.push({ type: 'PLAYFUL' });
    const spanish = /[ñáéíóúü¿¡]/.test(t) || /\b(vos|soy|tengo|quiero|hola|gracias)\b/.test(t);
    if (spanish && p.userText.trim().length > 12) events.push({ type: 'GOOD_EFFORT' });
  }
  return events;
}

/** Закрывает сессию с кратким резюме (для recap в следующий раз). Best-effort. */
async function closeSessionWithSummary(id: number, mood: Mood): Promise<void> {
  try {
    const msgs = await mem.getLastMessages(id, 40);
    if (msgs.length < 4) {
      await mem.finishSession(id, undefined, mood);
      return;
    }
    const convo = msgs.map((x) => `${x.role === 'user' ? 'Alumno' : 'Pablito'}: ${x.content}`).join('\n');
    const summary = await chat([
      { role: 'system', content: 'Resumí esta charla en 2-3 frases en RUSO: temas, datos nuevos del alumno y emociones. Solo el resumen.' },
      { role: 'user', content: convo },
    ]);
    await mem.finishSession(id, summary, mood);
  } catch {
    await mem.finishSession(id, undefined, mood);
  }
}

export function usePablito() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [mood, setMood] = useState<Mood>({ energy: 75, warmth: 70, patience: 65, bond: 20 });
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  const [name, setName] = useState<string | null>(null);
  const [streak, setStreak] = useState(0);
  const [daysToMove, setDaysToMove] = useState<number | null>(null);
  const [lessonMode, setLessonModeState] = useState<mem.LessonMode>('chat');

  const history = useRef<ChatMessage[]>([]);
  const sessionId = useRef<number | null>(null);
  const turnIndex = useRef(0);
  const daysSinceLast = useRef(0);
  const profileRef = useRef<mem.Profile>({ name: null, moveDate: null, onboarded: false });
  const streakRef = useRef(0);
  const lessonRef = useRef<mem.LessonMode>('chat');
  const recapRef = useRef<string | null>(null);
  const dayToneRef = useRef<DayTone | null>(null);
  const momentsRef = useRef<string[]>([]);
  const moodRef = useRef<Mood>(mood);
  moodRef.current = mood;
  const lastUserText = useRef('');
  const lastTurnAt = useRef(Date.now());
  const pauseAtSend = useRef(0);
  const inited = useRef(false); // защита от двойного запуска init (React StrictMode)
  const sending = useRef(false); // синхронная защита от двойного send

  const rebuildSystem = useCallback(async (m: Mood) => {
    const [facts, due] = await Promise.all([mem.getFactsForPrompt(), mem.getDueVocab()]);
    const sys = buildSystemPrompt({
      mood: m,
      memoryFacts: facts,
      dueVocab: due,
      daysSinceLast: daysSinceLast.current,
      onboarded: profileRef.current.onboarded,
      name: profileRef.current.name,
      lessonMode: lessonRef.current,
      streak: streakRef.current,
      daysUntilMove: daysUntil(profileRef.current.moveDate),
      recap: recapRef.current,
      dayTone: dayToneRef.current,
      moments: momentsRef.current,
    });
    if (history.current[0]?.role === 'system') history.current[0].content = sys;
    else history.current.unshift({ role: 'system', content: sys });
  }, []);

  const persist = useCallback((role: 'user' | 'assistant', content: string) => {
    if (sessionId.current == null) return;
    mem.addMessage(sessionId.current, turnIndex.current++, role, content);
  }, []);

  const runAssistant = useCallback(
    async (deep?: boolean, isGreeting = false) => {
      const asstId = uid();
      setMessages((prev) => [...prev, { id: asstId, role: 'assistant', text: '' }]);
      setBusy(true);
      const patch = (text: string) =>
        setMessages((prev) => prev.map((mm) => (mm.id === asstId ? { ...mm, text } : mm)));

      let full = '';
      try {
        full = await chatStream(windowed(history.current), (live) => patch(stripLive(live)), { deep });
      } catch {
        try {
          full = await chat(windowed(history.current), { deep });
        } catch {
          patch('¡Uy! No me pude conectar. Проверь ключ и интернет 🙏');
          setBusy(false);
          return;
        }
      }

      const memRes = extractMemory(full);
      const profRes = extractProfile(memRes.clean);
      // Финальная страховка: не показывать/озвучивать остатки служебных блоков.
      let clean = profRes.clean;
      if (/\[\[(MEM|SET)/.test(clean)) clean = clean.replace(/\[\[(MEM|SET)[\s\S]*$/, '').trim();

      patch(clean);
      history.current.push({ role: 'assistant', content: clean });
      persist('assistant', clean);

      for (const f of memRes.facts) await mem.upsertFact(f, sessionId.current);
      if (memRes.vocab.length) await mem.upsertVocab(memRes.vocab);
      if (memRes.commitments.length) await mem.addCommitments(memRes.commitments);
      if (memRes.moment) await mem.addMoment(memRes.moment.kind, memRes.moment.summary, moodRef.current);

      if (profRes.profile) {
        // Не закрываем онбординг, пока реально не знаем имя (модель могла поспешить).
        const patchProfile = { ...profRes.profile };
        if (patchProfile.onboarded && !(patchProfile.name || profileRef.current.name)) delete patchProfile.onboarded;
        const next = await mem.setProfile(patchProfile);
        profileRef.current = next;
        setName(next.name);
        setDaysToMove(daysUntil(next.moveDate));
      }

      // Настроение: события хода (кроме приветствия).
      if (!isGreeting) {
        const events = resolveMoodEvents({
          userText: lastUserText.current,
          signal: memRes.moodSignal,
          pauseMs: pauseAtSend.current,
          sessionMsgCount: turnIndex.current,
        });
        if (events.length) {
          const m2 = applyEvents(moodRef.current, events);
          setMood(m2);
          await mem.saveMood(m2);
        }
      }

      lastTurnAt.current = Date.now();
      await mem.touchLastSeen();
      setBusy(false);
      speak(clean);
    },
    [persist]
  );

  // Инициализация / восстановление.
  useEffect(() => {
    if (inited.current) return; // StrictMode dev-double-mount не создаёт вторую сессию
    inited.current = true;
    (async () => {
      const last = await mem.getLastSeen();
      daysSinceLast.current = mem.daysBetween(last);
      await mem.touchLastSeen();

      const profile = await mem.getProfile();
      profileRef.current = profile;
      setName(profile.name);
      setDaysToMove(daysUntil(profile.moveDate));

      const today = todayKey();
      const s: Streak = computeStreak(await mem.getStreak(), today);
      await mem.saveStreak(s);
      await mem.setLongestStreak(Math.max(await mem.getLongestStreak(), s.count));
      streakRef.current = s.count;
      setStreak(s.count);

      lessonRef.current = (await mem.getLessonMode(today)) ?? 'chat';
      setLessonModeState(lessonRef.current);

      let m = decayToward(await mem.loadMood());

      // Тонус дня — раз в день.
      let tone = await mem.getDayTone(today);
      if (!tone) {
        tone = pickDayTone({ daysSinceLast: daysSinceLast.current, bond: m.bond, patienceLow: m.patience < 45 });
        await mem.setDayTone(tone, today);
      }
      dayToneRef.current = tone;

      const open = await mem.getOpenSession();
      const lastAct = open ? (await mem.getSessionLastActivity(open.id)) ?? open.started_at : 0;
      const canResume = open && Date.now() - lastAct < RESUME_WINDOW_MS;

      if (open && canResume) {
        sessionId.current = open.id;
        turnIndex.current = await mem.countMessages(open.id);
        recapRef.current = await mem.getLastSessionSummary(open.id);
        momentsRef.current = await mem.getMomentsPreview(2); // без «затирания» resurfaced
        const msgs = await mem.getLastMessages(open.id, KEEP_TURNS);
        history.current = msgs
          .filter((x) => x.role !== 'system')
          .map((x) => ({ role: x.role as 'user' | 'assistant', content: x.content }));
        setMessages(history.current.map((x) => ({ id: uid(), role: x.role as 'user' | 'assistant', text: x.content })));
        setMood(m);
        await mem.saveMood(m);
        await rebuildSystem(m);
        setReady(true);
        return;
      }

      // Новая сессия. «Осиротевшую» закрываем с резюме (иначе теряем контекст для recap).
      if (open) await closeSessionWithSummary(open.id, moodRef.current);
      recapRef.current = await mem.getLastSessionSummary();
      momentsRef.current = await mem.getRelevantMoments(2);
      await mem.bumpTotalSessions();

      const startEvents: MoodEvent[] = [{ type: 'SESSION_START', daysSinceLast: daysSinceLast.current }];
      if (STREAK_MILESTONES.includes(s.count)) startEvents.push({ type: 'STREAK_MILESTONE', days: s.count });
      if (daysSinceLast.current >= 21) startEvents.push({ type: 'GHOSTED_LONG' });
      m = applyEvents(m, startEvents);
      setMood(m);
      await mem.saveMood(m);

      sessionId.current = await mem.startSession();
      turnIndex.current = 0;
      await rebuildSystem(m);

      history.current.push(openingUserTurn());
      await runAssistant(undefined, true);
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Закрытие сессии с резюме при уходе в фон.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'background' && state !== 'inactive') return;
      const id = sessionId.current;
      if (id == null) return;
      closeSessionWithSummary(id, moodRef.current);
    });
    return () => sub.remove();
  }, []);

  const send = useCallback(
    async (text: string, opts: { deep?: boolean } = {}) => {
      const trimmed = text.trim();
      if (!trimmed || busy || sending.current) return; // синхронная защита от двойного тапа
      sending.current = true;
      try {
        lastUserText.current = trimmed;
        pauseAtSend.current = Date.now() - lastTurnAt.current;

        setMessages((prev) => [...prev, { id: uid(), role: 'user', text: trimmed }]);
        history.current.push({ role: 'user', content: trimmed });
        persist('user', trimmed);

        await rebuildSystem(moodRef.current);
        await runAssistant(opts.deep);
      } finally {
        sending.current = false;
      }
    },
    [busy, persist, rebuildSystem, runAssistant]
  );

  const setLessonMode = useCallback(
    async (next: mem.LessonMode) => {
      lessonRef.current = next;
      setLessonModeState(next);
      await mem.setLessonMode(next, todayKey());
      await rebuildSystem(moodRef.current);
    },
    [rebuildSystem]
  );

  return {
    messages,
    mood,
    moodBadge: moodLabel(mood),
    busy,
    ready,
    send,
    name,
    streak,
    daysToMove,
    lessonMode,
    setLessonMode,
  };
}
