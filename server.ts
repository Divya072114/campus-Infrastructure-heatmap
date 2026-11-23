import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { db } from './src/db/index.ts';
import {
  adminConfig,
  campusLocations,
  complaintImages,
  complaints,
  users,
} from './src/db/schema.ts';
import { ensureCampusLocationsSeeded, resetDemoComplaintsOnly } from './src/db/seed.ts';
import {
  escapeCsvCell,
  hashPassword,
  normalizeEmail,
  normalizeMobile,
  normalizeRollNumber,
  safeEqualString,
  signSessionToken,
  validateImageBuffer,
  verifyPassword,
} from './src/lib/security.ts';
import { adminAuth } from './src/lib/firebase-admin.ts';
import {
  AuthRequest,
  INITIAL_ADMIN_EMAIL,
  mapDbUserToAuthUser,
  requireAdmin,
  requireAuth,
  requireStudent,
} from './src/middleware/auth.ts';
import {
  AnalyticsResponse,
  CATEGORIES,
  Category,
  CampusLocationName,
  ComplaintRecord,
  ComplaintStatus,
  DEPARTMENTS,
  LOCATIONS,
  STATUSES,
  normalizeCampusLocation,
} from './src/shared/campus.ts';

const PORT = Number(process.env.PORT) || 3000;
const app = express();

app.use(express.json({ limit: '1mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
    files: 1,
  },
});

function formatComplaintRow(row: typeof complaints.$inferSelect): ComplaintRecord {
  return {
    id: row.id,
    complaintCode: row.complaintCode,
    title: row.title,
    description: row.description,
    category: row.category as Category,
    location: row.location as CampusLocationName,
    buildingBlock: row.buildingBlock,
    floorRoom: row.floorRoom,
    status: row.status as ComplaintStatus,
    studentUserId: row.studentUserId ?? null,
    studentName: row.studentName,
    rollNumber: row.rollNumber,
    studentMobile: row.studentMobile,
    imageId: row.imageId ?? null,
    imageUrl: row.imageId ? `/api/images/${row.imageId}` : null,
    isDemo: Boolean(row.isDemo),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildSearchCondition(searchRaw: string) {
  const term = `%${searchRaw.trim()}%`;
  return or(
    ilike(complaints.complaintCode, term),
    ilike(complaints.title, term),
    ilike(complaints.description, term),
    ilike(complaints.buildingBlock, term),
    ilike(complaints.floorRoom, term),
    ilike(complaints.location, term),
    ilike(complaints.category, term),
    ilike(complaints.studentName, term),
    ilike(complaints.rollNumber, term),
    ilike(complaints.studentMobile, term)
  );
}

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Session inspection
app.get('/api/auth/session', requireAuth, (req: AuthRequest, res) => {
  res.json({ user: req.authUser });
});

// Student Registration (Email + Roll Number uniqueness enforced in PostgreSQL)
app.post('/api/auth/student/register', async (req: Request, res: Response) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const rollNumber = normalizeRollNumber(req.body?.rollNumber);
    const mobileNumber = normalizeMobile(req.body?.mobileNumber);
    const email = normalizeEmail(req.body?.email);
    const department =
      typeof req.body?.department === 'string' &&
      (DEPARTMENTS as readonly string[]).includes(req.body.department)
        ? req.body.department
        : null;
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (name.length < 2 || name.length > 100) {
      return res.status(400).json({ error: 'Please enter your full name (2-100 characters).' });
    }
    if (!rollNumber) {
      return res
        .status(400)
        .json({ error: 'Enter a valid RGUKT roll number (e.g. B201245).' });
    }
    if (!mobileNumber) {
      return res
        .status(400)
        .json({ error: 'Enter a valid 10-digit Indian mobile number starting with 6-9.' });
    }
    if (!email) {
      return res.status(400).json({ error: 'Enter a valid RGUKT email address.' });
    }
    if (!department) {
      return res.status(400).json({ error: 'Please select a valid department.' });
    }
    if (password.length < 6 || password.length > 128) {
      return res.status(400).json({ error: 'Password must be between 6 and 128 characters.' });
    }

    const existingEmail = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existingEmail.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const existingRoll = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.rollNumber, rollNumber))
      .limit(1);
    if (existingRoll.length > 0) {
      return res.status(409).json({ error: 'This RGUKT roll number is already registered.' });
    }

    const passwordHash = await hashPassword(password);
    const uid = `local:${crypto.randomUUID()}`;

    const [created] = await db
      .insert(users)
      .values({
        uid,
        email,
        name,
        role: 'student',
        rollNumber,
        mobileNumber,
        department,
        passwordHash,
      })
      .returning();

    const authUser = mapDbUserToAuthUser(created);
    const token = signSessionToken({
      sub: authUser.uid,
      userId: authUser.id,
      role: 'student',
      email: authUser.email,
    });

    return res.status(201).json({ token, user: authUser });
  } catch (error: unknown) {
    console.error('Student registration error:', error);
    const code = (error as { code?: string })?.code;
    if (code === '23505') {
      return res
        .status(409)
        .json({ error: 'Email or roll number is already registered.' });
    }
    return res.status(500).json({ error: 'Failed to register student account.' });
  }
});

// Student Email/Password Login
app.post('/api/auth/student/login', async (req: Request, res: Response) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!row || row.role !== 'student' || !row.passwordHash) {
      return res.status(401).json({ error: 'Invalid student email or password.' });
    }

    const valid = await verifyPassword(password, row.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid student email or password.' });
    }

    const authUser = mapDbUserToAuthUser(row);
    const token = signSessionToken({
      sub: authUser.uid,
      userId: authUser.id,
      role: 'student',
      email: authUser.email,
    });

    return res.json({ token, user: authUser });
  } catch (error) {
    console.error('Student login error:', error);
    return res.status(500).json({ error: 'Failed to sign in.' });
  }
});

// Complete Student Profile after Google Sign-In
app.post(
  '/api/auth/student/complete-profile',
  requireAuth,
  requireStudent,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : req.authUser!.name;
      const rollNumber = normalizeRollNumber(req.body?.rollNumber);
      const mobileNumber = normalizeMobile(req.body?.mobileNumber);
      const department =
        typeof req.body?.department === 'string' &&
        (DEPARTMENTS as readonly string[]).includes(req.body.department)
          ? req.body.department
          : null;

      if (name.length < 2 || name.length > 100) {
        return res.status(400).json({ error: 'Please enter your full name.' });
      }
      if (!rollNumber) {
        return res.status(400).json({ error: 'Enter a valid RGUKT roll number.' });
      }
      if (!mobileNumber) {
        return res
          .status(400)
          .json({ error: 'Enter a valid 10-digit Indian mobile number.' });
      }
      if (!department) {
        return res.status(400).json({ error: 'Please select a valid department.' });
      }

      const [existingRoll] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.rollNumber, rollNumber))
        .limit(1);

      if (existingRoll && existingRoll.id !== userId) {
        return res.status(409).json({ error: 'This RGUKT roll number is already registered.' });
      }

      const [updated] = await db
        .update(users)
        .set({
          name,
          rollNumber,
          mobileNumber,
          department,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning();

      return res.json({ user: mapDbUserToAuthUser(updated) });
    } catch (error: unknown) {
      console.error('Complete profile error:', error);
      const code = (error as { code?: string })?.code;
      if (code === '23505') {
        return res.status(409).json({ error: 'Roll number is already registered.' });
      }
      return res.status(500).json({ error: 'Failed to update student profile.' });
    }
  }
);

// Update Student Mobile Number (updates profile + existing real complaints transactionally)
app.patch(
  '/api/auth/student/mobile',
  requireAuth,
  requireStudent,
  async (req: AuthRequest, res: Response) => {
    try {
      const mobileNumber = normalizeMobile(req.body?.mobileNumber);
      if (!mobileNumber) {
        return res
          .status(400)
          .json({ error: 'Enter a valid 10-digit Indian mobile number starting with 6-9.' });
      }

      const updatedUser = await db.transaction(async (tx) => {
        const [u] = await tx
          .update(users)
          .set({ mobileNumber, updatedAt: new Date() })
          .where(eq(users.id, req.authUser!.id))
          .returning();

        await tx
          .update(complaints)
          .set({ studentMobile: mobileNumber, updatedAt: new Date() })
          .where(and(eq(complaints.studentUserId, req.authUser!.id), eq(complaints.isDemo, false)));

        return u;
      });

      return res.json({ user: mapDbUserToAuthUser(updatedUser) });
    } catch (error) {
      console.error('Update student mobile error:', error);
      return res.status(500).json({ error: 'Failed to update mobile number.' });
    }
  }
);

// Firebase Google Sign-In Verification & Role Binding
app.post('/api/auth/firebase', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing Firebase ID token.' });
    }
    const idToken = authHeader.slice('Bearer '.length).trim();
    const mode = req.body?.mode === 'admin' ? 'admin' : 'student';

    const decoded = await adminAuth.verifyIdToken(idToken);
    const email = normalizeEmail(decoded.email);
    if (!email || decoded.email_verified === false) {
      return res.status(401).json({ error: 'A verified Google email is required.' });
    }

    const [claimedAdmin] = await db
      .select()
      .from(adminConfig)
      .where(eq(adminConfig.key, 'primary_admin'))
      .limit(1);

    const isEnvAdminEmail =
      Boolean(process.env.ADMIN_EMAIL) &&
      email === process.env.ADMIN_EMAIL!.trim().toLowerCase();
    const isClaimedAdminEmail = Boolean(claimedAdmin && email === claimedAdmin.email.toLowerCase());
    const isInitialOwnerEmail = email === INITIAL_ADMIN_EMAIL;

    const [existingUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (mode === 'admin') {
      const authorizedAdmin =
        isEnvAdminEmail ||
        isClaimedAdminEmail ||
        isInitialOwnerEmail ||
        existingUser?.role === 'admin';

      if (!authorizedAdmin) {
        return res.status(403).json({
          error: 'Forbidden: This Google account does not have administrator privileges.',
        });
      }

      const [adminUser] = await db
        .insert(users)
        .values({
          uid: decoded.uid,
          email,
          name: decoded.name || 'Campus Estates Administrator',
          role: 'admin',
        })
        .onConflictDoUpdate({
          target: users.email,
          set: {
            uid: decoded.uid,
            role: 'admin',
            name: decoded.name || existingUser?.name || 'Campus Estates Administrator',
            updatedAt: new Date(),
          },
        })
        .returning();

      return res.json({ user: mapDbUserToAuthUser(adminUser) });
    }

    // Student Google Sign-In
    if (existingUser?.role === 'admin') {
      return res.status(403).json({
        error: 'This email is registered as an administrator. Please sign in via Admin Login.',
      });
    }

    const [studentUser] = await db
      .insert(users)
      .values({
        uid: decoded.uid,
        email,
        name: decoded.name || email.split('@')[0],
        role: 'student',
      })
      .onConflictDoUpdate({
        target: users.email,
        set: {
          uid: decoded.uid,
          updatedAt: new Date(),
        },
      })
      .returning();

    return res.json({ user: mapDbUserToAuthUser(studentUser) });
  } catch (error) {
    console.error('Firebase auth exchange error:', error);
    return res.status(401).json({ error: 'Invalid or expired Google sign-in token.' });
  }
});

// Admin Setup Status (does not leak secrets)
app.get('/api/auth/admin/status', async (_req: Request, res: Response) => {
  try {
    const envPasswordSet = Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length > 0);
    if (envPasswordSet) {
      return res.json({ needsSetup: false, configuredViaEnv: true });
    }
    const [claimed] = await db
      .select({ id: adminConfig.id })
      .from(adminConfig)
      .where(eq(adminConfig.key, 'primary_admin'))
      .limit(1);

    return res.json({
      needsSetup: !claimed,
      configuredViaEnv: false,
    });
  } catch (error) {
    console.error('Admin status check error:', error);
    return res.status(500).json({ error: 'Failed to check administrator configuration.' });
  }
});

// One-time First-Run Admin Claim Setup (locked once claimed or when ADMIN_PASSWORD env var is set)
app.post('/api/auth/admin/setup', async (req: Request, res: Response) => {
  try {
    if (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length > 0) {
      return res.status(409).json({
        error: 'Administrator password is already configured in server environment.',
      });
    }

    const email = normalizeEmail(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!email) {
      return res.status(400).json({ error: 'Enter a valid administrator email address.' });
    }
    if (password.length < 8 || password.length > 128) {
      return res
        .status(400)
        .json({ error: 'Administrator password must be between 8 and 128 characters.' });
    }

    const passwordHash = await hashPassword(password);

    const inserted = await db
      .insert(adminConfig)
      .values({
        key: 'primary_admin',
        email,
        passwordHash,
      })
      .onConflictDoNothing({ target: adminConfig.key })
      .returning();

    if (inserted.length === 0) {
      return res.status(409).json({
        error: 'Administrator account has already been set up. Please sign in.',
      });
    }

    const token = signSessionToken({
      sub: 'admin:primary',
      userId: 0,
      role: 'admin',
      email,
    });

    return res.status(201).json({
      token,
      user: {
        id: 0,
        uid: 'admin:primary',
        email,
        name: 'Campus Estates Administrator',
        role: 'admin',
        rollNumber: null,
        mobileNumber: null,
        department: null,
      },
    });
  } catch (error) {
    console.error('Admin setup error:', error);
    return res.status(500).json({ error: 'Failed to configure administrator account.' });
  }
});

// Admin Email/Password Login
app.post('/api/auth/admin/login', async (req: Request, res: Response) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!email || !password) {
      return res.status(400).json({ error: 'Administrator email and password are required.' });
    }

    const envPassword = process.env.ADMIN_PASSWORD;
    const envEmail = (process.env.ADMIN_EMAIL || 'admin@rgukt.ac.in').trim().toLowerCase();

    if (envPassword && envPassword.length > 0) {
      const emailOk = safeEqualString(email, envEmail);
      const passOk = safeEqualString(password, envPassword);
      if (!emailOk || !passOk) {
        return res.status(401).json({ error: 'Invalid administrator credentials.' });
      }
      const token = signSessionToken({
        sub: 'admin:env',
        userId: 0,
        role: 'admin',
        email,
      });
      return res.json({
        token,
        user: {
          id: 0,
          uid: 'admin:env',
          email,
          name: 'Campus Estates Administrator',
          role: 'admin',
          rollNumber: null,
          mobileNumber: null,
          department: null,
        },
      });
    }

    const [claimed] = await db
      .select()
      .from(adminConfig)
      .where(eq(adminConfig.key, 'primary_admin'))
      .limit(1);

    if (!claimed) {
      return res.status(412).json({
        error: 'Administrator password has not been set up yet. Complete first-run setup.',
      });
    }

    if (!safeEqualString(email, claimed.email.toLowerCase())) {
      return res.status(401).json({ error: 'Invalid administrator credentials.' });
    }

    const valid = await verifyPassword(password, claimed.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid administrator credentials.' });
    }

    const token = signSessionToken({
      sub: 'admin:primary',
      userId: 0,
      role: 'admin',
      email: claimed.email,
    });

    return res.json({
      token,
      user: {
        id: 0,
        uid: 'admin:primary',
        email: claimed.email,
        name: 'Campus Estates Administrator',
        role: 'admin',
        rollNumber: null,
        mobileNumber: null,
        department: null,
      },
    });
  } catch (error) {
    console.error('Admin login error:', error);
    return res.status(500).json({ error: 'Failed to sign in as administrator.' });
  }
});

// Campus Locations (Authenticated users)
app.get('/api/locations', requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    await ensureCampusLocationsSeeded();
    const rows = await db.select().from(campusLocations).orderBy(campusLocations.id);
    return res.json({ locations: rows });
  } catch (error) {
    console.error('Get locations error:', error);
    return res.status(500).json({ error: 'Failed to load campus locations.' });
  }
});

// Update Campus Locations (Admin Only)
app.put(
  '/api/locations',
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      await ensureCampusLocationsSeeded();
      const updates = Array.isArray(req.body?.locations) ? req.body.locations : null;
      if (!updates || updates.length === 0) {
        return res.status(400).json({ error: 'Locations array is required.' });
      }

      for (const item of updates) {
        const canonicalName = normalizeCampusLocation(item?.name);
        const lat = Number(item?.lat);
        const lng = Number(item?.lng);
        const radiusMeters = Math.round(Number(item?.radiusMeters));

        if (!canonicalName) {
          return res.status(400).json({ error: 'Invalid campus location name.' });
        }
        if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
          return res
            .status(400)
            .json({ error: `Invalid latitude for ${canonicalName}.` });
        }
        if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
          return res
            .status(400)
            .json({ error: `Invalid longitude for ${canonicalName}.` });
        }
        if (!Number.isFinite(radiusMeters) || radiusMeters < 20 || radiusMeters > 1000) {
          return res.status(400).json({
            error: `Radius for ${canonicalName} must be between 20 and 1000 meters.`,
          });
        }

        await db
          .update(campusLocations)
          .set({
            lat,
            lng,
            radiusMeters,
            updatedAt: new Date(),
          })
          .where(eq(campusLocations.name, canonicalName));
      }

      const rows = await db.select().from(campusLocations).orderBy(campusLocations.id);
      return res.json({ locations: rows });
    } catch (error) {
      console.error('Update locations error:', error);
      return res.status(500).json({ error: 'Failed to update campus locations.' });
    }
  }
);

// Reset Campus Locations to Defaults (Admin Only)
app.post(
  '/api/locations/reset',
  requireAuth,
  requireAdmin,
  async (_req: AuthRequest, res: Response) => {
    try {
      const { DEFAULT_LOCATIONS } = await import('./src/shared/campus.ts');
      for (const loc of DEFAULT_LOCATIONS) {
        await db
          .insert(campusLocations)
          .values({
            name: loc.name,
            code: loc.code,
            description: loc.description,
            lat: loc.lat,
            lng: loc.lng,
            radiusMeters: loc.radiusMeters,
          })
          .onConflictDoUpdate({
            target: campusLocations.name,
            set: {
              code: loc.code,
              description: loc.description,
              lat: loc.lat,
              lng: loc.lng,
              radiusMeters: loc.radiusMeters,
              updatedAt: new Date(),
            },
          });
      }
      const rows = await db.select().from(campusLocations).orderBy(campusLocations.id);
      return res.json({ locations: rows });
    } catch (error) {
      console.error('Reset locations error:', error);
      return res.status(500).json({ error: 'Failed to reset campus locations.' });
    }
  }
);

// Image Upload Endpoint (Authenticated Students)
app.post(
  '/api/uploads',
  requireAuth,
  requireStudent,
  upload.single('photo'),
  async (req: AuthRequest, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: 'Please select an image file to upload.' });
      }

      const validation = validateImageBuffer(file.buffer, file.mimetype);
      if (validation.valid === false) {
        return res.status(400).json({ error: validation.error });
      }

      const imageId = crypto.randomUUID();
      await db.insert(complaintImages).values({
        id: imageId,
        mimeType: validation.mimeType,
        sizeBytes: file.buffer.length,
        dataBase64: file.buffer.toString('base64'),
        uploadedByUserId: req.authUser!.id,
      });

      return res.status(201).json({
        imageId,
        imageUrl: `/api/images/${imageId}`,
        sizeBytes: file.buffer.length,
        mimeType: validation.mimeType,
      });
    } catch (error) {
      console.error('Image upload error:', error);
      return res.status(500).json({ error: 'Failed to upload image.' });
    }
  }
);

// Serve Authenticated Complaint Image (Admin or Owning Student)
app.get('/api/images/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return res.status(400).json({ error: 'Invalid image ID.' });
    }

    const [img] = await db
      .select()
      .from(complaintImages)
      .where(eq(complaintImages.id, id))
      .limit(1);

    if (!img) {
      return res.status(404).json({ error: 'Image not found.' });
    }

    if (
      req.authUser!.role !== 'admin' &&
      img.uploadedByUserId !== req.authUser!.id
    ) {
      return res.status(403).json({ error: 'Forbidden: Cannot access this image.' });
    }

    const buf = Buffer.from(img.dataBase64, 'base64');
    res.setHeader('Content-Type', img.mimeType);
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.send(buf);
  } catch (error) {
    console.error('Get image error:', error);
    return res.status(500).json({ error: 'Failed to load image.' });
  }
});

// Student: View Own Real Complaints (newest first)
app.get(
  '/api/complaints/mine',
  requireAuth,
  requireStudent,
  async (req: AuthRequest, res: Response) => {
    try {
      const rows = await db
        .select()
        .from(complaints)
        .where(
          and(
            eq(complaints.studentUserId, req.authUser!.id),
            eq(complaints.isDemo, false)
          )
        )
        .orderBy(desc(complaints.createdAt), desc(complaints.id));

      return res.json({ complaints: rows.map(formatComplaintRow) });
    } catch (error) {
      console.error('Fetch student complaints error:', error);
      return res.status(500).json({ error: 'Failed to load your complaints.' });
    }
  }
);

// Student: Submit Real Complaint
app.post(
  '/api/complaints',
  requireAuth,
  requireStudent,
  async (req: AuthRequest, res: Response) => {
    try {
      const student = req.authUser!;
      if (!student.rollNumber || !student.mobileNumber) {
        return res.status(400).json({
          error: 'Please complete your roll number and 10-digit mobile number before submitting.',
        });
      }

      const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
      const description =
        typeof req.body?.description === 'string' ? req.body.description.trim() : '';
      const category =
        typeof req.body?.category === 'string' &&
        (CATEGORIES as readonly string[]).includes(req.body.category)
          ? req.body.category
          : null;
      const location = normalizeCampusLocation(req.body?.location);
      const buildingBlock =
        typeof req.body?.buildingBlock === 'string' ? req.body.buildingBlock.trim() : '';
      const floorRoomRaw =
        typeof req.body?.floorRoom === 'string' ? req.body.floorRoom.trim() : '';
      const floorRoom = floorRoomRaw || 'Not specified';
      const imageId =
        typeof req.body?.imageId === 'string' && req.body.imageId.trim().length > 0
          ? req.body.imageId.trim()
          : null;

      if (title.length < 4 || title.length > 180) {
        return res
          .status(400)
          .json({ error: 'Complaint title must be between 4 and 180 characters.' });
      }
      if (description.length < 6 || description.length > 2000) {
        return res
          .status(400)
          .json({ error: 'Description must be between 6 and 2000 characters.' });
      }
      if (!category) {
        return res.status(400).json({ error: 'Please select a valid complaint category.' });
      }
      if (!location) {
        return res.status(400).json({ error: 'Please select a valid campus location.' });
      }
      if (buildingBlock.length < 2 || buildingBlock.length > 100) {
        return res
          .status(400)
          .json({ error: 'Please specify the building or block (2-100 characters).' });
      }

      if (imageId) {
        if (!/^[0-9a-f-]{36}$/i.test(imageId)) {
          return res.status(400).json({ error: 'Invalid image reference.' });
        }
        const [img] = await db
          .select({ id: complaintImages.id, uploadedByUserId: complaintImages.uploadedByUserId })
          .from(complaintImages)
          .where(eq(complaintImages.id, imageId))
          .limit(1);
        if (!img || img.uploadedByUserId !== student.id) {
          return res.status(400).json({ error: 'Uploaded image reference is invalid.' });
        }
      }

      await ensureCampusLocationsSeeded();

      // Atomic insert + unique non-reusable complaintCode based on PostgreSQL serial ID
      const created = await db.transaction(async (tx) => {
        const tempCode = `PENDING-${crypto.randomUUID()}`;
        const [inserted] = await tx
          .insert(complaints)
          .values({
            complaintCode: tempCode,
            title,
            description,
            category,
            location,
            buildingBlock,
            floorRoom,
            status: 'Reported',
            studentUserId: student.id,
            studentName: student.name,
            rollNumber: student.rollNumber!,
            studentMobile: student.mobileNumber!,
            imageId,
            isDemo: false,
          })
          .returning();

        const finalCode = `CMP-${1000 + inserted.id}`;
        const [updated] = await tx
          .update(complaints)
          .set({ complaintCode: finalCode })
          .where(eq(complaints.id, inserted.id))
          .returning();

        return updated;
      });

      return res.status(201).json({ complaint: formatComplaintRow(created) });
    } catch (error) {
      console.error('Create complaint error:', error);
      return res.status(500).json({ error: 'Failed to submit complaint.' });
    }
  }
);

// Admin: List Complaints (Real by default, optional includeDemo=true; newest first)
app.get(
  '/api/admin/complaints',
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      const category = typeof req.query.category === 'string' ? req.query.category.trim() : 'All';
      const locationRaw = typeof req.query.location === 'string' ? req.query.location.trim() : 'All';
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : 'All';
      const includeDemo = req.query.includeDemo === 'true';

      const conditions = [];
      if (!includeDemo) {
        conditions.push(eq(complaints.isDemo, false));
      }
      if (category !== 'All' && (CATEGORIES as readonly string[]).includes(category)) {
        conditions.push(eq(complaints.category, category));
      }
      if (locationRaw !== 'All') {
        const canonical = normalizeCampusLocation(locationRaw);
        if (canonical) {
          conditions.push(eq(complaints.location, canonical));
        }
      }
      if (status !== 'All' && (STATUSES as readonly string[]).includes(status)) {
        conditions.push(eq(complaints.status, status));
      }
      if (search.length > 0) {
        conditions.push(buildSearchCondition(search));
      }

      const rows = await db
        .select()
        .from(complaints)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(complaints.createdAt), desc(complaints.id));

      const allFlags = await db.select({ isDemo: complaints.isDemo }).from(complaints);
      const realTotal = allFlags.filter((r) => !r.isDemo).length;
      const demoTotal = allFlags.filter((r) => r.isDemo).length;

      return res.json({
        complaints: rows.map(formatComplaintRow),
        counts: {
          realTotal,
          demoTotal,
          filteredTotal: rows.length,
        },
      });
    } catch (error) {
      console.error('Admin fetch complaints error:', error);
      return res.status(500).json({ error: 'Failed to load complaints.' });
    }
  }
);

// Admin: Heatmap Data (Strictly excludes demo records unless explicitly requested)
app.get(
  '/api/admin/heatmap',
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      await ensureCampusLocationsSeeded();
      const category = typeof req.query.category === 'string' ? req.query.category.trim() : 'All';
      const scope = req.query.scope === 'active' ? 'active' : 'all';

      const conditions = [eq(complaints.isDemo, false)];
      if (category !== 'All' && (CATEGORIES as readonly string[]).includes(category)) {
        conditions.push(eq(complaints.category, category));
      }

      const [locationRows, complaintRows] = await Promise.all([
        db.select().from(campusLocations).orderBy(campusLocations.id),
        db
          .select()
          .from(complaints)
          .where(and(...conditions))
          .orderBy(desc(complaints.createdAt), desc(complaints.id)),
      ]);

      const scopedRows =
        scope === 'active'
          ? complaintRows.filter((c) => c.status !== 'Resolved')
          : complaintRows;

      return res.json({
        locations: locationRows,
        complaints: scopedRows.map(formatComplaintRow),
      });
    } catch (error) {
      console.error('Admin heatmap error:', error);
      return res.status(500).json({ error: 'Failed to load heatmap data.' });
    }
  }
);

// Admin: Analytics Data (Strictly calculated from real student complaints)
app.get(
  '/api/admin/analytics',
  requireAuth,
  requireAdmin,
  async (_req: AuthRequest, res: Response) => {
    try {
      await ensureCampusLocationsSeeded();
      const realRows = await db
        .select()
        .from(complaints)
        .where(eq(complaints.isDemo, false))
        .orderBy(desc(complaints.createdAt));

      const total = realRows.length;
      const reported = realRows.filter((c) => c.status === 'Reported').length;
      const acknowledged = realRows.filter((c) => c.status === 'Acknowledged').length;
      const inProgress = realRows.filter((c) => c.status === 'In Progress').length;
      const resolved = realRows.filter((c) => c.status === 'Resolved').length;

      const byCategory = CATEGORIES.map((cat) => ({
        category: cat,
        count: realRows.filter((c) => c.category === cat).length,
      }));
      const sortedCats = [...byCategory].sort((a, b) => b.count - a.count);
      const topCategory =
        sortedCats[0] && sortedCats[0].count > 0 ? sortedCats[0] : null;

      const byLocation = LOCATIONS.map((loc) => {
        const items = realRows.filter((c) => c.location === loc);
        return {
          location: loc,
          total: items.length,
          reported: items.filter((c) => c.status === 'Reported').length,
          acknowledged: items.filter((c) => c.status === 'Acknowledged').length,
          inProgress: items.filter((c) => c.status === 'In Progress').length,
          resolved: items.filter((c) => c.status === 'Resolved').length,
        };
      });
      const sortedLocs = [...byLocation].sort((a, b) => b.total - a.total);
      const topLocation =
        sortedLocs[0] && sortedLocs[0].total > 0
          ? { location: sortedLocs[0].location, count: sortedLocs[0].total }
          : null;

      const analytics: AnalyticsResponse = {
        total,
        pendingCount: reported + acknowledged,
        inProgressCount: inProgress,
        resolvedCount: resolved,
        resolutionRate: total > 0 ? Math.round((resolved * 100) / total) : 0,
        topCategory,
        topLocation,
        byCategory,
        byStatus: {
          Reported: reported,
          Acknowledged: acknowledged,
          'In Progress': inProgress,
          Resolved: resolved,
        },
        byLocation,
      };

      return res.json(analytics);
    } catch (error) {
      console.error('Admin analytics error:', error);
      return res.status(500).json({ error: 'Failed to load analytics.' });
    }
  }
);

// Admin: Update Complaint Status
app.patch(
  '/api/admin/complaints/:id/status',
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid complaint ID.' });
      }
      const status =
        typeof req.body?.status === 'string' &&
        (STATUSES as readonly string[]).includes(req.body.status)
          ? req.body.status
          : null;

      if (!status) {
        return res.status(400).json({ error: 'Invalid complaint status.' });
      }

      const [updated] = await db
        .update(complaints)
        .set({ status, updatedAt: new Date() })
        .where(eq(complaints.id, id))
        .returning();

      if (!updated) {
        return res.status(404).json({ error: 'Complaint not found.' });
      }

      return res.json({ complaint: formatComplaintRow(updated) });
    } catch (error) {
      console.error('Update complaint status error:', error);
      return res.status(500).json({ error: 'Failed to update complaint status.' });
    }
  }
);

// Admin: Delete Complaint (Sequence is never reset, so deleted IDs are never reused)
app.delete(
  '/api/admin/complaints/:id',
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid complaint ID.' });
      }

      const [deleted] = await db
        .delete(complaints)
        .where(eq(complaints.id, id))
        .returning({ id: complaints.id, imageId: complaints.imageId });

      if (!deleted) {
        return res.status(404).json({ error: 'Complaint not found.' });
      }

      if (deleted.imageId) {
        await db.delete(complaintImages).where(eq(complaintImages.id, deleted.imageId));
      }

      return res.json({ deletedId: deleted.id });
    } catch (error) {
      console.error('Delete complaint error:', error);
      return res.status(500).json({ error: 'Failed to delete complaint.' });
    }
  }
);

// Admin: Reset Demo Data ONLY (strictly preserves real student complaints)
app.post(
  '/api/admin/demo/reset',
  requireAuth,
  requireAdmin,
  async (_req: AuthRequest, res: Response) => {
    try {
      const insertedCount = await resetDemoComplaintsOnly();
      return res.json({ ok: true, demoCount: insertedCount });
    } catch (error) {
      console.error('Reset demo data error:', error);
      return res.status(500).json({ error: 'Failed to reset demo records.' });
    }
  }
);

// Admin: Export Real (or Filtered) Complaints CSV
app.get(
  '/api/admin/export',
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const includeDemo = req.query.includeDemo === 'true';
      const rows = await db
        .select()
        .from(complaints)
        .where(includeDemo ? undefined : eq(complaints.isDemo, false))
        .orderBy(desc(complaints.createdAt), desc(complaints.id));

      const header = [
        'Complaint ID',
        'Title',
        'Category',
        'Campus Location',
        'Building / Block',
        'Floor / Room',
        'Status',
        'Student Name',
        'Roll Number',
        'Mobile',
        'Record Type',
        'Submitted At',
      ].join(',');

      const lines = rows.map((c) =>
        [
          c.complaintCode,
          c.title,
          c.category,
          c.location,
          c.buildingBlock,
          c.floorRoom,
          c.status,
          c.studentName,
          c.rollNumber,
          c.studentMobile,
          c.isDemo ? 'Demo' : 'Student',
          c.createdAt.toISOString(),
        ]
          .map(escapeCsvCell)
          .join(',')
      );

      const csv = [header, ...lines].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="rgukt-basar-complaints.csv"'
      );
      return res.send(csv);
    } catch (error) {
      console.error('Export CSV error:', error);
      return res.status(500).json({ error: 'Failed to export complaints CSV.' });
    }
  }
);

// Multer & global API error handler
app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Image size must be 5 MB or less.' });
    }
    return res.status(400).json({ error: err.message });
  }
  console.error('Unhandled API error:', err);
  return res.status(500).json({ error: 'Internal server error.' });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        return res.sendFile(indexFile);
      }
      return res.status(404).send('Build not found');
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`RGUKT Basar Campus Heatmap server listening on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
