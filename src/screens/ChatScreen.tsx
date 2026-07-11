/**
 * Главный экран (TZ-04): разговор — дом. Минимальный верх (аватар→панель · логотип ·
 * настроение+presence · меню), лента с пузырями (аватар слева, мягкие тени), таблетка
 * режима над лентой, города по тумблеру. Всё остальное — в боковой панели.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
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
import Animated, { FadeInDown, runOnJS } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Maximize2, Menu, Mic, Minimize2, Paperclip, Plus, Search, Send, Square, X } from 'lucide-react-native';
import { dark, light, space } from '@/theme/theme';
import { usePablito, type UiMessage } from '@/hooks/usePablito';
import CityStrip from '@/components/CityStrip';
import PronunciationModal from '@/screens/PronunciationModal';
import LearnedWordsModal from '@/screens/LearnedWordsModal';
import MemoryModal from '@/screens/MemoryModal';
import ProfileDrawer from '@/screens/ProfileDrawer';
import KineticWordmark from '@/components/KineticWordmark';
import { requestMic, startRecording, stopRecording } from '@/core/voice';
import { transcribe, translate, translateWord } from '@/api/navy';
import * as mem from '@/core/memory';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

const MASCOT = require('../../assets/mascot.png');

type Presence = 'online' | 'typing' | 'recent' | 'offline';
const rand = (min: number, max: number) => min + Math.floor(Math.random() * (max - min));
const PRESENCE_ONLINE = '#3E9B6B';

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

// §2: разбивка текста на слова (латиница + испанские буквы), пунктуация/пробелы сохраняются.
const WORD_RE = /[A-Za-zÀ-ÿ]+/;
function tokenizeWords(text: string): { t: string; w: boolean }[] {
  return text
    .split(/([A-Za-zÀ-ÿ]+)/)
    .filter((s) => s.length > 0)
    .map((s) => ({ t: s, w: WORD_RE.test(s) }));
}

export default function ChatScreen() {
  const scheme = useColorScheme();
  const c = scheme === 'dark' ? dark : light;
  const { messages, moodBadge, busy, ready, send, sendPhoto, name, streak, daysToMove, lessonMode, setLessonMode } =
    usePablito();
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [pronOpen, setPronOpen] = useState(false);
  const [wordsOpen, setWordsOpen] = useState(false);
  const [memOpen, setMemOpen] = useState(false);
  const [focused, setFocused] = useState(false); // при письме прячем города
  const [expanded, setExpanded] = useState(false); // раскрытие чата на весь экран
  const [drawerOpen, setDrawerOpen] = useState(false); // §6.2 боковая панель
  const [searchOpen, setSearchOpen] = useState(false); // §5 поиск по чату
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<mem.MessageHit[]>([]);
  const [showCities, setShowCities] = useState(true); // §6.1 тумблер городов
  const listRef = useRef<FlatList<UiMessage>>(null);

  // §2: поповер перевода отдельного слова + кэш переводов слов.
  const wordCache = useRef<Map<string, string>>(new Map());
  const [wordPop, setWordPop] = useState<string | null>(null);
  const [wordTr, setWordTr] = useState<string | null>(null);
  const [wordLoading, setWordLoading] = useState(false);
  const [wordAdded, setWordAdded] = useState(false);

  // P1-6: присутствие «в сети / печатает / был недавно». Чистая UI-симуляция.
  const [presence, setPresence] = useState<Presence>('online');
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyEffectRan = useRef(false);

  // §3.1: инвертированная лента — новейшее это индекс 0 (внизу), надёжно держит низ.
  const data = useMemo(() => messages.slice().reverse(), [messages]);

  useEffect(() => {
    mem.getSetting('show_cities').then((v) => setShowCities(v !== '0')).catch(() => {});
  }, []);

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

  // Свайп по грабберу — развернуть/свернуть чат.
  const swipe = useMemo(
    () =>
      Gesture.Pan().onEnd((e) => {
        'worklet';
        if (e.translationY <= -28) runOnJS(setExpanded)(true);
        else if (e.translationY >= 28) runOnJS(setExpanded)(false);
      }),
    []
  );

  // §6.2: edge-swipe от левого края ленты → открыть панель.
  const edgeSwipe = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX(12)
        .failOffsetY([-20, 20])
        .onEnd((e) => {
          'worklet';
          if (e.translationX > 36) runOnJS(setDrawerOpen)(true);
        }),
    []
  );

  // §5: поиск по переписке — перезапрос при каждом вводе, пока открыт оверлей.
  useEffect(() => {
    if (!searchOpen) return;
    const q = searchQ.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    let alive = true;
    mem
      .searchMessages(q, 40)
      .then((r) => alive && setSearchResults(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [searchQ, searchOpen]);

  const jumpToHit = (hit: mem.MessageHit) => {
    setSearchOpen(false);
    const mi = messages.findIndex((m) => m.text === hit.content);
    if (mi < 0) return;
    const idx = messages.length - 1 - mi;
    requestAnimationFrame(() => {
      try {
        listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
      } catch {
        /* не измерено — игнорируем */
      }
    });
  };

  const toggleCities = (v: boolean) => {
    setShowCities(v);
    mem.setSetting('show_cities', v ? '1' : '0').catch(() => {});
  };

  const toggleMode = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setLessonMode(lessonMode === 'lesson' ? 'chat' : 'lesson');
  };

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

  // §4: выбрать фото → ресайз ≤768px + сжатие → на разбор Паблито по-испански.
  const onPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({ quality: 1 });
    if (res.canceled || !res.assets?.[0]) return;
    try {
      const m = await ImageManipulator.manipulateAsync(res.assets[0].uri, [{ resize: { width: 768 } }], {
        compress: 0.5,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      });
      if (m.base64) sendPhoto(m.base64, 'image/jpeg', m.uri);
    } catch {
      /* не удалось обработать фото — тихо */
    }
  };

  const openWord = async (raw: string, sentence: string) => {
    const word = raw.trim();
    if (!word) return;
    setWordPop(word);
    setWordAdded(false);
    const key = word.toLowerCase();
    const cached = wordCache.current.get(key);
    if (cached) {
      setWordTr(cached);
      setWordLoading(false);
      return;
    }
    setWordTr(null);
    setWordLoading(true);
    try {
      const t = await translateWord(word, sentence);
      wordCache.current.set(key, t);
      setWordTr(t);
    } catch {
      /* нет сети — тихо */
    } finally {
      setWordLoading(false);
    }
  };

  const addWord = async () => {
    if (!wordPop || !wordTr) return;
    try {
      await mem.upsertVocab([{ word: wordPop.toLowerCase(), translation: wordTr, context: 'new' }]);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setWordAdded(true);
    } catch {
      /* тихо */
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />

      {/* Минимальная шапка */}
      {!expanded && (
        <View style={[styles.header, { borderBottomColor: c.line }]}>
          <View style={styles.brandRow}>
            <Pressable onPress={() => setDrawerOpen(true)}>
              <Image source={MASCOT} style={[styles.avatar, { borderColor: c.line }]} />
            </Pressable>
            <View>
              <KineticWordmark c={c} />
              <View style={styles.presenceRow}>
                <Text style={{ fontSize: 12 }}>{moodBadge.emoji}</Text>
                <View style={[styles.presenceDot, { backgroundColor: presenceColor(presence, c) }]} />
                <Text style={[styles.presenceText, { color: c.textMuted }]}>{presenceLabel(presence)}</Text>
              </View>
            </View>
          </View>
          <Pressable onPress={() => setDrawerOpen(true)} hitSlop={10} style={styles.menuBtn}>
            <Menu size={24} color={c.text} />
          </Pressable>
        </View>
      )}

      {/* Шапка-остров (развёрнутый режим) */}
      {expanded && (
        <Animated.View
          entering={FadeInDown.duration(200)}
          style={[styles.islandHeader, { backgroundColor: c.surface, borderColor: c.line }]}
        >
          <Pressable onPress={() => setDrawerOpen(true)}>
            <Image source={MASCOT} style={[styles.islandAvatar, { borderColor: c.line }]} />
          </Pressable>
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

      <ProfileDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        c={c}
        name={name}
        streak={streak}
        daysToMove={daysToMove}
        showCities={showCities}
        onToggleCities={toggleCities}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenWords={() => setWordsOpen(true)}
        onOpenMemory={() => setMemOpen(true)}
        onOpenPractice={() => setPronOpen(true)}
      />

      {/* §5: поиск по переписке */}
      <Modal visible={searchOpen} transparent animationType="fade" onRequestClose={() => setSearchOpen(false)}>
        <View style={[styles.searchWrap, { backgroundColor: c.bg }]}>
          <View style={[styles.searchBar, { borderColor: c.line, backgroundColor: c.surface }]}>
            <Search size={18} color={c.textMuted} />
            <TextInput
              value={searchQ}
              onChangeText={setSearchQ}
              autoFocus
              placeholder="Найти в переписке…"
              placeholderTextColor={c.textMuted}
              style={{ flex: 1, color: c.text, fontSize: 16 }}
            />
            <Pressable onPress={() => setSearchOpen(false)} hitSlop={10}>
              <X size={20} color={c.textMuted} />
            </Pressable>
          </View>
          <FlatList
            data={searchResults}
            keyExtractor={(h) => String(h.id)}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: space(2), gap: space(1) }}
            ListEmptyComponent={
              searchQ.trim() ? (
                <Text style={[styles.mono, { color: c.textMuted, textAlign: 'center', marginTop: space(3) }]}>
                  ничего не найдено
                </Text>
              ) : null
            }
            renderItem={({ item }) => (
              <Pressable onPress={() => jumpToHit(item)} style={[styles.searchRow, { borderColor: c.line }]}>
                <Text style={[styles.mono, { color: c.textMuted }]}>{item.role === 'user' ? 'ВЫ' : 'PABLITO'}</Text>
                <Text style={{ color: c.text, fontSize: 15, lineHeight: 20, marginTop: 2 }} numberOfLines={3}>
                  {item.content}
                </Text>
              </Pressable>
            )}
          />
        </View>
      </Modal>

      {/* §2: поповер перевода слова */}
      <Modal visible={wordPop !== null} transparent animationType="fade" onRequestClose={() => setWordPop(null)}>
        <Pressable style={styles.wordOverlay} onPress={() => setWordPop(null)}>
          <Pressable style={[styles.wordCard, { backgroundColor: c.surface, borderColor: c.line }]} onPress={() => {}}>
            <Text style={[styles.wordTitle, { color: c.text }]}>{wordPop}</Text>
            {wordLoading ? (
              <ActivityIndicator color={c.textMuted} style={{ marginVertical: 8 }} />
            ) : (
              <Text style={[styles.wordTrText, { color: c.textMuted }]}>{wordTr ?? '—'}</Text>
            )}
            <Pressable
              onPress={addWord}
              disabled={!wordTr || wordAdded}
              style={[styles.wordAdd, { backgroundColor: wordAdded ? 'transparent' : c.accent, borderColor: c.accent }]}
            >
              <Plus size={15} color={wordAdded ? c.accent : c.accentText} />
              <Text style={{ color: wordAdded ? c.accent : c.accentText, fontWeight: '700', fontSize: 13 }}>
                {wordAdded ? 'в словаре ✓' : 'в словарь'}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
      >
        {showCities && !focused && !expanded ? <CityStrip c={c} /> : null}

        <View style={styles.flex}>
          <FlatList
            ref={listRef}
            data={data}
            inverted
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ paddingHorizontal: space(2), paddingTop: space(2), paddingBottom: space(5.5), gap: space(1.5) }}
            keyboardShouldPersistTaps="handled"
            onScrollToIndexFailed={() => {}}
            renderItem={({ item }) => <Bubble msg={item} c={c} onWord={openWord} />}
          />

          {/* §7: таблетка режима над лентой (пока переключает режим; треды — позже) */}
          <View style={styles.topFloat} pointerEvents="box-none">
            <Pressable
              onPress={toggleMode}
              style={({ pressed }) => [styles.modePill, { borderColor: c.line, backgroundColor: c.surface, opacity: pressed ? 0.7 : 0.92 }]}
            >
              <Text style={[styles.modePillText, { color: c.text }]}>
                {lessonMode === 'lesson' ? '📚 Урок' : '💬 Друг'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setExpanded((e) => !e)}
              style={({ pressed }) => [styles.expandFab, { borderColor: c.line, backgroundColor: c.surface, opacity: pressed ? 0.7 : 0.92 }]}
            >
              {expanded ? <Minimize2 size={13} color={c.text} /> : <Maximize2 size={13} color={c.text} />}
            </Pressable>
          </View>

          <GestureDetector gesture={edgeSwipe}>
            <View style={styles.edgeZone} />
          </GestureDetector>
        </View>

        {busy ? (
          <View style={styles.typing}>
            <ActivityIndicator color={c.textMuted} />
            <Text style={[styles.mono, { color: c.textMuted }]}>Pablito escribe…</Text>
          </View>
        ) : null}

        {/* Граббер: свайп вверх — развернуть чат, вниз — свернуть */}
        <GestureDetector gesture={swipe}>
          <View style={styles.grabberZone}>
            <View style={[styles.grabber, { backgroundColor: c.line }]} />
          </View>
        </GestureDetector>

        {/* §9: ввод-остров — [📎] · [текст] · [микрофон] */}
        <View style={[styles.inputBar, { borderTopColor: c.line, backgroundColor: c.surface }]}>
          <Pressable onPress={onPhoto} disabled={!ready} style={[styles.attach, { borderColor: c.line }]}>
            <Paperclip size={18} color={c.text} />
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
          {text.trim() ? (
            <Pressable
              onPress={onSend}
              disabled={!ready || busy}
              style={({ pressed }) => [styles.send, { backgroundColor: c.accent, opacity: pressed ? 0.8 : 1 }]}
            >
              <Send size={20} color={c.accentText} strokeWidth={2.3} />
            </Pressable>
          ) : (
            <Pressable
              onPress={onMic}
              disabled={!ready}
              style={({ pressed }) => [
                styles.micBig,
                { backgroundColor: recording ? '#C0553B' : c.accent, transform: [{ scale: pressed ? 0.94 : 1 }] },
              ]}
            >
              {recording ? (
                <Square size={18} color="#fff" fill="#fff" />
              ) : (
                <Mic size={24} color={c.accentText} />
              )}
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function Bubble({ msg, c, onWord }: { msg: UiMessage; c: typeof light; onWord: (w: string, sentence: string) => void }) {
  const isUser = msg.role === 'user';
  const [tr, setTr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);

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
    <View style={[styles.bubbleRow, { justifyContent: isUser ? 'flex-end' : 'flex-start' }]}>
      {!isUser ? <Image source={MASCOT} style={[styles.bubbleAvatar, { borderColor: c.line }]} /> : null}
      <Pressable onPress={onPress} disabled={isUser} style={{ maxWidth: '82%' }}>
        <View
          style={[
            styles.bubble,
            {
              backgroundColor: isUser ? c.bubbleUser : c.bubblePablito,
              borderTopRightRadius: isUser ? 6 : 20,
              borderTopLeftRadius: isUser ? 20 : 6,
            },
          ]}
        >
          {msg.image ? <Image source={{ uri: msg.image }} style={styles.bubbleImg} /> : null}
          {msg.text ? (
            <Text style={{ color: isUser ? c.bubbleUserText : c.bubblePablitoText, fontSize: 16, lineHeight: 23 }}>
              {tokenizeWords(msg.text).map((tok, i) =>
                tok.w ? (
                  <Text key={i} onPress={onPress} onLongPress={() => onWord(tok.t, msg.text)}>
                    {tok.t}
                  </Text>
                ) : (
                  <Text key={i}>{tok.t}</Text>
                )
              )}
            </Text>
          ) : null}
          {loading ? <Text style={[styles.mono, { color: c.textMuted, marginTop: 6 }]}>перевожу…</Text> : null}
          {show && tr ? (
            <View style={[styles.translation, { borderTopColor: c.line }]}>
              <Text style={{ color: c.textMuted, fontSize: 14, lineHeight: 20 }}>{tr}</Text>
            </View>
          ) : null}
        </View>
        {!isUser && !tr && !loading ? (
          <Text style={[styles.tapHint, { color: c.textMuted }]}>нажми — перевод · держи слово — в словарь</Text>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: {
    paddingTop: space(7),
    paddingBottom: space(1.5),
    paddingHorizontal: space(2),
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: space(1.25) },
  avatar: { width: 40, height: 40, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth },
  mono: { fontFamily: 'SpaceMono', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' },
  presenceRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  presenceDot: { width: 7, height: 7, borderRadius: 4 },
  presenceText: { fontSize: 11, fontWeight: '600' },
  menuBtn: { padding: 4 },
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
  topFloat: {
    position: 'absolute',
    top: space(1),
    left: 0,
    right: 0,
    paddingHorizontal: space(2),
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modePill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  modePillText: { fontSize: 13, fontWeight: '700' },
  expandFab: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  edgeZone: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 16 },
  searchWrap: { flex: 1, paddingTop: space(7) },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1),
    marginHorizontal: space(2),
    paddingHorizontal: space(1.75),
    paddingVertical: space(1.25),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
  },
  searchRow: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: space(1.5) },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
  bubbleAvatar: { width: 28, height: 28, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, marginBottom: 2 },
  bubble: {
    paddingVertical: space(1.25),
    paddingHorizontal: space(1.75),
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  bubbleImg: { width: 220, height: 220, borderRadius: 12, marginBottom: 4 },
  translation: { marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  wordOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', padding: space(4) },
  wordCard: {
    minWidth: 240,
    maxWidth: '86%',
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space(2.5),
    alignItems: 'center',
    gap: 8,
  },
  wordTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  wordTrText: { fontSize: 16, textAlign: 'center' },
  wordAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginTop: 4,
  },
  tapHint: { fontFamily: 'SpaceMono', fontSize: 9, letterSpacing: 0.5, marginTop: 3, marginLeft: 4, opacity: 0.55 },
  typing: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: space(2), paddingBottom: space(1) },
  grabberZone: { alignItems: 'center', paddingVertical: space(0.75) },
  grabber: { width: 44, height: 5, borderRadius: 3, opacity: 0.5 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1),
    paddingHorizontal: space(1.5),
    paddingTop: space(0.5),
    paddingBottom: space(3),
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  attach: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
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
  micBig: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
});
