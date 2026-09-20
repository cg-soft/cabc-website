import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "member"] })
    .notNull()
    .default("member"),
  bio: text("bio").notNull().default(""),
  listed: integer("listed", { mode: "boolean" }).notNull().default(false),
});
export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
});
export const invitations = sqliteTable("invitations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull().unique(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
});
export const passwordResets = sqliteTable("password_resets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull().unique(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
});
export const bootstrap = sqliteTable("bootstrap", {
  id: integer("id").primaryKey(),
  codeHash: text("code_hash").notNull(),
  usedAt: integer("used_at"),
});
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  clubName: text("club_name").notNull(),
  about: text("about").notNull(),
  venue: text("venue").notNull().default(""),
  contactEmail: text("contact_email").notNull().default(""),
  scheduleNote: text("schedule_note").notNull().default("Game dates will be announced here."),
});
export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  date: text("date").notNull(),
  location: text("location").notNull().default(""),
  description: text("description").notNull().default(""),
  visibility: text("visibility", { enum: ["public", "members"] })
    .notNull()
    .default("members"),
});
export const rsvps = sqliteTable(
  "rsvps",
  {
    eventId: integer("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.eventId, table.userId] })],
);
export const announcements = sqliteTable("announcements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull(),
});
export const documents = sqliteTable("documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  filename: text("filename").notNull(),
  content: text("content").notNull(),
  type: text("type", { enum: ["text/plain"] })
    .notNull()
    .default("text/plain"),
});
export const inquiries = sqliteTable("inquiries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  message: text("message").notNull(),
  createdAt: text("created_at").notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export const insertSessionSchema = createInsertSchema(sessions);
export const insertInvitationSchema = createInsertSchema(invitations).omit({ id: true });
export const insertPasswordResetSchema = createInsertSchema(passwordResets).omit({ id: true });
export const insertBootstrapSchema = createInsertSchema(bootstrap);
export const insertSettingsSchema = createInsertSchema(settings).omit({ id: true });
export const insertEventSchema = createInsertSchema(events).omit({ id: true });
export const insertRsvpSchema = createInsertSchema(rsvps);
export const insertAnnouncementSchema = createInsertSchema(announcements).omit({ id: true });
export const insertDocumentSchema = createInsertSchema(documents).omit({ id: true });
export const insertInquirySchema = createInsertSchema(inquiries).omit({ id: true });
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
export type PasswordReset = typeof passwordResets.$inferSelect;
export type Bootstrap = typeof bootstrap.$inferSelect;
export type Settings = Omit<typeof settings.$inferSelect, "id">;
export type Event = typeof events.$inferSelect;
export type Rsvp = typeof rsvps.$inferSelect;
export type Announcement = typeof announcements.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type Inquiry = typeof inquiries.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type InsertInvitation = z.infer<typeof insertInvitationSchema>;
export type InsertPasswordReset = z.infer<typeof insertPasswordResetSchema>;
export type InsertBootstrap = z.infer<typeof insertBootstrapSchema>;
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type InsertRsvp = z.infer<typeof insertRsvpSchema>;
export type InsertAnnouncement = z.infer<typeof insertAnnouncementSchema>;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type InsertInquiry = z.infer<typeof insertInquirySchema>;
export type SafeUser = Omit<User, "passwordHash">;
export type DocumentMetadata = Pick<Document, "id" | "title" | "description" | "filename">;
export type MemberHub = {
  user: SafeUser;
  announcements: Announcement[];
  events: (Event & { rsvped: boolean; attendeeCount: number })[];
  members: Pick<User, "id" | "name" | "email" | "bio">[];
  documents: DocumentMetadata[];
};

// API input allowlists. Never accept role, passwordHash, IDs or timestamps from a client.
const plainText = (max: number) =>
  z
    .string()
    .max(max)
    .refine(
      (s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s),
      "Invalid control character",
    );
export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email()
  .transform((s) => s.toLowerCase());
export const passwordSchema = z.string().min(12).max(128);
export const nameSchema = plainText(80).trim().min(1);
export const codeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{43}$/);
const titleSchema = plainText(120).trim().min(1);
export const signupSchema = z
  .object({ code: codeSchema, name: nameSchema, email: emailSchema, password: passwordSchema })
  .strict();
export const loginSchema = z.object({ email: emailSchema, password: passwordSchema }).strict();
export const resetSchema = z
  .object({ code: codeSchema, email: emailSchema, password: passwordSchema })
  .strict();
export const emailInputSchema = z.object({ email: emailSchema }).strict();
export const profileSchema = z
  .object({ name: nameSchema, bio: plainText(1000).trim(), listed: z.boolean() })
  .strict();
export const rsvpSchema = z.object({ attending: z.boolean() }).strict();
export const eventInputSchema = z
  .object({
    title: titleSchema,
    date: z
      .string()
      .max(40)
      .datetime({ offset: true })
      .refine((s) => Number.isFinite(Date.parse(s)), "Invalid date"),
    location: plainText(250).trim(),
    description: plainText(5000).trim(),
    visibility: z.enum(["public", "members"]),
  })
  .strict();
export const announcementInputSchema = z
  .object({ title: titleSchema, body: plainText(10000).trim().min(1) })
  .strict();
export const documentInputSchema = z
  .object({
    title: titleSchema,
    description: plainText(1000).trim(),
    content: plainText(100000).min(1),
  })
  .strict();
export const contactSchema = z
  .object({ name: nameSchema, email: emailSchema, message: plainText(5000).trim().min(10) })
  .strict();
export const settingsInputSchema = z
  .object({
    about: plainText(5000).trim(),
    venue: plainText(250).trim(),
    contactEmail: z.union([emailSchema, z.literal("")]),
    scheduleNote: plainText(1000).trim(),
  })
  .strict()
  .partial()
  .refine((o) => Object.keys(o).length > 0, "No changes supplied");
export type SignupInput = z.infer<typeof signupSchema>;
export type ProfileInput = z.infer<typeof profileSchema>;
export type EventInput = z.infer<typeof eventInputSchema>;
export type AnnouncementInput = z.infer<typeof announcementInputSchema>;
export type DocumentInput = z.infer<typeof documentInputSchema>;
export type ContactInput = z.infer<typeof contactSchema>;
export type SettingsInput = z.infer<typeof settingsInputSchema>;

// Dance cards have their own opt-in roster; directory privacy is independent.
export const dancePlayers = sqliteTable("dance_players", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
});
export const danceGames = sqliteTable("dance_games", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull().unique(),
  title: text("title").notNull(),
});
export const danceSlots = sqliteTable(
  "dance_slots",
  {
    gameId: integer("game_id")
      .notNull()
      .references(() => danceGames.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    partnerId: integer("partner_id").references(() => users.id, { onDelete: "cascade" }),
    bookingId: text("booking_id"),
    status: text("status", { enum: ["booked", "standby", "cancelled"] }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.gameId, table.userId] })],
);
export const insertDancePlayerSchema = createInsertSchema(dancePlayers);
export const danceAttendance = sqliteTable(
  "dance_attendance",
  {
    gameId: integer("game_id")
      .notNull()
      .references(() => danceGames.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    attending: integer("attending", { mode: "boolean" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.gameId, table.userId] })],
);
export const insertDanceGameSchema = createInsertSchema(danceGames).omit({ id: true });
export const insertDanceSlotSchema = createInsertSchema(danceSlots);
export type DancePlayer = typeof dancePlayers.$inferSelect;
export type DanceGame = typeof danceGames.$inferSelect;
export type DanceSlot = typeof danceSlots.$inferSelect;
export type InsertDancePlayer = z.infer<typeof insertDancePlayerSchema>;
export type InsertDanceGame = z.infer<typeof insertDanceGameSchema>;
export type InsertDanceSlot = z.infer<typeof insertDanceSlotSchema>;
export type DanceHub = {
  enrolled: boolean;
  today: string;
  players: { id: number; name: string }[];
  games: (DanceGame & { availablePlayerIds: number[]; events: Event[]; attendeeCount: number })[];
  slots: DanceSlot[];
  attendance: (typeof danceAttendance.$inferSelect)[];
};
const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Use a valid calendar date");
export const danceScheduleSchema = z
  .object({
    startDate: dateOnlySchema,
    weeks: z.number().int().min(1).max(52),
    title: titleSchema,
  })
  .strict();
export const danceEnrollmentSchema = z.object({ enrolled: z.boolean() }).strict();
export const danceBookingSchema = z
  .object({ partnerId: z.number().int().positive().max(2147483647) })
  .strict();
export const danceStandbySchema = z.object({ standby: z.boolean() }).strict();
export const danceAttendanceSchema = z
  .object({
    attending: z.boolean(),
    bookingId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .optional(),
  })
  .strict();
export const danceCancelSchema = z
  .object({ bookingId: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .strict();
export type DanceScheduleInput = z.infer<typeof danceScheduleSchema>;
