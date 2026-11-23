import { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { adminAuth } from '../lib/firebase-admin.ts';
import { verifySessionToken } from '../lib/security.ts';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';
import type { AuthUser } from '../shared/campus.ts';

export interface AuthRequest extends Request {
  authUser?: AuthUser;
}

export const INITIAL_ADMIN_EMAIL =
  process.env.ADMIN_EMAIL?.trim().toLowerCase() || 'divyagopigari425@gmail.com';

export function mapDbUserToAuthUser(row: typeof users.$inferSelect): AuthUser {
  const role = row.role === 'admin' ? 'admin' : 'student';
  return {
    id: row.id,
    uid: row.uid,
    email: row.email,
    name: row.name,
    role,
    rollNumber: row.rollNumber ?? null,
    mobileNumber: row.mobileNumber ?? null,
    department: row.department ?? null,
    needsProfileCompletion: role === 'student' && (!row.rollNumber || !row.mobileNumber),
  };
}

export async function resolveBearerUser(token: string): Promise<AuthUser | null> {
  // 1. Check server-signed HMAC session token first
  const session = verifySessionToken(token);
  if (session) {
    if (session.role === 'admin' && session.userId === 0) {
      return {
        id: 0,
        uid: session.sub,
        email: session.email,
        name: 'Campus Estates Administrator',
        role: 'admin',
        rollNumber: null,
        mobileNumber: null,
        department: null,
      };
    }
    const [row] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
    if (!row) return null;
    return mapDbUserToAuthUser(row);
  }

  // 2. Verify Firebase ID Token (Google Sign-In)
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const email = (decoded.email || '').trim().toLowerCase();
    if (!email) return null;

    const [existingByUid] = await db
      .select()
      .from(users)
      .where(eq(users.uid, decoded.uid))
      .limit(1);

    if (existingByUid) {
      return mapDbUserToAuthUser(existingByUid);
    }

    const [existingByEmail] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existingByEmail) {
      const [updated] = await db
        .update(users)
        .set({ uid: decoded.uid, updatedAt: new Date() })
        .where(eq(users.id, existingByEmail.id))
        .returning();
      return mapDbUserToAuthUser(updated);
    }

    const role = email === INITIAL_ADMIN_EMAIL ? 'admin' : 'student';
    const [inserted] = await db
      .insert(users)
      .values({
        uid: decoded.uid,
        email,
        name: decoded.name || email.split('@')[0],
        role,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
          updatedAt: new Date(),
        },
      })
      .returning();

    return mapDbUserToAuthUser(inserted);
  } catch {
    return null;
  }
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing authentication token.' });
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Empty authentication token.' });
  }
  try {
    const user = await resolveBearerUser(token);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or expired session.' });
    }
    req.authUser = user;
    next();
  } catch (error) {
    console.error('Authentication check failed:', error);
    return res.status(500).json({ error: 'Authentication verification failed.' });
  }
};

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.authUser) {
    return res.status(401).json({ error: 'Unauthorized: Sign in required.' });
  }
  if (req.authUser.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Administrator access only.' });
  }
  next();
};

export const requireStudent = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.authUser) {
    return res.status(401).json({ error: 'Unauthorized: Sign in required.' });
  }
  if (req.authUser.role !== 'student') {
    return res.status(403).json({ error: 'Forbidden: Student account required.' });
  }
  next();
};
