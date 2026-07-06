/**
 * Полоса из трёх городов на главном экране: местное время, погода, влажность
 * и индикатор «душно/жарко». Тап по карточке — обновить.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  CityWeather,
  comfort,
  fetchWeather,
  localTime,
  weatherIcon,
} from '@/api/weather';
import { light, space } from '@/theme/theme';

export default function CityStrip({ c }: { c: typeof light }) {
  const [data, setData] = useState<CityWeather[] | null>(null);
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setLoading(true);
    try {
      const w = await fetchWeather(ac.signal);
      setData(w);
    } catch {
      // оставляем прошлые данные, помечаем устаревшими
      setData((prev) => (prev ? prev.map((p) => ({ ...p, stale: true })) : prev));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const weatherTimer = setInterval(load, 15 * 60 * 1000); // погода — каждые 15 мин
    const clockTimer = setInterval(() => setNow(Date.now()), 20 * 1000); // время — каждые 20 c
    return () => {
      clearInterval(weatherTimer);
      clearInterval(clockTimer);
      abort.current?.abort();
    };
  }, [load]);

  return (
    <View style={[styles.strip, { borderBottomColor: c.line }]}>
      {(data ?? placeholders()).map((city, i) => {
        const cmf = comfort(city.tempC, city.feelsC, city.humidity);
        const ic = weatherIcon(city.code);
        return (
          <Pressable key={i} onPress={load} style={[styles.card, { borderColor: c.line }]}>
            <Text style={[styles.city, { color: c.textMuted }]} numberOfLines={1}>
              {city.name.toUpperCase()}
            </Text>
            <Text style={[styles.time, { color: c.text }]}>
              {data ? localTime(city.tzOffsetSec, now) : '—:—'}
            </Text>
            <Text style={[styles.temp, { color: c.text }]}>
              {ic.emoji} {data ? `${city.tempC}°` : '··'}
            </Text>
            <Text style={[styles.meta, { color: c.textMuted }]} numberOfLines={1}>
              ощущ. {data ? `${city.feelsC}°` : '··'} · {data ? `${city.humidity}%` : '··'}
            </Text>
            <View style={[styles.chip, { borderColor: c.line }]}>
              <Text style={[styles.chipText, { color: c.text }]} numberOfLines={1}>
                {cmf.emoji} {data ? cmf.label : '…'}
              </Text>
            </View>
            {city.stale ? <Text style={[styles.stale, { color: c.textMuted }]}>оффлайн</Text> : null}
          </Pressable>
        );
      })}
      {loading ? (
        <View style={styles.spinner} pointerEvents="none">
          <ActivityIndicator size="small" color={c.textMuted} />
        </View>
      ) : null}
    </View>
  );
}

function placeholders(): CityWeather[] {
  return [
    { name: 'Саратов', tzOffsetSec: 14400, tempC: 0, feelsC: 0, humidity: 0, code: 0, fetchedAt: 0 },
    { name: 'Буэнос-Айрес', tzOffsetSec: -10800, tempC: 0, feelsC: 0, humidity: 0, code: 0, fetchedAt: 0 },
    { name: 'Москва', tzOffsetSec: 10800, tempC: 0, feelsC: 0, humidity: 0, code: 0, fetchedAt: 0 },
  ];
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    gap: space(1),
    paddingHorizontal: space(2),
    paddingVertical: space(1.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  card: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingVertical: space(1.25),
    paddingHorizontal: space(1),
    gap: 3,
    alignItems: 'flex-start',
  },
  city: { fontFamily: 'monospace', fontSize: 9, letterSpacing: 0.5 },
  time: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  temp: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 10 },
  chip: {
    marginTop: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
    alignSelf: 'stretch',
  },
  chipText: { fontSize: 11, fontWeight: '600' },
  stale: { fontFamily: 'monospace', fontSize: 8, marginTop: 2 },
  spinner: { position: 'absolute', top: 6, right: 8 },
});
