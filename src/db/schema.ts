import { relations } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: text('role').notNull().default('student'),
  rollNumber: text('roll_number').unique(),
  mobileNumber: text('mobile_number'),
  department: text('department'),
  passwordHash: text('password_hash'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const adminConfig = pgTable('admin_config', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  claimedAt: timestamp('claimed_at').defaultNow().notNull(),
});

export const campusLocations = pgTable('campus_locations', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  code: text('code').notNull(),
  description: text('description').notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  radiusMeters: integer('radius_meters').notNull().default(95),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const complaintImages = pgTable('complaint_images', {
  id: text('id').primaryKey(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  dataBase64: text('data_base64').notNull(),
  uploadedByUserId: integer('uploaded_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const complaints = pgTable('complaints', {
  id: serial('id').primaryKey(),
  complaintCode: text('complaint_code').notNull().unique(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  category: text('category').notNull(),
  location: text('location').notNull(),
  buildingBlock: text('building_block').notNull(),
  floorRoom: text('floor_room').notNull().default('Not specified'),
  status: text('status').notNull().default('Reported'),
  studentUserId: integer('student_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  studentName: text('student_name').notNull(),
  rollNumber: text('roll_number').notNull(),
  studentMobile: text('student_mobile').notNull(),
  imageId: text('image_id').references(() => complaintImages.id, {
    onDelete: 'set null',
  }),
  isDemo: boolean('is_demo').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  complaints: many(complaints),
  uploadedImages: many(complaintImages),
}));

export const complaintsRelations = relations(complaints, ({ one }) => ({
  student: one(users, {
    fields: [complaints.studentUserId],
    references: [users.id],
  }),
  image: one(complaintImages, {
    fields: [complaints.imageId],
    references: [complaintImages.id],
  }),
}));
