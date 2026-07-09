/**
 * §6: выдвижная шторка профиля (слева, как в ChatGPT).
 * Профиль · история 30 дней (бело/синие метки режима) · дубль режима · настройки.
 * Открытие — тапом по аватару или edge-swipe (в ChatScreen). Тема/«пишет первым» — позже.
 */
import { useEffect, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { SlideInLeft } from 'react-native-reanimated';
import { Brain, Trash2, Volume2, VolumeX, X } from 'lucide-react-native';
import { type Palette, space } from '@/theme/theme';
import { USER_PROFILE } from '@/config';
import { countdownLabel } from '@/core/progress';
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
  lessonMode: mem.LessonMode;
  setLessonMode: (m: mem.LessonMode) => void;
  onOpenMemory: () => void;
}

export default function ProfileDrawer({
  visible,
  onClose,
  c,
  name,
  streak,
  daysToMove,
  lessonMode,
  setLessonMode,
  onOpenMemory,
}: Props) {
  const [sessions, setSessions] = useState<mem.SessionRow[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [muted, setMuted] = useState(isSpeechMuted());
  const countdown = countdownLabel(daysToMove);

  useEffect(() => {
    if (!visible) return;
    setMuted(isSpeechMuted());
    mem.getSessions(30).then(setSessions).catch(() => {});
  }, [visible]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    setSpeechMuted(next);
    mem.setSetting('tts_muted', next ? '1' : '0').catch(() => {});
  };

  const confirmClear = () => {
    Alert.alert('Стереть память?', 'Паблито забудет факты о тебе, обещания и моменты. Словарь и прогресс останутся.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Стереть',
        style: 'destructive',
        onPress: () => {
          mem.clearKnowledge().catch(() => {});
          onClose();
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <Animated.View entering={SlideInLeft.duration(220)} style={[styles.panel, { backgroundColor: c.bg, borderRightColor: c.line }]}>
          <ScrollView contentContainerStyle={{ paddingBottom: space(4) }} showsVerticalScrollIndicator={false}>
            {/* Профиль */}
            <View style={styles.header}>
              <Image source={require('../../assets/mascot.png')} style={[styles.avatar, { borderColor: c.line }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: c.text }]}>{name ?? 'Aprendiz'}</Text>
                <Text style={[styles.mono, { color: c.textMuted }]}>{USER_PROFILE.level}</Text>
              </View>
              <Pressable onPress={onClose} hitSlop={10}>
                <X size={22} color={c.textMuted} />
              </Pressable>
            </View>

            <View style={styles.statsRow}>
              <View style={[styles.stat, { borderColor: c.line }]}>
                <Text style={[styles.statValue, { color: c.text }]}>🔥 {streak}</Text>
                <Text style={[styles.mono, { color: c.textMuted }]}>СТРИК</Text>
              </View>
              {countdown ? (
                <View style={[styles.stat, { borderColor: c.line }]}>
                  <Text style={[styles.statValue, { color: c.text }]}>{countdown}</Text>
                  <Text style={[styles.mono, { color: c.textMuted }]}>ДО ЦЕЛИ</Text>
                </View>
              ) : null}
            </View>

            {/* Режим (дубль) */}
            <Text style={[styles.section, { color: c.textMuted }]}>РЕЖИМ</Text>
            <View style={[styles.toggle, { borderColor: c.line }]}>
              <Pressable
                onPress={() => setLessonMode('chat')}
                style={[styles.tgBtn, { backgroundColor: lessonMode === 'chat' ? c.accent : 'transparent' }]}
              >
                <Text style={[styles.tgText, { color: lessonMode === 'chat' ? c.accentText : c.text }]}>💬 Друг</Text>
              </Pressable>
              <Pressable
                onPress={() => setLessonMode('lesson')}
                style={[styles.tgBtn, { backgroundColor: lessonMode === 'lesson' ? c.accent : 'transparent' }]}
              >
                <Text style={[styles.tgText, { color: lessonMode === 'lesson' ? c.accentText : c.text }]}>📚 Урок</Text>
              </Pressable>
            </View>

            {/* История 30 дней */}
            <Text style={[styles.section, { color: c.textMuted }]}>ИСТОРИЯ · 30 ДНЕЙ</Text>
            {sessions.length === 0 ? (
              <Text style={[styles.empty, { color: c.textMuted }]}>Пока пусто — начни разговор 🙂</Text>
            ) : (
              sessions.map((s) => (
                <Pressable
                  key={s.id}
                  onPress={() => setOpenId((cur) => (cur === s.id ? null : s.id))}
                  style={[styles.sessRow, { borderColor: c.line }]}
                >
                  <View
                    style={[
                      styles.dot,
                      { backgroundColor: s.mode === 'lesson' ? c.accent : c.bg, borderColor: c.line },
                    ]}
                  />
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
            <Pressable onPress={toggleMute} style={[styles.setRow, { borderColor: c.line }]}>
              {muted ? <VolumeX size={18} color={c.text} /> : <Volume2 size={18} color={c.text} />}
              <Text style={[styles.setText, { color: c.text }]}>Озвучка ответов</Text>
              <Text style={[styles.setState, { color: muted ? c.textMuted : c.accent }]}>{muted ? 'выкл' : 'вкл'}</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                onOpenMemory();
              }}
              style={[styles.setRow, { borderColor: c.line }]}
            >
              <Brain size={18} color={c.text} />
              <Text style={[styles.setText, { color: c.text }]}>Что Паблито обо мне знает</Text>
            </Pressable>
            <Pressable onPress={confirmClear} style={[styles.setRow, { borderColor: c.line }]}>
              <Trash2 size={18} color="#C0553B" />
              <Text style={[styles.setText, { color: '#C0553B' }]}>Стереть память</Text>
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
  panel: {
    width: '84%',
    maxWidth: 380,
    paddingTop: space(7),
    paddingHorizontal: space(2.5),
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  avatar: { width: 52, height: 52, borderRadius: 26, borderWidth: StyleSheet.hairlineWidth },
  name: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  mono: { fontFamily: 'SpaceMono', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' },
  statsRow: { flexDirection: 'row', gap: space(1), marginTop: space(2) },
  stat: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingVertical: space(1.25),
    paddingHorizontal: space(1.5),
    gap: 4,
  },
  statValue: { fontSize: 15, fontWeight: '700' },
  section: { fontFamily: 'SpaceMono', fontSize: 10, letterSpacing: 1.5, marginTop: space(3), marginBottom: space(1) },
  toggle: { flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, overflow: 'hidden' },
  tgBtn: { flex: 1, alignItems: 'center', paddingVertical: 9 },
  tgText: { fontSize: 14, fontWeight: '700' },
  empty: { fontSize: 14, fontStyle: 'italic', paddingVertical: space(1) },
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
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1.5),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingVertical: space(1.5),
    paddingHorizontal: space(1.75),
    marginBottom: space(1),
  },
  setText: { flex: 1, fontSize: 15, fontWeight: '600' },
  setState: { fontSize: 13, fontWeight: '700' },
});
