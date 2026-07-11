/**
 * §7 (курированная версия): «дышащий» логотип PabLito.
 * Каждая буква волной меняет облик — СЕМЕЙСТВО (Fraunces/Grotesk/Mono) + цвет + наклон
 * + baseline. Наклон/сдвиг анимируются плавно (reanimated), семейство/цвет — дискретно
 * (RN не морфит fontWeight/variable-оси плавно, поэтому надёжнее так). Гласные ≠ согласные.
 * Тап — заморозить/оживить. Reduce Motion — статичный красивый кадр.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { type Palette } from '@/theme/theme';

type ColorKey = 'text' | 'accent' | 'textMuted';
interface Variant {
  family: string;
  color: ColorKey;
  size: number;
  rot: number;
  ty: number;
}

// Гласные — элегантный serif/наклон; согласные — гротеск/моно, прямее. Ритм читается.
// §10 (TZ-04): амплитуда приглушена — лёгкое «дыхание», без дёрганья.
const VOWELS: Variant[] = [
  { family: 'Fraunces', color: 'text', size: 29, rot: -2, ty: 1 },
  { family: 'Fraunces', color: 'accent', size: 28, rot: 1, ty: -1 },
  { family: 'SpaceGrotesk', color: 'text', size: 29, rot: 0, ty: 0 },
  { family: 'SpaceMono', color: 'textMuted', size: 27, rot: 2, ty: 1 },
  { family: 'Fraunces', color: 'text', size: 30, rot: -1, ty: -1 },
];
const CONS: Variant[] = [
  { family: 'SpaceGrotesk', color: 'text', size: 29, rot: 0, ty: 0 },
  { family: 'SpaceMono-Bold', color: 'text', size: 28, rot: 1, ty: -1 },
  { family: 'SpaceGrotesk', color: 'accent', size: 29, rot: -1, ty: 1 },
  { family: 'Fraunces', color: 'text', size: 29, rot: 0, ty: -1 },
  { family: 'SpaceMono', color: 'textMuted', size: 28, rot: 1, ty: 1 },
];
const VOWEL_SET = new Set(['a', 'e', 'i', 'o', 'u']);

const resolveColor = (v: Variant, c: Palette): string =>
  v.color === 'accent' ? c.accent : v.color === 'textMuted' ? c.textMuted : c.text;

function Letter({
  ch,
  pool,
  phase,
  tick,
  c,
  animate,
}: {
  ch: string;
  pool: Variant[];
  phase: number;
  tick: number;
  c: Palette;
  animate: boolean;
}) {
  const i = (((tick + phase) % pool.length) + pool.length) % pool.length;
  const v = pool[i];
  const rot = useSharedValue(v.rot);
  const ty = useSharedValue(v.ty);
  useEffect(() => {
    const d = animate ? 600 : 0;
    rot.value = withTiming(v.rot, { duration: d });
    ty.value = withTiming(v.ty, { duration: d });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, animate]);
  const anim = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }, { translateY: ty.value }] }));
  return (
    <Animated.Text
      style={[{ fontFamily: v.family, color: resolveColor(v, c), fontSize: v.size, includeFontPadding: false }, anim]}
    >
      {ch}
    </Animated.Text>
  );
}

export default function KineticWordmark({ c, text = 'PabLito' }: { c: Palette; text?: string }) {
  const [tick, setTick] = useState(0);
  const [frozen, setFrozen] = useState(false);
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduce).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (frozen || reduce) return;
    const id = setInterval(() => setTick((t) => t + 1), 900);
    return () => clearInterval(id);
  }, [frozen, reduce]);

  return (
    <Pressable onPress={() => setFrozen((f) => !f)} accessibilityLabel="PabLito">
      <View style={styles.row}>
        {text.split('').map((ch, idx) => (
          <Letter
            key={idx}
            ch={ch}
            pool={VOWEL_SET.has(ch.toLowerCase()) ? VOWELS : CONS}
            phase={idx}
            tick={reduce ? 0 : tick}
            c={c}
            animate={!reduce}
          />
        ))}
        <Animated.Text style={{ color: c.accent, fontSize: 30, fontFamily: 'SpaceGrotesk' }}>_</Animated.Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', height: 40 },
});
