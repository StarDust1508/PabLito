/**
 * Главный экран: чат с Паблито — ядро приложения.
 * Острова (шапка/ввод), раскрытие на весь экран (кнопка + свайп), инвертированная
 * лента, presence, перевод по тапу. Иконки — lucide. Эстетика malvah.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeInDown, FadeInUp, FadeOutUp, runOnJS } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { BookOpen, Brain, Maximize2, Mic, Minimize2, Send, Sparkles, Square } from 'lucide-react-native';
import { dark, light, space } from '@/theme/theme';
import { usePablito, type UiMessage } from '@/hooks/usePablito';
import CityStrip from '@/components/CityStrip';
import PronunciationModal from '@/screens/PronunciationModal';
import LearnedWordsModal from '@/screens/LearnedWordsModal';
import MemoryModal from '@/screens/MemoryModal';
import { countdownLabel } from '@/core/progress';
import { requestMic, startRecording, stopRecording } from '@/core/voice';
import { transcribe, translate } from '@/api/navy';

type Presence = 'online' | 'typing' | 'recent' | 'offline';
const rand = (min: number, max: number) => min + Math.floor(Math.random() * (max - min));
const PRESENCE_ONLINE = '#3E9B6B'; // спокойный зелёный «в сети», в тон бумажной палитре

function presenceLabel(p: Presence): string {
  if (p === 'typing') return 'печатает…';
  if (p === 'online') return 'в сети';
  if (p === 'recent') return 'был недавно';
  return 'не в сети';
}
function presenceColor(p: Presence, c: typeof light): string {
  if (p === 'online') return PRESENCE_ONLINE;
  if (p === 'typing') return c.accent;
  return c.textMuted;
}

export default function ChatScreen() {
  const scheme = useColorScheme();
  const c = scheme === 'dark' ? dark : light;
  const { messages, moodBadge, busy, ready, send, streak, daysToMove, lessonMode, setLessonMode } =
    usePablito();
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [pronOpen, setPronOpen] = useState(false);
  const [wordsOpen, setWordsOpen] = useState(false);
  const [memOpen, setMemOpen] = useState(false);
  const [focused, setFocused] = useState(false); // при письме прячем среднюю зону
  const [expanded, setExpanded] = useState(false); // раскрытие чата на весь экран
  const countdown = countdownLabel(daysToMove);

  // P1-6: присутствие «в сети / печатает / был недавно». Чистая UI-симуляция.
  const [presence, setPresence] = useState<Presence>('online');
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyEffectRan = useRef(false);

  // §3.1: инвертированная лента — новейшее это индекс 0 (внизу), надёжно держит низ.
  const data = useMemo(() => messages.slice().reverse(), [messages]);

  // «печатает» ведёт busy; после ответа «в сети», через 20–40 c простоя «был недавно».
  useEffect(() => {
    if (!busyEffectRan.current) {
      busyEffectRan.current = true;
      if (!busy) return;
    }
    if (enterTimer.current) {
      clearTimeout(enterTimer.current);
      enterTimer.current = null;
    }
    if (busy) {
      if (idleTimer.current) {
        clearTimeout(idleTimer.current);
        idleTimer.current = null;
      }
      setPresence('typing');
    } else {
      setPresence('online');
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => setPresence('recent'), rand(20000, 40000));
    }
  }, [busy]);

  // Вход/возврат в чат — иногда «был недавно / не в сети», затем через 1–3 c «в сети».
  useEffect(() => {
    const enter = () => {
      if (busyRef.current) return;
      if (idleTimer.current) {
        clearTimeout(idleTimer.current);
        idleTimer.current = null;
      }
      if (enterTimer.current) clearTimeout(enterTimer.current);
      if (Math.random() < 0.4) {
        setPresence(Math.random() < 0.5 ? 'recent' : 'offline');
        enterTimer.current = setTimeout(() => setPresence('online'), rand(1000, 3000));
      } else {
        setPresence('online');
      }
    };
    enter();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') enter();
    });
    return () => {
      sub.remove();
      if (enterTimer.current) clearTimeout(enterTimer.current);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const midHidden = expanded || focused; // города / режим / панель

  // §3.2 механика 2: свайп по ввод-острову — влево развернуть, вправо свернуть.
  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-24, 24])
        .failOffsetY([-14, 14])
        .onEnd((e) => {
          'worklet';
          if (e.translationX <= -40) runOnJS(setExpanded)(true);
          else if (e.translationX >= 40) runOnJS(setExpanded)(false);
        }),
    []
  );

  const onSend = () => {
    if (!text.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    send(text);
    setText('');
  };

  const onMic = async () => {
    if (recording) {
      setRecording(false);
      const uri = await stopRecording();
      if (!uri) return;
      try {
        const said = await transcribe(uri, 'es');
        if (said) send(said);
      } catch {
        /* тихо игнорируем сбой распознавания */
      }
    } else {
      const ok = await requestMic();
      if (!ok) return;
      await startRecording();
      setRecording(true);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />

      {/* Шапка (обычный режим) */}
      {!expanded && (
        <View style={[styles.header, { borderBottomColor: c.line }]}>
          <View style={styles.brandRow}>
            <Image
              source={require('../../assets/mascot.png')}
              style={[styles.avatar, { borderColor: c.line }]}
            />
            <View>
              <Text style={[styles.brand, { color: c.text }]}>PabLito<Text style={{ color: c.accent }}>_</Text></Text>
              <Text style={[styles.mono, { color: c.textMuted }]}>ES-AR · TU AMIGO PORTEÑO</Text>
              <View style={styles.presenceRow}>
                <View style={[styles.presenceDot, { backgroundColor: presenceColor(presence, c) }]} />
                <Text style={[styles.presenceText, { color: c.textMuted }]}>{presenceLabel(presence)}</Text>
              </View>
            </View>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <Pressable onPress={() => setPronOpen(true)} style={[styles.practice, { borderColor: c.line }]}>
              <Sparkles size={13} color={c.text} />
              <Text style={{ color: c.text, fontSize: 12, fontWeight: '600' }}>Práctica</Text>
            </Pressable>
            <View style={styles.moodPill}>
              <Text style={[styles.mono, { color: c.textMuted }]}>ÁNIMO</Text>
              <Text style={[styles.moodText, { color: c.text }]}>
                {moodBadge.emoji} {moodBadge.label}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Шапка-остров (развёрнутый режим) */}
      {expanded && (
        <Animated.View
          entering={FadeInDown.duration(200)}
          style={[styles.islandHeader, { backgroundColor: c.surface, borderColor: c.line }]}
        >
          <Image source={require('../../assets/mascot.png')} style={[styles.islandAvatar, { borderColor: c.line }]} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.islandName, { color: c.text }]}>Pablito</Text>
            <View style={styles.presenceRow}>
              <View style={[styles.presenceDot, { backgroundColor: presenceColor(presence, c) }]} />
              <Text style={[styles.presenceText, { color: c.textMuted }]}>{presenceLabel(presence)}</Text>
            </View>
          </View>
        </Animated.View>
      )}

      <PronunciationModal visible={pronOpen} onClose={() => setPronOpen(false)} c={c} />
      <LearnedWordsModal visible={wordsOpen} onClose={() => setWordsOpen(false)} c={c} streak={streak} />
      <MemoryModal visible={memOpen} onClose={() => setMemOpen(false)} c={c} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
      >
        {!midHidden && (
          <Animated.View entering={FadeInUp.duration(180)} exiting={FadeOutUp.duration(140)}>
            <View style={[styles.controlBar, { borderBottomColor: c.line }]}>
              <View style={styles.controlSide}>
                <View style={[styles.pill, { borderColor: c.line }]}>
                  <Text style={[styles.pillText, { color: c.text }]}>🔥 {streak}</Text>
                </View>
                {countdown ? (
                  <View style={[styles.pill, { borderColor: c.line }]}>
                    <Text style={[styles.pillText, { color: c.text }]}>{countdown}</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.controlSide}>
                <Pressable onPress={() => setWordsOpen(true)} style={[styles.iconBtn, { borderColor: c.line }]}>
                  <BookOpen size={16} color={c.text} />
                </Pressable>
                <Pressable onPress={() => setMemOpen(true)} style={[styles.iconBtn, { borderColor: c.line }]}>
                  <Brain size={16} color={c.text} />
                </Pressable>
              </View>
            </View>
            <View style={[styles.modeBar, { borderBottomColor: c.line }]}>
              <Text style={[styles.mono, { color: c.textMuted }]}>РЕЖИМ</Text>
              <View style={[styles.toggle, { borderColor: c.line, flex: 1 }]}>
                <Pressable
                  onPress={() => setLessonMode('chat')}
                  style={[styles.tgBtn, styles.tgHalf, { backgroundColor: lessonMode === 'chat' ? c.accent : 'transparent' }]}
                >
                  <Text style={[styles.tgText, { color: lessonMode === 'chat' ? c.accentText : c.text }]}>💬 Друг</Text>
                </Pressable>
                <Pressable
                  onPress={() => setLessonMode('lesson')}
                  style={[styles.tgBtn, styles.tgHalf, { backgroundColor: lessonMode === 'lesson' ? c.accent : 'transparent' }]}
                >
                  <Text style={[styles.tgText, { color: lessonMode === 'lesson' ? c.accentText : c.text }]}>📚 Урок</Text>
                </Pressable>
              </View>
            </View>
            <CityStrip c={c} />
          </Animated.View>
        )}

        <View style={styles.flex}>
          <FlatList
            data={data}
            inverted
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ padding: space(2), gap: space(1.5) }}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => <Bubble msg={item} c={c} />}
          />
          <View style={styles.fabWrap} pointerEvents="box-none">
            <Pressable
              onPress={() => setExpanded((e) => !e)}
              style={({ pressed }) => [
                styles.expandFab,
                { borderColor: c.line, backgroundColor: c.surface, opacity: pressed ? 0.7 : 0.92 },
              ]}
            >
              {expanded ? <Minimize2 size={13} color={c.text} /> : <Maximize2 size={13} color={c.text} />}
              <Text style={[styles.expandTxt, { color: c.text }]}>{expanded ? 'Contraer' : 'Expandir'}</Text>
            </Pressable>
          </View>
        </View>

        {busy ? (
          <View style={styles.typing}>
            <ActivityIndicator color={c.textMuted} />
            <Text style={[styles.mono, { color: c.textMuted }]}>Pablito escribe…</Text>
          </View>
        ) : null}

        {/* Ввод-остров (свайп по нему разворачивает/сворачивает чат) */}
        <GestureDetector gesture={swipe}>
          <View style={[styles.inputBar, { borderTopColor: c.line, backgroundColor: c.surface }]}>
            <Pressable
              onPress={onMic}
              disabled={!ready}
              style={({ pressed }) => [
                styles.mic,
                {
                  borderColor: c.line,
                  backgroundColor: recording ? c.accent : 'transparent',
                  transform: [{ scale: pressed ? 0.92 : 1 }],
                },
              ]}
            >
              {recording ? (
                <Square size={16} color={c.accentText} fill={c.accentText} />
              ) : (
                <Mic size={20} color={c.text} />
              )}
            </Pressable>
            <TextInput
              value={text}
              onChangeText={setText}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={recording ? 'Hablá… te escucho' : 'Escribí o hablá en español…'}
              placeholderTextColor={c.textMuted}
              style={[styles.input, { color: c.text, borderColor: c.line }]}
              multiline
              textAlignVertical="center"
              onSubmitEditing={onSend}
            />
            <Pressable
              onPress={onSend}
              disabled={!ready || busy || !text.trim()}
              style={({ pressed }) => [
                styles.send,
                {
                  backgroundColor: c.accent,
                  opacity: !text.trim() ? 0.4 : pressed ? 0.8 : 1,
                  transform: [{ scale: pressed ? 0.92 : 1 }],
                },
              ]}
            >
              <Send size={18} color={c.accentText} strokeWidth={2.3} />
            </Pressable>
          </View>
        </GestureDetector>
      </KeyboardAvoidingView>
    </View>
  );
}

function Bubble({ msg, c }: { msg: UiMessage; c: typeof light }) {
  const isUser = msg.role === 'user';
  const [tr, setTr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);

  // Тап по реплике Паблито → перевод на русский (повторный тап скрывает).
  const onPress = async () => {
    if (isUser || !msg.text) return;
    if (tr) {
      setShow((s) => !s);
      return;
    }
    setLoading(true);
    try {
      const t = await translate(msg.text);
      setTr(t);
      setShow(true);
    } catch {
      /* нет сети — тихо игнорируем */
    } finally {
      setLoading(false);
    }
  };

  return (
    <Pressable onPress={onPress} disabled={isUser} style={{ alignItems: isUser ? 'flex-end' : 'flex-start' }}>
      <Text style={[styles.mono, { color: c.textMuted, marginBottom: 4 }]}>{isUser ? 'VOS' : 'PABLITO'}</Text>
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: isUser ? c.bubbleUser : c.bubblePablito,
            borderColor: c.line,
            borderTopRightRadius: isUser ? 4 : 18,
            borderTopLeftRadius: isUser ? 18 : 4,
          },
        ]}
      >
        <Text style={{ color: isUser ? c.bubbleUserText : c.bubblePablitoText, fontSize: 16, lineHeight: 23 }}>
          {msg.text}
        </Text>
        {loading ? <Text style={[styles.mono, { color: c.textMuted, marginTop: 6 }]}>перевожу…</Text> : null}
        {show && tr ? (
          <View style={[styles.translation, { borderTopColor: c.line }]}>
            <Text style={{ color: c.textMuted, fontSize: 14, lineHeight: 20 }}>{tr}</Text>
          </View>
        ) : null}
      </View>
      {!isUser && !tr && !loading ? (
        <Text style={[styles.tapHint, { color: c.textMuted }]}>нажми — перевод</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: {
    paddingTop: space(7),
    paddingBottom: space(2),
    paddingHorizontal: space(2),
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: space(1.25) },
  avatar: { width: 40, height: 40, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth },
  brand: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  mono: { fontFamily: 'SpaceMono', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' },
  presenceRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  presenceDot: { width: 7, height: 7, borderRadius: 4 },
  presenceText: { fontSize: 11, fontWeight: '600' },
  islandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1.25),
    marginTop: space(6),
    marginHorizontal: space(2),
    marginBottom: space(0.5),
    paddingVertical: space(1),
    paddingHorizontal: space(1.5),
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  islandAvatar: { width: 34, height: 34, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth },
  islandName: { fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  practice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  moodPill: { alignItems: 'flex-end', gap: 2 },
  controlBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space(2),
    paddingVertical: space(1),
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: space(1),
  },
  controlSide: { flexDirection: 'row', alignItems: 'center', gap: space(0.75), flexShrink: 1 },
  pill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  pillText: { fontSize: 12, fontWeight: '700' },
  modeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1.25),
    paddingHorizontal: space(2),
    paddingVertical: space(0.75),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toggle: { flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, overflow: 'hidden' },
  tgBtn: { paddingVertical: 9, paddingHorizontal: 14 },
  tgHalf: { flex: 1, alignItems: 'center' },
  tgText: { fontSize: 14, fontWeight: '700' },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moodText: { fontSize: 14, fontWeight: '600' },
  fabWrap: { position: 'absolute', top: space(1), right: space(2) },
  expandFab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  expandTxt: { fontSize: 11, fontWeight: '700' },
  bubble: {
    maxWidth: '86%',
    paddingVertical: space(1.25),
    paddingHorizontal: space(1.75),
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  translation: { marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  tapHint: { fontFamily: 'SpaceMono', fontSize: 9, letterSpacing: 0.5, marginTop: 3, opacity: 0.6 },
  typing: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: space(2), paddingBottom: space(1) },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1),
    paddingHorizontal: space(1.5),
    paddingTop: space(1),
    paddingBottom: space(3),
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  mic: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: space(2),
    paddingVertical: Platform.OS === 'ios' ? 12 : 9,
    fontSize: 16,
  },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
