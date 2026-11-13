# Todo App - Claude Code Instructions

## Current Repository State

All 11 PRP features are implemented (Next.js 16.4, React 19, Tailwind 4, better-sqlite3, SimpleWebAuthn 14). `PRPs/*.md`, `USER_GUIDE.md` and `EVALUATION.md` remain the specs. Where the implementation intentionally deviates from a PRP code sample, it is noted under **Implementation Notes** below.

## Architecture Overview

A **Next.js 16** todo application with WebAuthn authentication, using **better-sqlite3** for data persistence and **Playwright** for E2E testing. All operations use **Singapore timezone** (`Asia/Singapore`).

### Core Stack
- **Frontend**: Next.js App Router, React 19, Tailwind CSS 4
- **Backend**: Next.js API routes (no separate server)
- **Database**: SQLite via `better-sqlite3` (`todos.db` in project root)
- **Auth**: WebAuthn/Passkeys with JWT sessions (no passwords)
- **Testing**: Playwright E2E tests

## Critical Patterns

### 1. Authentication Flow (WebAuthn/Passkeys)
- **WebAuthn only** - no traditional passwords
- Uses `@simplewebauthn/server` and `@simplewebauthn/browser` libraries
- Session tokens stored as HTTP-only cookies via `lib/auth.ts` (JWT with 7-day expiry)
- `proxy.ts` protects `/` and `/calendar` routes (Next.js 16 renamed `middleware.ts` → `proxy.ts`; same behaviour)
- When modifying authenticator logic, **always use `?? 0` for counter field** to handle undefined values:
  ```typescript
  counter: authenticator.counter ?? 0
  ```

**WebAuthn Flow Pattern:**
1. Client calls `/api/auth/register-options` or `/api/auth/login-options` to get challenge
2. Client uses `@simplewebauthn/browser` to interact with authenticator
3. Client posts response to `/api/auth/register-verify` or `/api/auth/login-verify`
4. Server verifies response using `@simplewebauthn/server` and creates JWT session

**Buffer Encoding:** WebAuthn credentials require base64/base64url conversions. Use `isoBase64URL` from `@simplewebauthn/server/helpers` for credential_id handling.

### 2. Database Architecture
**Single source of truth**: `lib/db.ts` exports all database interfaces and CRUD operations (~700 lines).

**Technology:** `better-sqlite3` - synchronous SQLite library (no async/await needed for DB operations). Database file: `todos.db` in project root.

Key tables:
- `users` → `authenticators` (one-to-many)
- `users` → `todos` → `subtasks` (one-to-many with CASCADE delete)
- `todos` ↔ `tags` (many-to-many via `todo_tags`)
- `users` → `templates` (reusable todo patterns with JSON-serialized subtasks)
- `holidays` (Singapore public holidays, timezone-aware)

**When adding database features:**
- Add interface to `lib/db.ts` first
- Export DB object with CRUD methods (e.g., `todoDB`, `tagDB`)
- Use prepared statements for all queries (`db.prepare()`)
- Handle migrations with try-catch `ALTER TABLE` blocks in `db.exec()`
- **All DB operations are synchronous** - no promises/async needed for queries

### 3. Singapore Timezone (Mandatory)
All date/time operations **must** use `lib/timezone.ts`:
```typescript
import { getSingaporeNow, formatSingaporeDate } from '@/lib/timezone';
const now = getSingaporeNow(); // NOT new Date()
```
This applies to: due dates, reminders, recurring todos, holiday calculations.

### 4. API Route Patterns
All API routes follow this structure:
```typescript
export async function GET/POST/PUT/DELETE(request: NextRequest) {
  const session = await getSession(); // Always check auth first
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  // For routes with params:
  const { id } = await params; // params is a Promise in Next.js 16

  // Use session.userId for all DB queries
}
```

### 5. Feature-Rich Todo Model
Todos support: priority (high/medium/low), recurring patterns (daily/weekly/monthly/yearly), reminders (15m/30m/1h/2h/1d/2d/1w before), subtasks with progress tracking, and tags.

**When completing recurring todos**: Create next instance with same priority, tags, reminder offset, and recurrence pattern. See `app/api/todos/[id]/route.ts` PUT handler.

## Development Workflows

### Setup & Run
```bash
npm install
npm run dev           # Start dev server on :3000
npm run build         # Production build
npm run lint          # ESLint check
```

### Testing
```bash
npm run test:unit                      # Unit tests (node:test via tsx) — pure logic + DB layer on :memory:
npx playwright test                    # Run all E2E tests (builds, then serves on :3100 with todos.test.db)
npx playwright test --ui              # Interactive UI mode
npx playwright test tests/02-todo-crud.spec.ts  # Single test file
npx playwright show-report            # View HTML report
```

**Virtual WebAuthn Authenticators:**
- Tests use virtual authenticators (configured in `playwright.config.ts` with Chromium flags)
- Set `timezoneId: 'Asia/Singapore'` in Playwright config to match app timezone
- Test files organized by feature (`01-authentication`, `02-todo-crud`, etc.) matching `USER_GUIDE.md` order
- Helper class `tests/helpers.ts` provides reusable methods: `createTodo()`, `addSubtask()`, `createTag()`

### Database Management
```bash
# Seed Singapore holidays
npx tsx scripts/seed-holidays.ts

# Inspect database (SQLite CLI)
sqlite3 todos.db
```

## Project-Specific Conventions

### 1. Client vs Server Components
- Main pages (`app/page.tsx`, `app/calendar/page.tsx`) are `'use client'` - they manage state and fetch from API routes
- API routes handle all database operations server-side
- Never import `lib/db.ts` directly in client components

### 2. Error Handling in API Routes
Always use null coalescing for potentially undefined database fields:
```typescript
counter: authenticator.counter ?? 0
reminder_minutes: todo.reminder_minutes ?? null
```

### 3. Monolithic UI Pattern
Main todo page (`app/page.tsx`) is intentionally a large (~2200 lines) client component with all features:
- Single file handles: todos, subtasks, tags, templates, filtering, export/import
- State management via React hooks (no external state library)
- All API calls made directly from component using fetch
- Pattern chosen for simplicity over modularity - keep additions in this file unless creating new routes
- This overrides the general "many small files" preference in `.claude/rules/coding-style.md` — it is a deliberate project convention, not a violation to fix

### 4. Type Safety & Code Generation
Shared types live in `lib/db.ts` and are imported in both API routes and client components:
```typescript
import { Priority, RecurrencePattern, Todo, Template } from '@/lib/db';
```

## Key Integration Points

### Notification System
- Browser notifications use `lib/hooks/useNotifications.ts` hook
- Backend checks due reminders via `app/api/notifications/check/route.ts`
- Frontend polls this endpoint every 30 seconds and triggers browser notifications
- Respects `last_notification_sent` to prevent duplicates

### Template System
- Templates in `templates` table store todo patterns with JSON-serialized subtasks
- `POST /api/templates/[id]/use` creates todo from template, calculating due date from offset
- Subtasks JSON structure: `[{ title: string, position: number }]`
- When creating templates, serialize subtasks array to JSON string before storing

### Export/Import
- `GET /api/todos/export` returns JSON with todos, subtasks, and tags
- `POST /api/todos/import` accepts same format, remaps IDs, preserves relationships

## Common Pitfalls

1. **Don't use `new Date()` directly** - always use `getSingaporeNow()` from `lib/timezone.ts`
2. **params is async in Next.js 16** - use `const { id } = await params`
3. **Database fields can be null/undefined** - use `?? 0` or `|| null` when passing to functions
4. **Recurring todos need special handling** - see PUT `/api/todos/[id]` for completion logic
5. **WebAuthn credentials use base64/base64url encoding** - buffer conversions required

## File Reference

- **Auth**: `lib/auth.ts` (cookies), `lib/session.ts` (JWT, used by proxy too), `lib/webauthn.ts` (RP config + challenge store), `proxy.ts`, `app/api/auth/**`
- **Database**: `lib/db.ts` (single file); shared types/constants in `lib/types.ts` (re-exported by `db.ts`)
- **Timezone**: `lib/timezone.ts`
- **Pure logic**: `lib/recurrence.ts`, `lib/todoSort.ts`, `lib/filters.ts`, `lib/calendar.ts`, `lib/reminders.ts`, `lib/csv.ts`, `lib/validation.ts`, `lib/todoInput.ts`, `lib/templateInput.ts`, `lib/templateSubtasks.ts`
- **Main UI**: `app/page.tsx` (monolithic client component), `app/calendar/page.tsx`, `app/login/page.tsx`
- **API Routes**: `app/api/**/route.ts`
- **Holidays**: `lib/holidays-data.ts` (SG 2025–2027), `scripts/seed-holidays.ts`; auto-seeded on first DB open
- **Tests**: `tests/unit/*.test.ts`, `tests/*.spec.ts`, `tests/helpers.ts`

## Implementation Notes (deviations from PRP samples)

- **Client imports**: client components import runtime values from `@/lib/types`, never `@/lib/db` — importing `db.ts` would pull `better-sqlite3` into the browser bundle. `import type` from either is fine.
- **Lazy DB connection**: `lib/db.ts` opens SQLite on first query (`getDb()`), not at import. `next build` imports route modules from many parallel workers; opening at import caused `SQLITE_BUSY`. Prepared statements are compiled lazily too (`lazyStatements`).
- **Date storage**: due dates are ISO strings with an explicit `+08:00` offset (e.g. `2026-11-20T14:00:00+08:00`). `getSingaporeNow()` returns the current instant; all rendering goes through `formatSingaporeDate`/`toSingaporeISO`. `datetime-local` inputs are interpreted as Singapore wall-clock time via `singaporeInputToISO`.
- **`PUT /api/todos/[id]`** returns `{ todo, nextInstance? }` (PRP 03 shape) for every update.
- **SimpleWebAuthn v14** uses `credential: { id, publicKey, counter, transports }` — not the older `authenticator: { credentialID, ... }` shape in PRP 11.
- **Reminders**: reminders for todos more than 24h overdue are not fired (stale-reminder policy, `lib/reminders.ts`). `last_notification_sent` resets only when `due_date`/`reminder_minutes` actually change.
- **Templates**: recurring or reminder templates require a due-date offset (enforced at save time).
- **Challenge store** is in-process memory — fine for a single Node instance (Railway); move to the DB for multi-instance deploys.
- **SQLite on Vercel** does not persist; deploy to Railway (or swap the DB) for real use. Set `JWT_SECRET` in production (required) — see `.env.example`.

## Related Documentation

- **`PRPs/`** - Product Requirement Prompts, one per feature (schema, endpoints, UI, edge cases, acceptance criteria, tests). Read the relevant PRP before implementing or modifying a feature. Start at `PRPs/README.md`.
- **`USER_GUIDE.md`** - comprehensive user-facing feature documentation (2000+ lines)
- **`EVALUATION.md`** - feature completeness checklist, acceptance criteria, and deployment (Railway/Vercel) guidance
- **`.github/copilot-instructions.md`** - equivalent instructions written for GitHub Copilot; keep in sync with this file if either changes
