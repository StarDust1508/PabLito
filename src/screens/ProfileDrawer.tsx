/**
 * §6.2 (TZ-04): единственная навигация — боковая панель (как ChatGPT).
 * Секции: Профиль · Поиск · Прогресс · Инструменты · История 30 дней · Настройки.
 * Переключателя режима здесь НЕТ (режимы — таблеткой на чате, §7). Модалки и поиск
 * открываются колбэками из ChatScreen (им нужно оверлеить весь экран).
 */
import { useEffect, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Animated, { SlideInLeft } from 'react-native-reanimated';
import { BookOpen, Brain, ChevronRight, MapPin, Mic, Search, Trash2, Volume2, VolumeX } from 'lucide-react-native';
import { type Palette, space } from '@/theme/theme';
import { type ThemeMode } from '@/theme/ThemeProvider';
import { USER_PROFILE } from '@/config';
import { countdownLabel, milestones, type Milestone } from '@/core/progress';
import { isSpeechMuted, setSpeechMuted } from '@/core/voice';
import * as mem from '@/core/memory';

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  c: Palette;
  name: string | null;
  streak: number;
  daysToMove: number | null;
  showCities: boolean;
  onToggleCities: (v: boolean) => void;
  onOpenSearch: () => void;
  onOpenWords: () => void;
  onOpenMemory: () => void;
  onOpenPractice: () => void;
  themeMode: ThemeMode;
  onSetTheme: (m: ThemeMode) => void;
}

export default function ProfileDrawer(p: Props) {
  const { visible, onClose, c } = p;
  const [sessions, setSessions] = useState<mem.SessionRow[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [muted, setMuted] = useState(isSpeechMuted());
  const [words, setWords] = useState(0);
  const [mstones, setMstones] = useState<Milestone[]>([]);
  const [working, setWorking] = useState<string[]>([]);
  const countdown = countdownLabel(p.daysToMove);

  useEffect(() => {
    if (!visible) return;
    setMuted(isSpeechMuted());
    mem.getSessions(30).then(setSessions).catch(() => {});
    mem.learnedCount().then((n) => {
      setWords(n);
      setMstones(milestones({ learnedWords: n, streak: p.streak, spanishOnlyTurn: false }));
    }).catch(() => {});
    mem
      .getActiveFacts()
      .then((f) => setWorking(f.filter((x) => x.kind === 'error_pattern').slice(0, 4).map((x) => x.text)))
      .catch(() => {});
  }, [visible, p.streak]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    setSpeechMuted(next);
    mem.setSetting('tts_muted', next ? '1' : '0').catch(() => {});
  };

  const confirmClear = () =>
    Alert.alert('Стереть память?', 'Паблито забудет факты о тебе, обещания и моменты. Словарь и прогресс останутся.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Стереть', style: 'destructive', onPress: () => { mem.clearKnowledge().catch(() => {}); onClose(); } },
    ]);

  const nav = (fn: () => void) => () => { onClose(); fn(); };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <Animated.View entering={SlideInLeft.duration(220)} style={[styles.panel, { backgroundColor: c.bg, borderRightColor: c.line }]}>
          <ScrollView contentContainerStyle={{ paddingBottom: space(5) }} showsVerticalScrollIndicator={false}>
            {/* Профиль */}
            <View style={styles.header}>
              <Image source={require('../../assets/mascot.png')} style={[styles.avatar, { borderColor: c.line }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: c.text }]}>{p.name ?? 'Aprendiz'}</Text>
                <Text style={[styles.mono, { color: c.textMuted }]}>{USER_PROFILE.level}</Text>
              </View>
            </View>
            <Text style={[styles.goal, { color: c.textMuted }]}>
              🇦🇷 {USER_PROFILE.goal}
              {countdown ? `  ·  ${countdown}` : ''}
            </Text>

            {/* Поиск */}
            <Pressable onPress={nav(p.onOpenSearch)} style={[styles.row, { borderColor: c.line }]}>
              <Search size={18} color={c.text} />
              <Text style={[styles.rowText, { color: c.text }]}>Поиск по чату</Text>
              <ChevronRight size={18} color={c.textMuted} />
            </Pressable>

            {/* Прогресс */}
            <Text style={[styles.section, { color: c.textMuted }]}>ПРОГРЕСС</Text>
            <View style={styles.statsRow}>
              <View style={[styles.stat, { borderColor: c.line }]}>
                <Text style={[styles.statValue, { color: c.text }]}>🔥 {p.streak}</Text>
                <Text style={[styles.mono, { color: c.textMuted }]}>СТРИК</Text>
              </View>
              <View style={[styles.stat, { borderColor: c.line }]}>
                <Text style={[styles.statValue, { color: c.text }]}>{words}</Text>
                <Text style={[styles.mono, { color: c.textMuted }]}>СЛОВ</Text>
              </View>
            </View>
            <Pressable onPress={nav(p.onOpenWords)} style={[styles.row, { borderColor: c.line }]}>
              <BookOpen size={18} color={c.text} />
              <Text style={[styles.rowText, { color: c.text }]}>Слова и вехи</Text>
              <ChevronRight size={18} color={c.textMuted} />
            </Pressable>
            {mstones.filter((m) => m.reached).length > 0 ? (
              <Text style={[styles.hint, { color: c.textMuted }]}>
                вехи: {mstones.filter((m) => m.reached).map((m) => m.label).join(' · ')}
              </Text>
            ) : null}
            {working.length > 0 ? (
              <View style={[styles.working, { borderColor: c.line }]}>
                <Text style={[styles.mono, { color: c.textMuted }]}>НАД ЧЕМ РАБОТАЕМ</Text>
                {working.map((w, i) => (
                  <Text key={i} style={{ color: c.text, fontSize: 13, lineHeight: 18, marginTop: 3 }}>• {w}</Text>
                ))}
              </View>
            ) : null}

            {/* Инструменты */}
            <Text style={[styles.section, { color: c.textMuted }]}>ИНСТРУМЕНТЫ</Text>
            <Pressable onPress={nav(p.onOpenPractice)} style={[styles.row, { borderColor: c.line }]}>
              <Mic size={18} color={c.text} />
              <Text style={[styles.rowText, { color: c.text }]}>Произношение</Text>
              <ChevronRight size={18} color={c.textMuted} />
            </Pressable>
            <View style={[styles.row, { borderColor: c.line }]}>
              <MapPin size={18} color={c.text} />
              <Text style={[styles.rowText, { color: c.text }]}>Города на главном</Text>
              <Switch value={p.showCities} onValueChange={p.onToggleCities} />
            </View>

            {/* История 30 дней */}
            <Text style={[styles.section, { color: c.textMuted }]}>ИСТОРИЯ · 30 ДНЕЙ</Text>
            {sessions.length === 0 ? (
              <Text style={[styles.hint, { color: c.textMuted }]}>Пока пусто — начни разговор 🙂</Text>
            ) : (
              sessions.map((s) => (
                <Pressable
                  key={s.id}
                  onPress={() => setOpenId((cur) => (cur === s.id ? null : s.id))}
                  style={[styles.sessRow, { borderColor: c.line }]}
                >
                  <View style={[styles.dot, { backgroundColor: s.mode === 'lesson' ? c.accent : c.bg, borderColor: c.line }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.mono, { color: c.textMuted }]}>
                      {fmtDate(s.started_at)} · {s.mode === 'lesson' ? 'УРОК' : 'ДРУГ'}
                    </Text>
                    <Text
                      style={{ color: c.text, fontSize: 14, lineHeight: 19, marginTop: 2 }}
                      numberOfLines={openId === s.id ? undefined : 2}
                    >
                      {s.summary ?? 'Без резюме'}
                    </Text>
                  </View>
                </Pressable>
              ))
            )}

            {/* Настройки */}
            <Text style={[styles.section, { color: c.textMuted }]}>НАСТРОЙКИ</Text>
            <Text style={[styles.subLabel, { color: c.textMuted }]}>Тема</Text>
            <View style={[styles.themeRow, { borderColor: c.line }]}>
              {(['light', 'dark', 'system'] as ThemeMode[]).map((m) => (
                <Pressable
                  key={m}
                  onPress={() => p.onSetTheme(m)}
                  style={[styles.themeSeg, { backgroundColor: p.themeMode === m ? c.accent : 'transparent' }]}
                >
                  <Text style={{ color: p.themeMode === m ? c.accentText : c.text, fontSize: 13, fontWeight: '700' }}>
                    {m === 'light' ? 'Светлая' : m === 'dark' ? 'Тёмная' : 'Система'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={toggleMute} style={[styles.row, { borderColor: c.line }]}>
              {muted ? <VolumeX size={18} color={c.text} /> : <Volume2 size={18} color={c.text} />}
              <Text style={[styles.rowText, { color: c.text }]}>Озвучка ответов</Text>
              <Text style={[styles.state, { color: muted ? c.textMuted : c.accent }]}>{muted ? 'выкл' : 'вкл'}</Text>
            </Pressable>
            <Pressable onPress={nav(p.onOpenMemory)} style={[styles.row, { borderColor: c.line }]}>
              <Brain size={18} color={c.text} />
              <Text style={[styles.rowText, { color: c.text }]}>Что Паблито обо мне знает</Text>
              <ChevronRight size={18} color={c.textMuted} />
            </Pressable>
            <Pressable onPress={confirmClear} style={[styles.row, { borderColor: c.line }]}>
              <Trash2 size={18} color="#C0553B" />
              <Text style={[styles.rowText, { color: '#C0553B' }]}>Стереть память</Text>
            </Pressable>
          </ScrollView>
        </Animated.View>
        <Pressable style={styles.scrim} onPress={onClose} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, flexDirection: 'row' },
  panel: { width: '86%', maxWidth: 400, paddingTop: space(7), paddingHorizontal: space(2.5), borderRightWidth: StyleSheet.hairlineWidth },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  avatar: { width: 52, height: 52, borderRadius: 26, borderWidth: StyleSheet.hairlineWidth },
  name: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  mono: { fontFamily: 'SpaceMono', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' },
  goal: { fontSize: 13, lineHeight: 18, marginTop: space(1) },
  section: { fontFamily: 'SpaceMono', fontSize: 10, letterSpacing: 1.5, marginTop: space(3), marginBottom: space(1) },
  statsRow: { flexDirection: 'row', gap: space(1), marginBottom: space(1) },
  stat: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingVertical: space(1.25), paddingHorizontal: space(1.5), gap: 4 },
  statValue: { fontSize: 16, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1.5),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingVertical: space(1.5),
    paddingHorizontal: space(1.75),
    marginBottom: space(1),
  },
  rowText: { flex: 1, fontSize: 15, fontWeight: '600' },
  subLabel: { fontSize: 12, marginBottom: 6 },
  themeRow: { flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, overflow: 'hidden', marginBottom: space(1) },
  themeSeg: { flex: 1, alignItems: 'center', paddingVertical: space(1.25) },
  state: { fontSize: 13, fontWeight: '700' },
  hint: { fontSize: 13, lineHeight: 18, marginBottom: space(1), fontStyle: 'italic' },
  working: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: space(1.5), marginBottom: space(1) },
  sessRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space(1.25),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: space(1.5),
    marginBottom: space(1),
  },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: StyleSheet.hairlineWidth, marginTop: 3 },
});
