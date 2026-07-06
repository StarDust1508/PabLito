/**
 * Практика произношения. Паблито даёт фразу — ты читаешь вслух — whisper слышит —
 * мы подсвечиваем слова и ставим счёт. Это «ухо» твоего носителя языка.
 */
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { light, space } from '@/theme/theme';
import { transcribe } from '@/api/navy';
import { requestMic, speak, startRecording, stopRecording } from '@/core/voice';
import {
  PHRASE_BANK,
  PronResult,
  feedback,
  scorePronunciation,
  type Phrase,
} from '@/core/pronunciation';

type Level = 'facil' | 'medio' | 'dificil';
const LEVELS: { key: Level; title: string }[] = [
  { key: 'facil', title: 'Лёгкие' },
  { key: 'medio', title: 'Средние' },
  { key: 'dificil', title: 'Сложные' },
];

export default function PronunciationModal({
  visible,
  onClose,
  c,
}: {
  visible: boolean;
  onClose: () => void;
  c: typeof light;
}) {
  const [level, setLevel] = useState<Level>('facil');
  const [idx, setIdx] = useState(0);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PronResult | null>(null);

  const phrases = PHRASE_BANK[level];
  const phrase: Phrase = useMemo(() => phrases[idx % phrases.length], [phrases, idx]);

  const nextPhrase = () => {
    setResult(null);
    setIdx((v) => v + 1);
  };
  const changeLevel = (l: Level) => {
    setLevel(l);
    setIdx(0);
    setResult(null);
  };

  const onMic = async () => {
    if (recording) {
      setRecording(false);
      setBusy(true);
      const uri = await stopRecording();
      try {
        if (uri) {
          const heard = await transcribe(uri, 'es');
          const res = scorePronunciation(phrase.es, heard);
          setResult(res);
          speak(feedback(res.score));
        }
      } catch {
        /* игнорируем сбой распознавания */
      } finally {
        setBusy(false);
      }
    } else {
      const ok = await requestMic();
      if (!ok) return;
      setResult(null);
      await startRecording();
      setRecording(true);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: c.bg }]}>
        <View style={[styles.header, { borderBottomColor: c.line }]}>
          <Text style={[styles.title, { color: c.text }]}>
            Pronunciación<Text style={{ color: c.accent }}>_</Text>
          </Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={{ color: c.textMuted, fontSize: 22 }}>✕</Text>
          </Pressable>
        </View>

        {/* Уровни */}
        <View style={styles.levels}>
          {LEVELS.map((l) => {
            const active = l.key === level;
            return (
              <Pressable
                key={l.key}
                onPress={() => changeLevel(l.key)}
                style={[
                  styles.levelBtn,
                  { borderColor: c.line, backgroundColor: active ? c.accent : 'transparent' },
                ]}
              >
                <Text style={{ color: active ? c.accentText : c.text, fontSize: 13, fontWeight: '600' }}>
                  {l.title}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <ScrollView contentContainerStyle={{ padding: space(2.5), gap: space(2) }}>
          {/* Задание */}
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.line }]}>
            <Text style={[styles.mono, { color: c.textMuted }]}>ПРОЧИТАЙ ВСЛУХ</Text>
            <Text style={[styles.phrase, { color: c.text }]}>{phrase.es}</Text>
            <Text style={[styles.translation, { color: c.textMuted }]}>{phrase.ru}</Text>
            <Pressable onPress={() => speak(phrase.es)} style={styles.listen}>
              <Text style={{ color: c.accent, fontWeight: '600' }}>🔊 Послушать</Text>
            </Pressable>
          </View>

          {/* Результат */}
          {busy ? (
            <View style={styles.center}>
              <ActivityIndicator color={c.textMuted} />
              <Text style={[styles.mono, { color: c.textMuted }]}>Слушаю…</Text>
            </View>
          ) : result ? (
            <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.line }]}>
              <Text style={[styles.score, { color: c.text }]}>{result.score}%</Text>
              <View style={styles.marks}>
                {result.marks.map((mk, i) => (
                  <Text
                    key={i}
                    style={[
                      styles.mark,
                      { color: mk.status === 'ok' ? '#2E9E5B' : mk.status === 'partial' ? '#C98A00' : '#D14343' },
                    ]}
                  >
                    {mk.w}
                  </Text>
                ))}
              </View>
              <Text style={[styles.mono, { color: c.textMuted, marginTop: space(1) }]}>
                УСЛЫШАЛ: {result.heard || '—'}
              </Text>
              <Text style={[styles.fb, { color: c.text }]}>{feedback(result.score)}</Text>
              {result.tips.length ? (
                <View style={{ marginTop: space(1.5), gap: 6 }}>
                  {result.tips.map((tip, i) => (
                    <Text key={i} style={{ color: c.textMuted, fontSize: 13, lineHeight: 18 }}>
                      💡 {tip}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
        </ScrollView>

        {/* Управление */}
        <View style={[styles.controls, { borderTopColor: c.line, backgroundColor: c.surface }]}>
          <Pressable onPress={nextPhrase} style={[styles.secondary, { borderColor: c.line }]}>
            <Text style={{ color: c.text, fontWeight: '600' }}>Другая фраза</Text>
          </Pressable>
          <Pressable
            onPress={onMic}
            disabled={busy}
            style={[styles.recBtn, { backgroundColor: recording ? '#D14343' : c.accent }]}
          >
            <Text style={{ color: c.accentText, fontWeight: '700', fontSize: 15 }}>
              {recording ? '⏹ Стоп' : '🎙 Читать'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingTop: space(7),
    paddingBottom: space(2),
    paddingHorizontal: space(2.5),
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  mono: { fontFamily: 'monospace', fontSize: 10, letterSpacing: 1 },
  levels: { flexDirection: 'row', gap: space(1), paddingHorizontal: space(2.5), paddingTop: space(2) },
  levelBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: space(2.5), gap: 8 },
  phrase: { fontSize: 24, fontWeight: '700', lineHeight: 32 },
  translation: { fontSize: 14 },
  listen: { marginTop: space(1) },
  center: { alignItems: 'center', gap: 8, paddingVertical: space(3) },
  score: { fontSize: 44, fontWeight: '900', letterSpacing: -1 },
  marks: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  mark: {
    fontSize: 18,
    fontWeight: '700',
    borderBottomWidth: 2,
    paddingBottom: 1,
  },
  fb: { fontSize: 16, marginTop: space(1.5), fontWeight: '500' },
  controls: {
    flexDirection: 'row',
    gap: space(1.5),
    paddingHorizontal: space(2.5),
    paddingTop: space(1.5),
    paddingBottom: space(4),
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  secondary: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recBtn: { flex: 1.4, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
