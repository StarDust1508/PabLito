/**
 * «Что Паблито обо мне знает» — прозрачная и редактируемая память.
 * Можно поправить или удалить любой факт, либо стереть всё, что он о тебе знает.
 */
import { useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Modal } from 'react-native';
import { light, space } from '@/theme/theme';
import * as mem from '@/core/memory';
import type { FactKind } from '@/core/memory-logic';

const KIND_LABEL: Record<FactKind, string> = {
  identity: 'Личность',
  goal: 'Цели',
  state: 'Факты',
  preference: 'Предпочтения',
  emotional: 'Моменты',
  commitment: 'Обещания',
  error_pattern: 'Ошибки',
};
const KIND_ORDER: FactKind[] = ['identity', 'goal', 'state', 'preference', 'emotional', 'commitment', 'error_pattern'];

export default function MemoryModal({
  visible,
  onClose,
  c,
}: {
  visible: boolean;
  onClose: () => void;
  c: typeof light;
}) {
  const [facts, setFacts] = useState<mem.ActiveFact[]>([]);
  const [moments, setMoments] = useState<mem.Moment[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');

  const load = async () => {
    setFacts(await mem.getActiveFacts());
    setMoments(await mem.getAllMoments());
  };

  useEffect(() => {
    if (visible) load();
  }, [visible]);

  const startEdit = (f: mem.ActiveFact) => {
    setEditingId(f.id);
    setEditText(f.text);
  };
  const saveEdit = async () => {
    if (editingId != null && editText.trim()) {
      await mem.updateFact(editingId, editText.trim());
    }
    setEditingId(null);
    setEditText('');
    await load();
  };
  const remove = (f: mem.ActiveFact) =>
    Alert.alert('Удалить факт?', f.text, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: async () => {
          await mem.deleteFact(f.id);
          await load();
        },
      },
    ]);
  const clearAll = () =>
    Alert.alert('Стереть всё?', 'Паблито забудет всё, что знает о тебе (словарь и прогресс останутся).', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Стереть',
        style: 'destructive',
        onPress: async () => {
          await mem.clearKnowledge();
          await load();
        },
      },
    ]);

  // Группировка по категориям для секций.
  const ordered = [...facts].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.importance - a.importance
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: c.bg }]}>
        <View style={[styles.header, { borderBottomColor: c.line }]}>
          <View>
            <Text style={[styles.title, { color: c.text }]}>
              Обо мне<Text style={{ color: c.accent }}>_</Text>
            </Text>
            <Text style={[styles.mono, { color: c.textMuted }]}>ЧТО ПАБЛИТО ЗАПОМНИЛ · {facts.length}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={{ color: c.textMuted, fontSize: 22 }}>✕</Text>
          </Pressable>
        </View>

        <FlatList
          data={ordered}
          keyExtractor={(f) => String(f.id)}
          contentContainerStyle={{ padding: space(2), gap: space(1) }}
          ListHeaderComponent={
            moments.length ? (
              <View style={{ gap: space(1), marginBottom: space(1.5) }}>
                <Text style={[styles.mono, { color: c.textMuted }]}>НАШИ МОМЕНТЫ</Text>
                {moments.map((mm) => (
                  <View key={mm.id} style={[styles.row, { borderColor: c.line }]}>
                    <Text style={{ fontSize: 15 }}>💛</Text>
                    <Text style={{ color: c.text, fontSize: 14, flex: 1 }}>{mm.summary}</Text>
                  </View>
                ))}
              </View>
            ) : null
          }
          renderItem={({ item, index }) => {
            const showHead = index === 0 || ordered[index - 1].kind !== item.kind;
            const editing = editingId === item.id;
            return (
              <View style={{ gap: space(1) }}>
                {showHead ? (
                  <Text style={[styles.mono, { color: c.textMuted, marginTop: space(1) }]}>
                    {KIND_LABEL[item.kind].toUpperCase()}
                  </Text>
                ) : null}
                <View style={[styles.row, { borderColor: c.line }]}>
                  {editing ? (
                    <>
                      <TextInput
                        value={editText}
                        onChangeText={setEditText}
                        style={[styles.input, { color: c.text, borderColor: c.line }]}
                        multiline
                        autoFocus
                      />
                      <Pressable onPress={saveEdit} hitSlop={8}>
                        <Text style={{ color: c.accent, fontWeight: '700' }}>✓</Text>
                      </Pressable>
                    </>
                  ) : (
                    <>
                      <Text style={{ color: c.text, fontSize: 15, flex: 1 }}>
                        {item.importance >= 3 ? '📌 ' : ''}
                        {item.text}
                      </Text>
                      <Pressable onPress={() => startEdit(item)} hitSlop={8}>
                        <Text style={{ color: c.textMuted, fontSize: 16 }}>✎</Text>
                      </Pressable>
                      <Pressable onPress={() => remove(item)} hitSlop={8}>
                        <Text style={{ color: c.textMuted, fontSize: 16 }}>✕</Text>
                      </Pressable>
                    </>
                  )}
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <Text style={{ color: c.textMuted, textAlign: 'center', marginTop: space(5) }}>
              Пока Паблито ничего о тебе не запомнил. Поболтайте — и здесь появятся факты.
            </Text>
          }
          ListFooterComponent={
            facts.length ? (
              <Pressable onPress={clearAll} style={[styles.clear, { borderColor: c.line }]}>
                <Text style={{ color: '#D14343', fontWeight: '600' }}>Стереть всё, что он знает</Text>
              </Pressable>
            ) : null
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1.25),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: space(1.25),
    paddingHorizontal: space(1.75),
  },
  input: { flex: 1, fontSize: 15, borderWidth: 1, borderRadius: 8, padding: 8, minHeight: 40 },
  clear: {
    marginTop: space(3),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: space(1.5),
    alignItems: 'center',
  },
});
