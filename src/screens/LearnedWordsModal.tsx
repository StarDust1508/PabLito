/**
 * Экран прогресса: выученные слова (из SRS) + вехи на пути к Аргентине.
 */
import { useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { light, space } from '@/theme/theme';
import * as mem from '@/core/memory';
import { Milestone, milestones } from '@/core/progress';

export default function LearnedWordsModal({
  visible,
  onClose,
  c,
  streak,
}: {
  visible: boolean;
  onClose: () => void;
  c: typeof light;
  streak: number;
}) {
  const [words, setWords] = useState<mem.LearnedWord[]>([]);
  const [learned, setLearned] = useState(0);

  useEffect(() => {
    if (!visible) return;
    (async () => {
      setWords(await mem.getLearnedWords());
      setLearned(await mem.learnedCount());
    })();
  }, [visible]);

  const mstones: Milestone[] = milestones({ learnedWords: learned, streak, spanishOnlyTurn: false });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: c.bg }]}>
        <View style={[styles.header, { borderBottomColor: c.line }]}>
          <View>
            <Text style={[styles.title, { color: c.text }]}>
              Mi progreso<Text style={{ color: c.accent }}>_</Text>
            </Text>
            <Text style={[styles.mono, { color: c.textMuted }]}>
              {words.length} СЛОВ · 🔥 {streak} ДН.
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={{ color: c.textMuted, fontSize: 22 }}>✕</Text>
          </Pressable>
        </View>

        <FlatList
          data={words}
          keyExtractor={(w) => w.word}
          contentContainerStyle={{ padding: space(2.5), gap: space(1) }}
          ListHeaderComponent={
            <View style={{ gap: space(1), marginBottom: space(1.5) }}>
              <Text style={[styles.mono, { color: c.textMuted }]}>ВЕХИ</Text>
              {mstones.map((ms) => (
                <View key={ms.key} style={styles.mstone}>
                  <Text style={{ fontSize: 16 }}>{ms.reached ? '✅' : '⬜'}</Text>
                  <Text style={{ color: ms.reached ? c.text : c.textMuted, fontSize: 15 }}>{ms.label}</Text>
                </View>
              ))}
              <Text style={[styles.mono, { color: c.textMuted, marginTop: space(1.5) }]}>СЛОВАРЬ</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.row, { borderColor: c.line }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>{item.word}</Text>
                {item.translation ? (
                  <Text style={{ color: c.textMuted, fontSize: 13 }}>{item.translation}</Text>
                ) : null}
              </View>
              <Text style={{ color: c.accent, letterSpacing: 2 }}>
                {'●'.repeat(item.box)}
                <Text style={{ color: c.line }}>{'●'.repeat(Math.max(0, 5 - item.box))}</Text>
              </Text>
            </View>
          )}
          ListEmptyComponent={
            <Text style={{ color: c.textMuted, textAlign: 'center', marginTop: space(4) }}>
              Пока пусто. Поболтай с Паблито — слова появятся сами.
            </Text>
          }
        />
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
  mono: { fontFamily: 'monospace', fontSize: 10, letterSpacing: 1, marginTop: 2 },
  mstone: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: space(1.25),
    paddingHorizontal: space(1.75),
  },
});
