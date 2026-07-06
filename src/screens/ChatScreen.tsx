/**
 * Главный экран: чат с Паблито. Текст + голос. Индикатор настроения сверху.
 * Оформление — редакторский минимализм malvah: моно-лейблы, воздух, один акцент.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { dark, light, space } from '@/theme/theme';
import { usePablito, type UiMessage } from '@/hooks/usePablito';
import CityStrip from '@/components/CityStrip';
import PronunciationModal from '@/screens/PronunciationModal';
import LearnedWordsModal from '@/screens/LearnedWordsModal';
import MemoryModal from '@/screens/MemoryModal';
import { countdownLabel } from '@/core/progress';
import { requestMic, startRecording, stopRecording } from '@/core/voice';
import { transcribe } from '@/api/navy';

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
  const countdown = countdownLabel(daysToMove);
  const listRef = useRef<FlatList<UiMessage>>(null);

  // Скроллим и при новом сообщении, и по мере роста текста во время стриминга.
  const lastLen = messages[messages.length - 1]?.text.length ?? 0;
  useEffect(() => {
    const t = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [messages.length, lastLen]);

  const onSend = () => {
    if (!text.trim()) return;
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

      {/* Шапка в стиле malvah */}
      <View style={[styles.header, { borderBottomColor: c.line }]}>
        <View style={styles.brandRow}>
          <Image
            source={require('../../assets/mascot.png')}
            style={[styles.avatar, { borderColor: c.line }]}
          />
          <View>
            <Text style={[styles.brand, { color: c.text }]}>PabLito<Text style={{ color: c.accent }}>_</Text></Text>
            <Text style={[styles.mono, { color: c.textMuted }]}>ES-AR · TU AMIGO PORTEÑO</Text>
          </View>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          <Pressable onPress={() => setPronOpen(true)} style={[styles.practice, { borderColor: c.line }]}>
            <Text style={{ color: c.text, fontSize: 12, fontWeight: '600' }}>🎙 Práctica</Text>
          </Pressable>
          <View style={styles.moodPill}>
            <Text style={[styles.mono, { color: c.textMuted }]}>ÁNIMO</Text>
            <Text style={[styles.moodText, { color: c.text }]}>
              {moodBadge.emoji} {moodBadge.label}
            </Text>
          </View>
        </View>
      </View>

      <PronunciationModal visible={pronOpen} onClose={() => setPronOpen(false)} c={c} />
      <LearnedWordsModal
        visible={wordsOpen}
        onClose={() => setWordsOpen(false)}
        c={c}
        streak={streak}
      />
      <MemoryModal visible={memOpen} onClose={() => setMemOpen(false)} c={c} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
      >
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
            <View style={[styles.toggle, { borderColor: c.line }]}>
              <Pressable
                onPress={() => setLessonMode('chat')}
                style={[styles.tgBtn, { backgroundColor: lessonMode === 'chat' ? c.accent : 'transparent' }]}
              >
                <Text style={{ color: lessonMode === 'chat' ? c.accentText : c.text, fontSize: 12, fontWeight: '600' }}>
                  Болталка
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setLessonMode('lesson')}
                style={[styles.tgBtn, { backgroundColor: lessonMode === 'lesson' ? c.accent : 'transparent' }]}
              >
                <Text style={{ color: lessonMode === 'lesson' ? c.accentText : c.text, fontSize: 12, fontWeight: '600' }}>
                  Урок
                </Text>
              </Pressable>
            </View>
            <Pressable onPress={() => setWordsOpen(true)} style={[styles.iconBtn, { borderColor: c.line }]}>
              <Text style={{ fontSize: 15 }}>📖</Text>
            </Pressable>
            <Pressable onPress={() => setMemOpen(true)} style={[styles.iconBtn, { borderColor: c.line }]}>
              <Text style={{ fontSize: 15 }}>🧠</Text>
            </Pressable>
          </View>
        </View>
        <CityStrip c={c} />
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: space(2), gap: space(1.5) }}
          renderItem={({ item }) => <Bubble msg={item} c={c} />}
          ListFooterComponent={
            busy ? (
              <View style={styles.typing}>
                <ActivityIndicator color={c.textMuted} />
                <Text style={[styles.mono, { color: c.textMuted }]}>Pablito escribe…</Text>
              </View>
            ) : null
          }
        />

        {/* Ввод */}
        <View style={[styles.inputBar, { borderTopColor: c.line, backgroundColor: c.surface }]}>
          <Pressable
            onPress={onMic}
            disabled={!ready}
            style={[
              styles.mic,
              { borderColor: c.line, backgroundColor: recording ? c.accent : 'transparent' },
            ]}
          >
            <Text style={{ fontSize: 18, color: recording ? c.accentText : c.text }}>
              {recording ? '⏺' : '🎙'}
            </Text>
          </Pressable>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={recording ? 'Hablá… te escucho' : 'Escribí o hablá en español…'}
            placeholderTextColor={c.textMuted}
            style={[styles.input, { color: c.text, borderColor: c.line }]}
            multiline
            onSubmitEditing={onSend}
          />
          <Pressable
            onPress={onSend}
            disabled={!ready || busy || !text.trim()}
            style={[styles.send, { backgroundColor: c.accent, opacity: !text.trim() ? 0.4 : 1 }]}
          >
            <Text style={{ color: c.accentText, fontWeight: '700', fontSize: 16 }}>↑</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function Bubble({ msg, c }: { msg: UiMessage; c: typeof light }) {
  const isUser = msg.role === 'user';
  return (
    <View style={{ alignItems: isUser ? 'flex-end' : 'flex-start' }}>
      <Text style={[styles.mono, { color: c.textMuted, marginBottom: 4 }]}>
        {isUser ? 'VOS' : 'PABLITO'}
      </Text>
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
        <Text
          style={{
            color: isUser ? c.bubbleUserText : c.bubblePablitoText,
            fontSize: 16,
            lineHeight: 23,
          }}
        >
          {msg.text}
        </Text>
      </View>
    </View>
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
  mono: { fontFamily: 'monospace', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' },
  practice: {
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
  toggle: { flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, overflow: 'hidden' },
  tgBtn: { paddingVertical: 6, paddingHorizontal: 10 },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moodText: { fontSize: 14, fontWeight: '600' },
  bubble: {
    maxWidth: '86%',
    paddingVertical: space(1.25),
    paddingHorizontal: space(1.75),
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  typing: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: space(1) },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
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
    paddingTop: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 16,
  },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
