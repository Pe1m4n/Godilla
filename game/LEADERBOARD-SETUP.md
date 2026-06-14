# Лидерборд (Supabase) — как подключить

Лидерборд уже работает локально (в браузере игрока). Чтобы он стал **общим**
для всех — нужно вписать два значения из Supabase. Ничего больше править не надо.

## 1. Создать таблицу

Открой проект на [supabase.com](https://supabase.com) → слева **SQL Editor** →
вставь этот кусок и нажми **Run**:

```sql
create table if not exists public.leaderboard (
  id          bigint generated always as identity primary key,
  name        text not null,
  kills       integer not null,
  created_at  timestamptz default now()
);

-- Новые publishable-ключи Supabase работают только через RLS, поэтому её надо
-- включить и явно разрешить всем читать и добавлять (это не защита от читов —
-- просто без правил доступ закрыт полностью):
alter table public.leaderboard enable row level security;

create policy "lb public read"
  on public.leaderboard for select
  to anon, authenticated using (true);

create policy "lb public insert"
  on public.leaderboard for insert
  to anon, authenticated with check (true);
```

> Правил на изменение/удаление нет — чужие записи переписать нельзя, но добавлять
> и читать могут все. Этого достаточно.

## 2. Скопировать два значения

**Settings → API** (или **Project Settings → Data API**):

- **Project URL** — вид `https://xxxxxxxx.supabase.co`
- **anon public** ключ — длинная строка, начинается с `eyJ...`

## 3. Вписать их в игру

Файл [src/game.js](src/game.js), блок «зал славы (лидерборд)»:

```js
const SUPA_URL = '';   // ← сюда Project URL
const SUPA_KEY = '';   // ← сюда anon public ключ
```

Всё. Пока строки пустые — лидерборд локальный. Как только вписаны —
становится общим. Отправка результата идёт по принципу «выстрелил и забыл»:
проверок нет, у кого не отправилось — тому не повезло.
