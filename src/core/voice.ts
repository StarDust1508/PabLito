/**
 * Голос: запись с микрофона (для whisper STT) и озвучка ответов Паблито.
 * Озвучка сначала пробует TTS от NavyAI, а если недоступно — откатывается
 * на системный синтез expo-speech с испанским (Аргентина) голосом.
 */
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Speech from 'expo-speech';
import { synthesize } from '@/api/navy';

let recording: Audio.Recording | null = null;
let _muted = false;

/** Глобальный мьют озвучки (настройка «звук вкл/выкл» из шторки). */
export function setSpeechMuted(m: boolean): void {
  _muted = m;
  if (m) stopSpeaking();
}
export function isSpeechMuted(): boolean {
  return _muted;
}

export async function requestMic(): Promise<boolean> {
  const { granted } = await Audio.requestPermissionsAsync();
  return granted;
}

export async function startRecording(): Promise<void> {
  // Только одна запись одновременно (иначе expo-av кидает «Only one Recording…»).
  if (recording) {
    try {
      await recording.stopAndUnloadAsync();
    } catch {
      /* уже остановлена */
    }
    recording = null;
  }
  await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
  const rec = new Audio.Recording();
  await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
  await rec.startAsync();
  recording = rec;
}

/** Останавливает запись и возвращает file:// URI аудио. */
export async function stopRecording(): Promise<string | null> {
  if (!recording) return null;
  await recording.stopAndUnloadAsync();
  const uri = recording.getURI();
  recording = null;
  return uri;
}

/** Озвучить текст. Argentina-first голос. */
export async function speak(text: string): Promise<void> {
  if (_muted) return;
  try {
    const buf = await synthesize(text, 'onyx');
    const path = `${FileSystem.cacheDirectory}pablito-${Date.now()}.mp3`;
    const base64 = arrayBufferToBase64(buf);
    await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
    const { sound } = await Audio.Sound.createAsync({ uri: path }, { shouldPlay: true });
    sound.setOnPlaybackStatusUpdate((s) => {
      if ('didJustFinish' in s && s.didJustFinish) sound.unloadAsync();
    });
  } catch {
    // Откат на системный синтез — аргентинский испанский.
    Speech.speak(text, { language: 'es-AR', rate: 1.0, pitch: 1.05 });
  }
}

export function stopSpeaking(): void {
  Speech.stop();
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + chunk)));
  }
  // btoa есть в Hermes/RN через глобальный полифилл; на всякий случай — ручной.
  return typeof btoa !== 'undefined' ? btoa(binary) : nodeB64(binary);
}

function nodeB64(s: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  let i = 0;
  while (i < s.length) {
    const a = s.charCodeAt(i++);
    const b = i < s.length ? s.charCodeAt(i++) : NaN;
    const c = i < s.length ? s.charCodeAt(i++) : NaN;
    const e1 = a >> 2;
    const e2 = ((a & 3) << 4) | (b >> 4);
    const e3 = isNaN(b) ? 64 : (((b & 15) << 2) | (c >> 6));
    const e4 = isNaN(c) ? 64 : c & 63;
    out += chars[e1] + chars[e2] + (e3 === 64 ? '=' : chars[e3]) + (e4 === 64 ? '=' : chars[e4]);
  }
  return out;
}
