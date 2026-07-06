# Дизайн-док: подсистема ПАМЯТИ PabLito

Статус: черновик к обсуждению. Не меняет код — только план.
Смежные файлы (текущее состояние): `src/core/memory.ts`, `src/core/personality.ts`,
`src/hooks/usePablito.ts`, `src/core/mood.ts`, `src/config.ts`, `STRESS_TEST.md`.

## 0. Что уже есть и почему этого мало

Сейчас память — это 4 таблицы SQLite (`kv`, `facts`, `vocab`, `sessions`) и один канал
извлечения — блок `[[MEM]]{"facts":[...],"vocab":[...]}[[/MEM]]`, который модель обязана
дописывать в конец каждого ответа. Это рабочий MVP, но у него пять структурных проблем:

1. **Факты — плоский список строк.** Нет типа, важности, времени действия, статуса
   актуальности. "Меня зовут Хуан" и "мне нравится Ривер Плейт" неотличимы по весу и
   не могут вытеснять друг друга при конфликте (переезд, разрыв, смена работы).
2. **Дедупликация — точное совпадение строки** (`UNIQUE` в SQLite). "le gusta el fútbol"
   и "Le gusta el fútbol." — два разных факта.
3. **Транскрипт сессии живёт только в оперативной памяти** (`history.current` — обычный
   массив в замыкании хука). Убийство процесса ОС — и весь диалог потерян, кроме того,
   что модель успела вынести в `[[MEM]]`.
4. **SRS оторвана от живой речи.** `reviewVocab(word, right)` предполагает явную карточку
   "правильно/неправильно", но в разговорном интерфейсе такого события никто не шлёт —
   функция сейчас нигде не вызывается из `usePablito.ts`. Слово, использованное живьём
   пользователем без ошибок, никак не продвигает бокс.
5. **Нет извлечения "релевантного" — есть только "всё" (macimum 30 фактов + 5 старых).**
   При росте базы за месяцы это превратится в нерелевантный шум в промпте и рост токенов.

Ниже — полный пересмотр модели данных и алгоритмов, с DDL, псевдокодом и приоритетами.

---

## 1. Модель знаний: что помнить и как структурировать

### 1.1 Категории памяти

| Категория | Пример | Свойства, которых не хватает сейчас |
|---|---|---|
| **Личность** (identity) | имя, возраст, откуда, с кем живёт | закрепление (никогда не вытесняется по TTL), 1 активное значение |
| **Цели** (goals) | "переехать в Аргентину", "сдать DELE" | статус (active/done/abandoned), дата постановки |
| **Предпочтения** (preferences) | любимая команда, еда, музыка | могут быть множественными, не конфликтуют друг с другом |
| **Факты-состояния** (state facts) | адрес, работа, отношения | **версионируемые** — новое значение аннулирует старое, а не дублирует |
| **Эмоциональные моменты** (emotional beats) | "было тяжело после разговора о работе", "гордился, что сам заказал кофе" | привязаны к дате/сессии, влияют на mood и на "помню, как тебе было трудно" |
| **Обещания / договорённости** (commitments) | "в следующий раз расскажешь про поездку", "хотел выучить сослагательное" | нужен статус open/kept/broken и напоминание |
| **Паттерны ошибок** (error patterns) | путает ser/estar, забывает "vos" спряжение | счётчик повторов, а не факт-строка; это вход в педагогику, не в "что я о тебе знаю" |
| **Словарь** (vocab) | слова + перевод + SRS-статус | уже есть, требует расширения (см. §4) |

Ключевая мысль: **факты сейчас — это одна таблица-мешок**, а должно быть разделение на
минимум "тип + статус + вес", потому что у identity/goals нужна дедупликация-с-заменой
("живу в Москве" → "живу в Буэнос-Айресе" должно **аннулировать**, а не добавлять), а у
preferences и emotional beats — просто накопление с TTL/весом.

### 1.2 Улучшенная схема БД (DDL)

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Схема версионируется; текущее значение живёт в kv['schema_version']
-- миграции выполняются последовательно при открытии БД (см. §3.0).

-- ── kv: технический key-value, как сейчас (mood, last_seen, schema_version, device_key_id...)
CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ── facts: типизированные факты вместо плоских строк
CREATE TABLE IF NOT EXISTS facts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT NOT NULL CHECK (kind IN (
                  'identity','goal','preference','state','emotional','commitment','error_pattern'
                )),
  subject_key   TEXT NOT NULL,   -- нормализованный "слот": 'name','city','job','goal:main',
                                 -- 'likes:football_team' — единица конфликта/замены
  text          TEXT NOT NULL,   -- человекочитаемая форма для промпта ("живёт в Буэнос-Айресе")
  norm_text     TEXT NOT NULL,   -- нормализованная форма для дедупликации (lower, без диакритики/пунктуации)
  value_json    TEXT,            -- опциональная структурированная часть {"city":"Buenos Aires"}
  importance    INTEGER NOT NULL DEFAULT 2,  -- 0..3: 0=шум,1=обычный,2=важный,3=закреплён навсегда (имя, главная цель)
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','archived')),
  confidence    REAL NOT NULL DEFAULT 0.8,   -- 0..1, ниже для выводов эвристик/whisper-шума
  source        TEXT NOT NULL DEFAULT 'model_mem', -- 'model_mem'|'heuristic'|'user_edit'|'summary'
  session_id    INTEGER REFERENCES sessions(id),
  superseded_by INTEGER REFERENCES facts(id),  -- ссылка на факт, который его заменил
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  last_used_at  INTEGER           -- когда последний раз попал в промпт (для отладки/аналитики релевантности)
);
CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject_key, status);
CREATE INDEX IF NOT EXISTS idx_facts_kind ON facts(kind, status, importance DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_facts_norm_active
  ON facts(subject_key, norm_text) WHERE status = 'active';

-- ── commitments: обещания/договорённости — отдельная сущность, не факт
CREATE TABLE IF NOT EXISTS commitments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  text        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','kept','broken','cancelled')),
  due_hint    TEXT,              -- 'next_session' | 'YYYY-MM-DD' | NULL
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER
);

-- ── error_patterns: паттерны ошибок отдельно от фактов (педагогический сигнал, не "что я знаю о тебе")
CREATE TABLE IF NOT EXISTS error_patterns (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern_key  TEXT NOT NULL UNIQUE,   -- 'ser_estar','vos_conjugation','genero_sustantivos'
  description  TEXT NOT NULL,
  occurrences  INTEGER NOT NULL DEFAULT 1,
  last_seen_at INTEGER NOT NULL,
  resolved     INTEGER NOT NULL DEFAULT 0 -- 1 когда долго не повторяется — считаем закрытым
);

-- ── vocab: расширенная SRS (детали в §4)
CREATE TABLE IF NOT EXISTS vocab (
  word          TEXT PRIMARY KEY,
  translation   TEXT,
  box           INTEGER NOT NULL DEFAULT 1,
  ease          REAL NOT NULL DEFAULT 2.5,      -- множитель в духе SM-2, а не фикс. таблица интервалов
  due_at        INTEGER NOT NULL,
  seen          INTEGER NOT NULL DEFAULT 0,
  correct_streak INTEGER NOT NULL DEFAULT 0,
  lapses        INTEGER NOT NULL DEFAULT 0,      -- сколько раз "забывалось"
  last_result   TEXT,                            -- 'card_right'|'card_wrong'|'used_correctly'|'used_incorrectly'
  source        TEXT NOT NULL DEFAULT 'model_mem',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vocab_due ON vocab(due_at);

-- ── sessions: + связь с транскриптом и агрегатами
CREATE TABLE IF NOT EXISTS sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at   INTEGER NOT NULL,
  ended_at     INTEGER,
  turn_count   INTEGER NOT NULL DEFAULT 0,
  summary      TEXT,               -- краткое резюме на естественном языке (для промпта следующей сессии)
  mood_end     TEXT,               -- JSON Mood на конец сессии
  facts_count  INTEGER NOT NULL DEFAULT 0
);

-- ── messages: персистентный транскрипт (сейчас существует только in-memory)
CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES sessions(id),
  turn_index  INTEGER NOT NULL,      -- порядковый номер хода в сессии
  role        TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, turn_index);

-- ── rolling_summaries: свёртка внутри одной длинной сессии (см. §2.3)
CREATE TABLE IF NOT EXISTS rolling_summaries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   INTEGER NOT NULL REFERENCES sessions(id),
  upto_turn    INTEGER NOT NULL,     -- свёрнуто включительно до этого turn_index
  summary_text TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
```

**Почему `subject_key` + частичный уникальный индекс, а не просто `UNIQUE(text)`:**
это единственный практичный способ реализовать "новый факт аннулирует старый в той же
теме" на SQLite без внешнего движка. `subject_key='city'` гарантирует, что активна ровно
одна запись; при вставке новой — старая переводится в `status='superseded'`, а не
удаляется (история сохраняется для аудита/отладки и для "было — стало" в разговоре:
"а помнишь, ты говорил, что жил в Москве?").

---

## 2. Персистентность сессии

### 2.1 Сохранение транскрипта

Сейчас: `history.current` — массив `ChatMessage[]` в замыкании React-хука, не пишется в БД.
`finishSession` определена, но нигде не вызывается.

Изменение: каждый push в `history.current` дублируется записью в таблицу `messages`
(асинхронно, не блокируя UI-поток). Псевдокод:

```
function pushTurn(sessionId, turnIndex, role, content):
    history.current.push({ role, content })         // как сейчас, для промпта
    db.runAsync(
      'INSERT INTO messages (session_id, turn_index, role, content, created_at) VALUES (?,?,?,?,?)',
      [sessionId, turnIndex, role, content, now()]
    )  // fire-and-forget с логированием ошибки, UI не ждёт
```

### 2.2 Восстановление контекста при холодном старте

При запуске приложения, если есть незакрытая сессия (`ended_at IS NULL`) моложе, скажем,
30 минут — предлагаем "продолжить разговор", подгружая последние ~20 сообщений из `messages`
в `history.current` вместо приветствия с нуля. Если сессия старше порога или явно закрыта —
стартует новая сессия, а старая закрывается автоматически с генерацией summary (§2.3) по
уже имеющемуся транскрипту.

```
function resumeOrStart():
    open = db.getFirst("SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1")
    if open AND (now() - open.started_at < RESUME_WINDOW_MS):
        history.current = loadLastMessages(open.id, KEEP_TURNS)
        sessionId = open.id
        return { resumed: true }
    if open:
        closeSessionWithSummary(open.id)   // не бросаем хвост "вечно открытым"
    sessionId = startSession()
    return { resumed: false }
```

### 2.3 Свёртка длинных сессий (rolling summary)

Проблема из STRESS_TEST.md: окно в 20 ходов режет старый контекст без следа. Решение —
скользящая суммаризация: каждые N=20 ходов (когда очередной ход "падает" за окно) делаем
дешёвый вызов модели (`chat` на flash-модели, не той, что ведёт диалог) с запросом
"сожми эти 20 реплик в 2-3 предложения на русском: факты, эмоции, темы". Результат:
- пишется в `rolling_summaries`;
- последняя (или конкатенация последних 2-3) кладётся в системный промпт отдельным
  блоком "О ЧЁМ ГОВОРИЛИ РАНЬШЕ В ЭТОЙ СЕССИИ", **перед** окном последних 20 сырых ходов —
  так после 40-60 ходов разговора нить не обрывается, а сжимается ступенчато.

```
function maybeRollSummary(sessionId, allTurnsSoFar):
    lastRolled = db.getFirst(
      "SELECT MAX(upto_turn) as t FROM rolling_summaries WHERE session_id=?", [sessionId])
    nextBoundary = (lastRolled?.t ?? 0) + ROLL_EVERY   // ROLL_EVERY = 20
    if allTurnsSoFar.length < nextBoundary: return

    chunk = messagesBetween(lastRolled?.t ?? 0, nextBoundary)
    summary = await cheapSummarize(chunk)  // отдельный, дешёвый вызов модели
    db.run("INSERT INTO rolling_summaries (session_id, upto_turn, summary_text, created_at) VALUES (?,?,?,?)",
           [sessionId, nextBoundary, summary, now()])
```

При завершении сессии (`finishSession`) — итоговый summary на основе всех
`rolling_summaries` + хвоста, который в них не попал; он же кладётся в `sessions.summary`
и используется в **следующей** сессии как "О ЧЁМ ГОВОРИЛИ В ПРОШЛЫЙ РАЗ" (в дополнение к
`daysSinceLast`, который уже есть).

### 2.4 Когда считать сессию завершённой

`finishSession` нужно реально вызывать: на `AppState` переход в background/inactive (Expo
`AppState.addEventListener`) с debounce ~5 c, и при обнаружении "просроченной" открытой
сессии на следующем старте (см. 2.2). Без явного события выхода в мобильном приложении
"закрытие" — эвристика, а не гарантия, поэтому нужна и обработка "осиротевших" сессий.

---

## 3. Долгая память: дедупликация, приоритезация, устаревание, лимиты

### 3.0 Миграции схемы

Раз меняется DDL — нужен номер версии в `kv['schema_version']` и последовательные
`ALTER TABLE`/перезаливка при открытии БД, иначе апдейт приложения на существующей
установке уронит `CREATE TABLE IF NOT EXISTS` (она не добавляет колонки в старые таблицы).
Это must-have до выкладки новой схемы, не nice-to-have.

### 3.1 Дедупликация — нормализация + семантическая, не только точная строка

Два уровня:
1. **Синтаксический** (дёшево, локально): `norm_text = lowercase(strip_accents(trim(text)))`
   с схлопыванием пунктуации/пробелов — closes "le gusta el fútbol" vs "Le gusta el futbol.".
   Это и есть значение колонки `norm_text`, участвующее в уникальном индексе.
2. **Семантический** (для kind='state'/'identity' с одинаковым `subject_key`, но разным
   текстом — "живёт в Буэнос-Айресе" vs "переехал в BA"): здесь дедупликация — это не
   "совпадают ли строки", а "это одна и та же тема (`subject_key`), значит — заменить".
   `subject_key` **выставляет сама модель** через расширенный протокол `[[MEM]]` (см. §3.3),
   либо, как fallback, эвристика по ключевым словам ("живёт", "переехал", "работает",
   "зовут" → маппинг на 3-5 предопределённых слотов).

### 3.2 Приоритезация/закрепление важного

`importance=3` ("закреплено навсегда") присваивается автоматически слотам `subject_key IN
('name', 'goal:main')` — это решает проблему из STRESS_TEST ("ранние факты терялись")
структурно, а не патчем "плюс 5 старых фактов". Такие факты **всегда** попадают в выборку
для промпта вне зависимости от лимита и возраста.

### 3.3 Устаревание и конфликты (переезд, разрыв, смена работы)

Расширяем протокол `[[MEM]]`, чтобы модель сама размечала тип и слот, а не отдавала
неструктурированную строку:

```
[[MEM]]{
  "facts": [
    {"kind":"state","subject_key":"city","text":"переехал в Буэнос-Айрес","importance":2},
    {"kind":"identity","subject_key":"name","text":"зовут Хуан","importance":3}
  ],
  "vocab": [{"word":"laburo","translation":"работа","context":"used_correctly"}],
  "commitments": [{"text":"в следующий раз расскажет про поездку в Мендосу","due_hint":"next_session"}],
  "mood_signal": {"event":"GOOD_EFFORT"}
}[[/MEM]]
```
(обратная совместимость: старый формат `"facts": ["строка", ...]` продолжает
поддерживаться — при парсинге строка превращается в `{kind:'preference', subject_key:'misc:<hash>', text, importance:1}`).

Запись факта с непустым `subject_key`:
```
function upsertFact(f):
    norm = normalize(f.text)
    existingActive = db.getFirst(
      "SELECT * FROM facts WHERE subject_key=? AND status='active'", [f.subject_key])
    if existingActive AND existingActive.norm_text == norm:
        db.run("UPDATE facts SET last_used_at=? WHERE id=?", [now(), existingActive.id])
        return  // тот же факт повторно подтверждён моделью — просто трогаем дату
    if existingActive:
        db.run("UPDATE facts SET status='superseded' WHERE id=?", [existingActive.id])
        newId = insertFact(f, norm)
        db.run("UPDATE facts SET superseded_by=? WHERE id=?", [newId, existingActive.id])
    else:
        insertFact(f, norm)
```
Слоты без `subject_key` (общие предпочтения, emotional beats) просто накапливаются с
уникальностью по `norm_text` внутри `kind`, без замены.

### 3.4 Лимиты и извлечение релевантного в промпт

Вместо "последние 30 + первые 5" — многоуровневая выборка с бюджетом токенов:
```
function getFactsForPrompt(budgetChars = 1500):
    pinned   = SELECT * FROM facts WHERE importance=3 AND status='active'          -- всегда
    goals    = SELECT * FROM facts WHERE kind='goal' AND status='active' ORDER BY updated_at DESC LIMIT 3
    recentEmotional = SELECT * FROM facts WHERE kind='emotional' AND status='active'
                       ORDER BY created_at DESC LIMIT 3
    openCommitments = SELECT * FROM commitments WHERE status='open' ORDER BY created_at DESC LIMIT 3
    rest     = SELECT * FROM facts WHERE status='active' AND importance IN (1,2)
               AND id NOT IN (pinned+goals+recentEmotional ids)
               ORDER BY importance DESC, updated_at DESC
    result = pinned + goals + recentEmotional + openCommitments
    for f in rest:
        if charLen(result) + charLen(f) > budgetChars: break
        result.append(f)
    touchLastUsed(result)   // обновляем last_used_at для аналитики "что реально используется"
    return result
```
Это одновременно (а) чинит "рост БД → шум в промпте", (б) даёт естественное место для
"обещаний" в контексте, (в) ограничивает промпт по символам, а не по количеству строк
(важно — единичный длинный факт не должен раздувать токены непропорционально).

Рост БД: раз в N дней (или при превышении `archived`-порога, например 500 неактивных
записей) — задача очистки `status='superseded'/'archived'` старше 180 дней **если** они
не единственный источник данного `subject_key` (для аудита оставляем последние 1-2
поколения, не всю историю бесконечно).

---

## 4. SRS: интеграция с живым разговором

### 4.1 Проблема текущей реализации

`reviewVocab(word, right)` спроектирована под карточки ("показали слово — нажал
верно/неверно"), но в разговорном UI такого явного события нет — функция сейчас
**не вызывается** из `usePablito.ts`. `upsertVocab` при повторной вставке того же слова
не двигает бокс вообще (только обновляет перевод). То есть SRS сейчас **не работает** в
проде, кроме создания записей.

### 4.2 Источники сигнала в разговоре (без отдельного "режима карточек")

1. **Модель сама размечает употребление** — самый надёжный источник, раз модель и так
   генерирует `[[MEM]]`. Расширяем протокол: `vocab: [{"word":"...", "context":"used_correctly"}]`
   или `"used_incorrectly"`, когда слово из due-списка реально встретилось в реплике
   пользователя. `context` отсутствует = просто новое слово к изучению (как сейчас).
2. **Слово помечено "трудным"** — либо явно моделью (`"context":"marked_difficult"`, когда
   пользователь переспрашивает/путает слово несколько раз), либо эвристически: если слово
   уже виделось (`seen > 0`), но due-дата ещё не наступила, а модель заново его объясняет —
   это сигнал `lapse` даже без явной пометки.
3. **Явный мини-квиз** (опционально, продуктовая фича, не тех.долг) — раз в сессию
   Паблито может between-the-lines спросить "а как по-испански..." и разобрать ответ
   пользователя как classic-карточку `right/wrong`. Это даёт чистый сигнал, но нагружает
   разговор искусственностью — see решение владельца в конце документа.

### 4.3 Алгоритм: SM-2-подобный (ease factor) вместо фиксированной таблицы интервалов

Фиксированная `BOX_INTERVAL_DAYS` не различает "еле-еле вспомнил" и "щёлкнул мгновенно".
Переходим на модель с `ease` (как в Anki/SM-2), но упрощённую под 3 исхода вместо 5:

```
function applyReview(word, outcome):  // outcome: 'used_correctly' | 'used_incorrectly' | 'card_right' | 'card_wrong' | 'marked_difficult'
    row = getVocab(word)
    switch outcome:
        case 'used_correctly':
        case 'card_right':
            row.correct_streak += 1
            row.ease = min(row.ease + 0.05, 3.0)
            row.box = min(row.box + 1, MAX_BOX)
        case 'used_incorrectly':
        case 'card_wrong':
            row.lapses += 1
            row.correct_streak = 0
            row.ease = max(row.ease - 0.2, 1.3)
            row.box = 1  // назад в начало, как сейчас
        case 'marked_difficult':
            row.lapses += 1
            row.ease = max(row.ease - 0.1, 1.3)
            row.box = max(row.box - 1, 1)  // на бокс назад, не полный сброс —
                                            // "трудное" не значит "забытое"

    intervalDays = BASE_INTERVAL[row.box] * row.ease
    row.due_at = now() + intervalDays * DAY_MS
    row.last_result = outcome
    row.seen += 1
    saveVocab(row)
```

### 4.4 Забывание (forgetting) и «протухание» без активности

Если слово не встречалось (ни due-повтор, ни живое употребление) дольше, скажем,
`3 * текущий интервал`, при следующем due-просмотре оно **не** просто показывается —
ease дополнительно немного штрафуется (модель могла забыть за долгий перерыв сильнее, чем
если бы повторяла вовремя): `if (now() - lastTouched > 3*interval) ease -= 0.1` перед
применением обычной формулы. Это отдельная функция `applyForgettingPenalty`, вызываемая
при выборке `getDueVocab`, а не при `applyReview`.

### 4.5 Ежедневная норма

Сейчас `getDueVocab(limit=6)` — фиксированный лимит без понятия "нормы дня" и без
приоритезации *какие* 6 слов важнее. Улучшение:
```
function getDueVocab(limit = 6):
    overdue = SELECT * FROM vocab WHERE due_at <= now() ORDER BY due_at ASC   -- сначала самые просроченные
    new     = SELECT * FROM vocab WHERE seen = 0 ORDER BY created_at ASC LIMIT NEW_PER_DAY  -- дозируем новые слова
    return capMix(overdue, new, limit)  // например, не больше NEW_PER_DAY=3 новых слов в подборке,
                                         // остальное — просрочка, чтобы не заваливать новыми словами
                                         // в ущерб повторению старых (классическая ошибка SRS-приложений)
```
Плюс счётчик "выполнена ли норма дня" в `kv` (например `daily_review_done_date`), который
можно поверхностно показать в UI ("сегодня повторили 4 из 6") — не обязательно для памяти
как таковой, но напрашивается как побочный продукт этой схемы.

---

## 5. Крайние случаи и провалы

| # | Случай | Текущее поведение | Требуемое поведение |
|---|---|---|---|
| 1 | Битый JSON в `[[MEM]]` | `try/catch` молча проглатывает, факт теряется без следа | То же (не ронять чат), **но** логировать в `kv['mem_parse_errors']` (счётчик/последние 5 сырых блоков) для последующей диагностики промпта — иначе непонятно, как часто это происходит |
| 2 | Модель не закрыла блок `[[/MEM]]` (обрыв стрима) | Регэксп не матчит — блок целиком остаётся в `clean` и может утечь в чат/TTS | На финализации стрима (`chatStream` завершился, а не по кускам) — если найден `[[MEM]]` без закрывающего тега, обрезать всё с этой позиции и залогировать как parse error, не показывать пользователю |
| 3 | Гонка записи: `send()` вызван повторно быстро (двойной тап) или запись идёт из "resume" и из активного хода одновременно | `busy` в React-состоянии блокирует UI, но не защищает саму BD-запись от параллельных `runAsync` при разных путях кода | Все мутации памяти — через один "writer" с последовательной очередью (простая промис-цепочка `let writeQueue = Promise.resolve(); function enqueue(fn) { writeQueue = writeQueue.then(fn, fn); return writeQueue; }`), т.к. `expo-sqlite` не гарантирует безопасный interleaving при конкурентных `runAsync` на один файл |
| 4 | Рост БД без границ (messages копятся вечно) | Нет ограничения вообще | Ретеншн: хранить `messages` полностório последние N сессий (например 60 дней), дальше — только `sessions.summary` + `rolling_summaries`; агрегировать/удалять фоновой задачей при старте, если давно не чистили (`kv['last_vacuum_at']`) + `PRAGMA incremental_vacuum` |
| 5 | Приватность: факты и транскрипт лежат открытым текстом на устройстве | Явно описано как приемлемый риск в STRESS_TEST §7 | Слоями: (a) must — экран "Данные и приватность" с описанием, что и где хранится; (b) should — шифрование БД через SQLCipher-совместимый форк (`op-sqlite` с `SQLITE_HAS_CODEC`) или шифрование чувствительных полей (`text`, `content`) на уровне приложения (AES через `expo-crypto`/`react-native-quick-crypto`) с ключом в `expo-secure-store` (Keychain/Keystore) — план Б, если полноценный SQLCipher тяжело завести на Expo managed workflow |
| 6 | Экспорт/сброс памяти | Отсутствует | must: `exportMemory()` → JSON/SQL-дамп (facts+vocab+sessions summaries, без сырых сообщений по умолчанию — опция "включая полный транскрипт"); `resetMemory({ keepVocab?: boolean })` → удаление с подтверждением, отдельно от удаления приложения (важно для доверия — "я могу стереть, что Паблито обо мне знает") |
| 7 | Конфликт разбора словаря по `" - "` (уже отмечено в STRESS_TEST) | Разделитель `" - "` ломается, если в переводе есть тире | Сменить протокол на структурированный JSON-объект (см. §3.3 `vocab: [{"word":...,"translation":...}]`), полностью убирает проблему парсинга строки |
| 8 | Смена устройства / переустановка приложения | Память полностью теряется (SQLite — локальный файл) | nice: облачный бэкап (например, экспорт в iCloud/Google Drive через `expo-file-system` + `expo-sharing`, ручной "сохрани файл себе"), полноценная синхронизация — отдельная большая фича вне рамок этого дока |
| 9 | Часовой пояс / "путешествие" пользователя ломает `daysBetween` | Использует `Date.now()` разницу в мс — независимо от TZ, это безопасно, но резкий перевод часов устройства пользователем (вручную или при перелёте) может дать 0 или отрицательные "дни с последнего визita" | Клампить `daysBetween` снизу нулём (уже фактически так через `Math.floor`, но при отрицательном delta даст отрицательное число — нужен `Math.max(0, ...)` явно) |
| 10 | Модель "галлюцинирует" факт (например, придумывает несуществующее имя) | Некому проверить — что скажет модель, то и запишется | Confidence-поле уже в схеме (`confidence`); can add heuristic — факты с `kind='identity'` и низким confidence не помечать `importance=3` автоматически, требовать повторного подтверждения в 2 разных сессиях перед закреплением (`pending_confirmation` статус) — should-уровень, не критично для v1 |

---

## 6. Приоритезация улучшений

### Must (следующий спринт — без этого продакшн не product-ready)
1. Персистентный транскрипт (`messages` таблица) + восстановление после убийства процесса —
   закрывает самую громкую дыру из STRESS_TEST ("история сессии не переживает перезапуск").
2. Реальный вызов `finishSession` при уходе в фон/новом старте с "осиротевшей" сессией.
3. Структурированный протокол `[[MEM]]` (kind/subject_key/importance) вместо плоских строк —
   без этого дедупликация-с-заменой (переезд, смена работы) невозможна в принципе.
4. Замена разделителя словаря `" - "` на JSON-объект — дешёвая правка, устраняет реальный
   баг с парсингом.
5. Миграции схемы с версией в `kv` — иначе следующее обновление БД ломает апгрейд.
6. Последовательная очередь записи (write queue) — защита от гонок при повторных тапах/фоновых задачах.

### Should (важно, но не блокер запуска)
7. Rolling summary для сессий длиннее 20 ходов — чинит "забывание" внутри сессии.
8. SRS: переход на ease-factor модель + сигнал `used_correctly/used_incorrectly` из
   живого разговора вместо неиспользуемой `reviewVocab`.
9. Дозирование новых слов в `getDueVocab` (не более N новых в день).
10. Извлечение релевантных фактов по бюджету символов, а не фиксированному "30+5".
11. Ретеншн/очистка старых `messages` и `superseded` фактов — рост БД под контролем.
12. Экспорт/сброс памяти как явная функция в UI.

### Nice to have (можно отложить)
13. Шифрование БД (SQLCipher/аналог) — оправдано, если приложение выйдет за пределы
    "только для себя".
14. Явный мини-квиз для чистого SRS-сигнала.
15. Облачный бэкап/перенос между устройствами.
16. Confidence-based "pending confirmation" для identity-фактов перед постоянным закреплением.
17. Отдельный дешёвый вызов модели в конце сессии специально для извлечения памяти
    (вместо того чтобы просить основную модель делать это в каждом ответе) — снижает
    риск испортить протокол в реальном диалоговом ответе, но добавляет вызов и задержку.

---

## 7. Итоговая карта изменений по файлам (для будущей реализации, не выполнено сейчас)

- `src/core/memory.ts` — новые таблицы (`messages`, `commitments`, `error_patterns`,
  `rolling_summaries`), расширенная `facts`/`vocab`, миграции, write-queue, `getFactsForPrompt`,
  `applyReview`, `applyForgettingPenalty`, `exportMemory`/`resetMemory`.
- `src/core/personality.ts` — расширение `MEMORY_PROTOCOL` (структурированный JSON),
  обновление `extractMemory` под новый формат с обратной совместимостью, блок промпта
  "О ЧЁМ ГОВОРИЛИ РАНЬШЕ" из rolling summary.
- `src/hooks/usePablito.ts` — сохранение каждого хода в `messages`, вызов `finishSession`
  по `AppState`, логика resume при старте, вызов `maybeRollSummary` каждые N ходов, передача
  `context` при апдейте vocab вместо неиспользуемой `reviewVocab`.
- Новый экран/настройка (вне рамок кода памяти) — "Данные и приватность": экспорт, сброс,
  что хранится.
