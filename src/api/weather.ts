/**
 * Погода и местное время для трёх городов через Open-Meteo (без ключа).
 * Возвращает температуру, «ощущается как», влажность, код погоды и часовой пояс.
 */
export interface CityWeather {
  name: string;
  tzOffsetSec: number; // сдвиг от UTC — для местного времени
  tempC: number;
  feelsC: number;
  humidity: number;
  code: number;
  fetchedAt: number;
  stale?: boolean; // true, если данные не удалось обновить
}

export const CITIES = [
  { name: 'Саратов', lat: 51.5333, lon: 46.0333, fallbackTz: 4 * 3600 },
  { name: 'Буэнос-Айрес', lat: -34.6037, lon: -58.3816, fallbackTz: -3 * 3600 },
  { name: 'Москва', lat: 55.7558, lon: 37.6173, fallbackTz: 3 * 3600 },
] as const;

export async function fetchWeather(signal?: AbortSignal): Promise<CityWeather[]> {
  const lat = CITIES.map((c) => c.lat).join(',');
  const lon = CITIES.map((c) => c.lon).join(',');
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code&timezone=auto`;

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const data = await res.json();
  const arr = Array.isArray(data) ? data : [data]; // при нескольких точках возвращается массив

  return CITIES.map((city, i) => {
    const d = arr[i] ?? {};
    const cur = d.current ?? {};
    return {
      name: city.name,
      tzOffsetSec: typeof d.utc_offset_seconds === 'number' ? d.utc_offset_seconds : city.fallbackTz,
      tempC: Math.round(cur.temperature_2m ?? 0),
      feelsC: Math.round(cur.apparent_temperature ?? cur.temperature_2m ?? 0),
      humidity: Math.round(cur.relative_humidity_2m ?? 0),
      code: cur.weather_code ?? 0,
      fetchedAt: Date.now(),
    };
  });
}

/** Местное время HH:MM из сдвига пояса. */
export function localTime(tzOffsetSec: number, now = Date.now()): string {
  const t = new Date(now + tzOffsetSec * 1000);
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** «Душно/жарко» — комбинируем ощущаемую температуру и влажность. */
export function comfort(tempC: number, feelsC: number, humidity: number): { label: string; emoji: string } {
  if (feelsC >= 32 && humidity >= 55) return { label: 'Душно и жарко', emoji: '🥵' };
  if (feelsC >= 30) return { label: 'Жарко', emoji: '☀️' };
  if (humidity >= 80 && tempC >= 18) return { label: 'Влажно, душно', emoji: '💧' };
  if (tempC <= -5) return { label: 'Мороз', emoji: '❄️' };
  if (tempC <= 8) return { label: 'Прохладно', emoji: '🧥' };
  return { label: 'Комфортно', emoji: '🙂' };
}

/** Код погоды WMO → emoji + короткое слово. */
export function weatherIcon(code: number): { emoji: string; text: string } {
  if (code === 0) return { emoji: '☀️', text: 'Ясно' };
  if (code <= 3) return { emoji: '⛅', text: 'Облачно' };
  if (code <= 48) return { emoji: '🌫️', text: 'Туман' };
  if (code <= 67) return { emoji: '🌧️', text: 'Дождь' };
  if (code <= 77) return { emoji: '🌨️', text: 'Снег' };
  if (code <= 82) return { emoji: '🌦️', text: 'Ливень' };
  if (code <= 86) return { emoji: '🌨️', text: 'Снег' };
  return { emoji: '⛈️', text: 'Гроза' };
}
