# PabLito proxy (Cloudflare Worker)

Прячет ключ NavyAI на сервере. Приложение ходит на URL воркера, а ключ в APK не попадает.

## Развёртывание (5 минут, бесплатно)

```bash
cd proxy
npm i -g wrangler
wrangler login                       # откроется браузер, войди в Cloudflare
wrangler secret put NAVY_API_KEY     # вставь новый ключ sk-navy-...
# (необязательно) общий токен, чтобы воркером не пользовались чужие:
wrangler secret put CLIENT_TOKEN     # придумай любую строку
wrangler deploy
```

После `deploy` получишь адрес вида `https://pablito-proxy.<твой>.workers.dev`.

## Подключение приложения

В `.env` приложения замени базовый URL на воркер (обрати внимание — с `/v1`):

```
EXPO_PUBLIC_NAVY_BASE_URL=https://pablito-proxy.<твой>.workers.dev/v1
EXPO_PUBLIC_NAVY_API_KEY=not-needed   # ключ теперь на сервере, сюда можно любую заглушку
```

Если задал `CLIENT_TOKEN`, добавь в `.env`:

```
EXPO_PUBLIC_CLIENT_TOKEN=та-же-строка
```

и приложение будет слать её в заголовке `X-Client-Token` (уже поддержано в `src/api/navy.ts`).

## Как это работает

`worker.js` принимает `/v1/*`, подставляет `Authorization: Bearer <секрет>` и пересылает на `https://api.navy/v1/*`. Потоковые ответы (SSE) проходят насквозь, поэтому стриминг Паблито работает и через прокси.

> Примечание: если задан `CLIENT_TOKEN`, он всё же лежит в APK — но сам ключ NavyAI нет. Токен нужен лишь чтобы отсечь случайных прохожих; при утечке его легко сменить одной командой, не трогая ключ.
