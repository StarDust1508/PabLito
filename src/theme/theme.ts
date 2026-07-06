/**
 * Тема в духе malvah.co — редакторский минимализм: спокойный «бумажный» фон,
 * почти чёрный текст, моноширинные микролейблы, много воздуха, один акцент.
 * Светлая и тёмная схемы.
 */
export interface Palette {
  bg: string;
  surface: string;
  text: string;
  textMuted: string;
  line: string;
  accent: string; // celeste — привет Аргентине
  accentText: string;
  bubbleUser: string;
  bubbleUserText: string;
  bubblePablito: string;
  bubblePablitoText: string;
}

export const light: Palette = {
  bg: '#EDEAE3',
  surface: '#F5F3EE',
  text: '#141210',
  textMuted: '#8A857C',
  line: '#DAD5CB',
  accent: '#3E6DDb',
  accentText: '#FFFFFF',
  bubbleUser: '#141210',
  bubbleUserText: '#F5F3EE',
  bubblePablito: '#FFFFFF',
  bubblePablitoText: '#141210',
};

export const dark: Palette = {
  bg: '#0E0D0C',
  surface: '#171514',
  text: '#F1EDE6',
  textMuted: '#7E7A72',
  line: '#26231F',
  accent: '#7FB2FF',
  accentText: '#0E0D0C',
  bubbleUser: '#F1EDE6',
  bubbleUserText: '#141210',
  bubblePablito: '#1D1A17',
  bubblePablitoText: '#F1EDE6',
};

export const typography = {
  mono: 'monospace', // микролейблы SI_01 / статусы
  display: 'System', // крупные заголовки
  body: 'System',
} as const;

export const space = (n: number) => n * 8;
