// Route protection. Next.js 16 renamed `middleware.ts` → `proxy.ts` (same behaviour,
// Node.js runtime by default). Unauthenticated visits to protected pages go to /login.

import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';

export async function proxy(request: NextRequest) {
  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/calendar'],
};
