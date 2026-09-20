import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, and, gt, isNull, asc, desc, count } from "drizzle-orm";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { mkdirSync, existsSync, writeFileSync, chmodSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import * as schema from "@shared/schema";
import type {
  User,
  SafeUser,
  Settings,
  SignupInput,
  ProfileInput,
  EventInput,
  AnnouncementInput,
  DocumentInput,
  ContactInput,
  SettingsInput,
  MemberHub,
  Event,
  Announcement,
  DocumentMetadata,
  Document,
  Inquiry,
} from "@shared/schema";
import type { DanceHub, DanceScheduleInput } from "@shared/schema";

const {
  users,
  sessions,
  invitations,
  passwordResets,
  bootstrap,
  settings,
  events,
  rsvps,
  announcements,
  documents,
  inquiries,
} = schema;
const { dancePlayers, danceGames, danceSlots, danceAttendance } = schema;
const clubDate = (date: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(date));
export const clubToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const SESSION_MS = 8 * 60 * 60 * 1000;
export const INVITE_MS = 7 * 24 * 60 * 60 * 1000;
export const RESET_MS = 60 * 60 * 1000;
export const hashSecret = (secret: string) => createHash("sha256").update(secret).digest("hex");
const randomSecret = () => randomBytes(32).toString("base64url");
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const safeUser = ({ passwordHash: _passwordHash, ...user }: User): SafeUser => user;
const derive = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$32768$8$1$${salt}$${(await derive(password, salt)).toString("hex")}`;
}
async function verifyPassword(password: string, stored: string) {
  const parts = stored.split("$");
  if (
    parts.length !== 6 ||
    parts.slice(0, 4).join("$") !== "scrypt$32768$8$1" ||
    !/^[a-f0-9]{32}$/.test(parts[4]) ||
    !/^[a-f0-9]{128}$/.test(parts[5])
  )
    return false;
  const key = await derive(password, parts[4]);
  return timingSafeEqual(key, Buffer.from(parts[5], "hex"));
}
export const DEFAULT_SETTINGS: Settings = {
  clubName: "Chinese American Bridge Club",
  about: "A welcoming community for duplicate bridge, thoughtful play, and learning together.",
  venue: "",
  contactEmail: "",
  scheduleNote: "Game dates will be announced here.",
};

function privatePath(filename: string) {
  const absolute = path.resolve(filename);
  // Never store secrets in directories that a build or a static server may expose.
  if (
    absolute
      .split(path.sep)
      .some((part) => ["dist", "public", "client", "node_modules"].includes(part))
  )
    throw new Error("Private storage must be outside static and build directories");
  mkdirSync(path.dirname(absolute), { recursive: true, mode: 0o700 });
  const canonical = path.join(realpathSync(path.dirname(absolute)), path.basename(absolute));
  if (
    canonical
      .split(path.sep)
      .some((part) => ["dist", "public", "client", "node_modules"].includes(part))
  )
    throw new Error("Private storage must be outside static and build directories");
  if (existsSync(absolute) && lstatSync(absolute).isSymbolicLink())
    throw new Error("Private files cannot be symbolic links");
  return canonical;
}

type AuthResult = { token: string; user: SafeUser };
type CodeResult = { code: string; expiresAt: string };
export interface IStorage {
  setupRequired(): boolean;
  setup(input: SignupInput): Promise<AuthResult>;
  login(email: string, password: string): Promise<AuthResult>;
  accept(input: SignupInput): Promise<AuthResult>;
  authenticate(token: string): SafeUser | undefined;
  logout(token: string): void;
  resetPassword(code: string, email: string, password: string): Promise<void>;
  publicData(): { settings: Settings; events: Event[] };
  memberHub(userId: number): MemberHub;
  updateProfile(userId: number, input: ProfileInput): SafeUser;
  setRsvp(userId: number, eventId: number, attending: boolean): void;
  getDocument(id: number): Pick<Document, "filename" | "content" | "type"> | undefined;
  createInquiry(input: ContactInput): void;
  adminData(): {
    members: Pick<User, "id" | "name" | "email" | "role" | "listed">[];
    inquiries: Inquiry[];
    settings: Settings;
  };
  createInvite(email: string): CodeResult;
  createReset(email: string): CodeResult;
  createEvent(input: EventInput): Event;
  createAnnouncement(input: AnnouncementInput): Announcement;
  createDocument(input: DocumentInput): DocumentMetadata;
  updateSettings(input: SettingsInput): Settings;
  danceHub(userId: number): DanceHub;
  enrollDance(userId: number, enrolled: boolean): void;
  createDanceSchedule(input: DanceScheduleInput): { created: number };
  bookDance(userId: number, gameId: number, partnerId: number): void;
  cancelDance(userId: number, gameId: number, bookingId: string): void;
  standbyDance(userId: number, gameId: number, standby: boolean): void;
  attendDance(userId: number, gameId: number, attending: boolean, bookingId?: string): void;
  close(): void;
}

export class DatabaseStorage implements IStorage {
  readonly sqlite: Database.Database;
  readonly db;
  readonly setupPath: string;
  private readonly dummyHash: Promise<string>;
  constructor(
    dbPath = process.env.DB_PATH || path.resolve("data/club.sqlite"),
    setupPath = process.env.SETUP_PATH || path.resolve("private/owner-setup.txt"),
  ) {
    process.umask(0o077);
    const filename = privatePath(dbPath);
    this.setupPath = privatePath(setupPath);
    this.sqlite = new Database(filename);
    chmodSync(filename, 0o600);
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("foreign_keys = ON");
    this.sqlite.pragma("busy_timeout = 5000");
    this.sqlite.pragma("secure_delete = ON");
    this.db = drizzle(this.sqlite, { schema });
    // Idempotent initial migration; never drop or replace user data at startup.
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member')), bio TEXT NOT NULL DEFAULT '', listed INTEGER NOT NULL DEFAULT 0 CHECK(listed IN (0,1)));
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS invitations (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, code_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, used_at INTEGER);
      CREATE TABLE IF NOT EXISTS password_resets (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, code_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, used_at INTEGER);
      CREATE TABLE IF NOT EXISTS bootstrap (id INTEGER PRIMARY KEY CHECK(id=1), code_hash TEXT NOT NULL, used_at INTEGER);
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), club_name TEXT NOT NULL, about TEXT NOT NULL, venue TEXT NOT NULL DEFAULT '', contact_email TEXT NOT NULL DEFAULT '', schedule_note TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, date TEXT NOT NULL, location TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', visibility TEXT NOT NULL CHECK(visibility IN ('public','members')));
      CREATE TABLE IF NOT EXISTS rsvps (event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(event_id, user_id));
      CREATE TABLE IF NOT EXISTS announcements (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL, content TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'text/plain' CHECK(type='text/plain'));
      CREATE TABLE IF NOT EXISTS inquiries (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dance_players (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS dance_games (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL UNIQUE, title TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dance_slots (
        game_id INTEGER NOT NULL REFERENCES dance_games(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        partner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        booking_id TEXT,
        status TEXT NOT NULL CHECK(status IN ('booked','standby','cancelled')),
        PRIMARY KEY(game_id,user_id),
        CHECK((status='booked' AND partner_id IS NOT NULL AND partner_id<>user_id AND booking_id IS NOT NULL) OR (status<>'booked' AND partner_id IS NULL AND booking_id IS NULL))
      );
      CREATE INDEX IF NOT EXISTS dance_slots_booking_idx ON dance_slots(booking_id);
      CREATE TABLE IF NOT EXISTS dance_attendance (
        game_id INTEGER NOT NULL REFERENCES dance_games(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        attending INTEGER NOT NULL CHECK(attending IN (0,1)),
        PRIMARY KEY(game_id,user_id)
      );
    `);
    // Additive, one-time unification. Preserve every event, RSVP and partnership.
    if (Number(this.sqlite.pragma("user_version", { simple: true })) < 3) {
      this.db.transaction(
        () => {
          for (const event of this.db
            .select()
            .from(events)
            .orderBy(asc(events.date), asc(events.id))
            .all()) {
            const game = this.ensureDanceDate(clubDate(event.date), event.title);
            for (const rsvp of this.db
              .select()
              .from(rsvps)
              .where(eq(rsvps.eventId, event.id))
              .all())
              this.recordAttendance(rsvp.userId, game.id, true);
          }
          for (const slot of this.db.select().from(danceSlots).all()) {
            if (slot.status === "booked" || slot.status === "standby")
              this.recordAttendance(slot.userId, slot.gameId, true);
          }
          this.sqlite.pragma("user_version = 3");
        },
        { behavior: "immediate" },
      );
    }
    this.db
      .insert(settings)
      .values({ id: 1, ...DEFAULT_SETTINGS })
      .onConflictDoNothing()
      .run();
    this.db.transaction(
      (tx) => {
        if (!tx.select().from(bootstrap).where(eq(bootstrap.id, 1)).get()) {
          const hasUsers = !!tx.select({ id: users.id }).from(users).limit(1).get();
          const code = randomSecret();
          tx.insert(bootstrap)
            .values({ id: 1, codeHash: hashSecret(code), usedAt: hasUsers ? Date.now() : null })
            .run();
          if (!hasUsers) writeFileSync(this.setupPath, `${code}\n`, { mode: 0o600, flag: "w" });
        }
      },
      { behavior: "immediate" },
    );
    if (existsSync(this.setupPath)) chmodSync(this.setupPath, 0o600);
    this.sqlite.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
    this.dummyHash = hashPassword(randomSecret());
  }
  close() {
    this.sqlite.close();
  }
  setupRequired() {
    const boot = this.db.select().from(bootstrap).where(eq(bootstrap.id, 1)).get();
    return (
      !!boot && boot.usedAt === null && !this.db.select({ id: users.id }).from(users).limit(1).get()
    );
  }
  private createSession(user: User): AuthResult {
    const token = randomSecret();
    this.db
      .insert(sessions)
      .values({ tokenHash: hashSecret(token), userId: user.id, expiresAt: Date.now() + SESSION_MS })
      .run();
    return { token, user: safeUser(user) };
  }
  async setup(input: SignupInput): Promise<AuthResult> {
    if (!this.setupRequired()) throw new ApiError(409, "Owner setup is unavailable.");
    const boot = this.db.select().from(bootstrap).where(eq(bootstrap.id, 1)).get();
    if (!boot || boot.codeHash !== hashSecret(input.code))
      throw new ApiError(400, "Invalid or expired setup code.");
    const passwordHash = await hashPassword(input.password);
    const result = this.db.transaction(
      (tx) => {
        const current = tx
          .select()
          .from(bootstrap)
          .where(
            and(
              eq(bootstrap.id, 1),
              isNull(bootstrap.usedAt),
              eq(bootstrap.codeHash, hashSecret(input.code)),
            ),
          )
          .get();
        if (!current || tx.select({ id: users.id }).from(users).limit(1).get())
          throw new ApiError(409, "Owner setup is unavailable.");
        const user = tx
          .insert(users)
          .values({ name: input.name, email: input.email, passwordHash, role: "admin" })
          .returning()
          .get();
        tx.update(bootstrap).set({ usedAt: Date.now() }).where(eq(bootstrap.id, 1)).run();
        return this.createSession(user);
      },
      { behavior: "immediate" },
    );
    // The DB is authoritative: code stays disabled even if this best-effort redaction fails.
    try {
      writeFileSync(
        this.setupPath,
        "Owner setup completed. This file no longer contains a valid code.\n",
        { mode: 0o600 },
      );
    } catch {
      /* Do not log any secrets or user data. */
    }
    return result;
  }
  async login(email: string, password: string): Promise<AuthResult> {
    const user = this.db.select().from(users).where(eq(users.email, email)).get();
    const valid = await verifyPassword(password, user?.passwordHash ?? (await this.dummyHash));
    if (!user || !valid) throw new ApiError(401, "Email or password is incorrect.");
    // Recheck inside transaction so a concurrent password reset cannot mint a stale session.
    return this.db.transaction(
      (tx) => {
        const current = tx
          .select()
          .from(users)
          .where(and(eq(users.id, user.id), eq(users.passwordHash, user.passwordHash)))
          .get();
        if (!current) throw new ApiError(401, "Email or password is incorrect.");
        return this.createSession(current);
      },
      { behavior: "immediate" },
    );
  }
  async accept(input: SignupInput): Promise<AuthResult> {
    const condition = and(
      eq(invitations.codeHash, hashSecret(input.code)),
      eq(invitations.email, input.email),
      isNull(invitations.usedAt),
      gt(invitations.expiresAt, Date.now()),
    );
    if (!this.db.select().from(invitations).where(condition).get())
      throw new ApiError(400, "Invalid or expired invitation.");
    const passwordHash = await hashPassword(input.password);
    return this.db.transaction(
      (tx) => {
        const invite = tx
          .select()
          .from(invitations)
          .where(
            and(
              eq(invitations.codeHash, hashSecret(input.code)),
              eq(invitations.email, input.email),
              isNull(invitations.usedAt),
              gt(invitations.expiresAt, Date.now()),
            ),
          )
          .get();
        if (
          !invite ||
          tx.select({ id: users.id }).from(users).where(eq(users.email, input.email)).get()
        )
          throw new ApiError(400, "Invalid or expired invitation.");
        const user = tx
          .insert(users)
          .values({
            name: input.name,
            email: input.email,
            passwordHash,
            role: "member",
            listed: false,
          })
          .returning()
          .get();
        tx.update(invitations)
          .set({ usedAt: Date.now() })
          .where(eq(invitations.id, invite.id))
          .run();
        return this.createSession(user);
      },
      { behavior: "immediate" },
    );
  }
  authenticate(token: string): SafeUser | undefined {
    const row = this.db
      .select({ user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, hashSecret(token)), gt(sessions.expiresAt, Date.now())))
      .get();
    return row ? safeUser(row.user) : undefined;
  }
  logout(token: string) {
    this.db
      .delete(sessions)
      .where(eq(sessions.tokenHash, hashSecret(token)))
      .run();
  }
  createInvite(email: string): CodeResult {
    return this.db.transaction(
      (tx) => {
        if (tx.select({ id: users.id }).from(users).where(eq(users.email, email)).get())
          throw new ApiError(409, "This email already belongs to a member.");
        const code = randomSecret(),
          expiresAt = Date.now() + INVITE_MS;
        tx.update(invitations)
          .set({ usedAt: Date.now() })
          .where(and(eq(invitations.email, email), isNull(invitations.usedAt)))
          .run();
        tx.insert(invitations)
          .values({ email, codeHash: hashSecret(code), expiresAt })
          .run();
        return { code, expiresAt: new Date(expiresAt).toISOString() };
      },
      { behavior: "immediate" },
    );
  }
  createReset(email: string): CodeResult {
    return this.db.transaction(
      (tx) => {
        const user = tx.select().from(users).where(eq(users.email, email)).get();
        if (!user) throw new ApiError(404, "Member not found.");
        const code = randomSecret(),
          expiresAt = Date.now() + RESET_MS;
        tx.update(passwordResets)
          .set({ usedAt: Date.now() })
          .where(and(eq(passwordResets.userId, user.id), isNull(passwordResets.usedAt)))
          .run();
        tx.insert(passwordResets)
          .values({ userId: user.id, codeHash: hashSecret(code), expiresAt })
          .run();
        return { code, expiresAt: new Date(expiresAt).toISOString() };
      },
      { behavior: "immediate" },
    );
  }
  async resetPassword(code: string, email: string, password: string) {
    const lookup = () =>
      this.db
        .select({ reset: passwordResets, user: users })
        .from(passwordResets)
        .innerJoin(users, eq(users.id, passwordResets.userId))
        .where(
          and(
            eq(passwordResets.codeHash, hashSecret(code)),
            eq(users.email, email),
            isNull(passwordResets.usedAt),
            gt(passwordResets.expiresAt, Date.now()),
          ),
        )
        .get();
    if (!lookup()) throw new ApiError(400, "Invalid or expired recovery code.");
    const passwordHash = await hashPassword(password);
    this.db.transaction(
      (tx) => {
        const row = lookup();
        if (!row) throw new ApiError(400, "Invalid or expired recovery code.");
        tx.update(users).set({ passwordHash }).where(eq(users.id, row.user.id)).run();
        tx.update(passwordResets)
          .set({ usedAt: Date.now() })
          .where(and(eq(passwordResets.userId, row.user.id), isNull(passwordResets.usedAt)))
          .run();
        tx.delete(sessions).where(eq(sessions.userId, row.user.id)).run();
      },
      { behavior: "immediate" },
    );
  }
  private getSettings(): Settings {
    const { id: _id, ...result } = this.db.select().from(settings).where(eq(settings.id, 1)).get()!;
    return result;
  }
  publicData() {
    return {
      settings: this.getSettings(),
      events: this.db
        .select()
        .from(events)
        .where(eq(events.visibility, "public"))
        .orderBy(asc(events.date))
        .all(),
    };
  }
  memberHub(userId: number): MemberHub {
    const user = this.db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) throw new ApiError(401, "Sign in to continue.");
    const counts = this.db
      .select({ eventId: rsvps.eventId, total: count() })
      .from(rsvps)
      .groupBy(rsvps.eventId)
      .all();
    const attendeeCounts = new Map(counts.map((row) => [row.eventId, row.total]));
    const attending = new Set(
      this.db
        .select({ eventId: rsvps.eventId })
        .from(rsvps)
        .where(eq(rsvps.userId, userId))
        .all()
        .map((row) => row.eventId),
    );
    return {
      user: safeUser(user),
      announcements: this.db
        .select()
        .from(announcements)
        .orderBy(desc(announcements.createdAt), desc(announcements.id))
        .all(),
      events: this.db
        .select()
        .from(events)
        .orderBy(asc(events.date))
        .all()
        .map((event) => ({
          ...event,
          rsvped: attending.has(event.id),
          attendeeCount: attendeeCounts.get(event.id) || 0,
        })),
      members: this.db
        .select({ id: users.id, name: users.name, email: users.email, bio: users.bio })
        .from(users)
        .where(eq(users.listed, true))
        .orderBy(asc(users.name))
        .all(),
      documents: this.db
        .select({
          id: documents.id,
          title: documents.title,
          description: documents.description,
          filename: documents.filename,
        })
        .from(documents)
        .orderBy(desc(documents.id))
        .all(),
    };
  }
  updateProfile(userId: number, input: ProfileInput): SafeUser {
    const user = this.db.update(users).set(input).where(eq(users.id, userId)).returning().get();
    if (!user) throw new ApiError(401, "Sign in to continue.");
    return safeUser(user);
  }
  setRsvp(userId: number, eventId: number, attending: boolean) {
    const event = this.db.select().from(events).where(eq(events.id, eventId)).get();
    if (!event) throw new ApiError(404, "Event not found.");
    const game = this.ensureDanceDate(clubDate(event.date), event.title);
    this.attendDance(userId, game.id, attending);
  }
  getDocument(id: number) {
    return this.db
      .select({ filename: documents.filename, content: documents.content, type: documents.type })
      .from(documents)
      .where(eq(documents.id, id))
      .get();
  }
  createInquiry(input: ContactInput) {
    this.db
      .insert(inquiries)
      .values({ ...input, createdAt: new Date().toISOString() })
      .run();
  }
  adminData() {
    return {
      members: this.db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          listed: users.listed,
        })
        .from(users)
        .orderBy(asc(users.name))
        .all(),
      inquiries: this.db
        .select()
        .from(inquiries)
        .orderBy(desc(inquiries.createdAt), desc(inquiries.id))
        .all(),
      settings: this.getSettings(),
    };
  }
  createEvent(input: EventInput) {
    return this.db.transaction(
      (tx) => {
        const event = tx
          .insert(events)
          .values({ ...input, date: new Date(input.date).toISOString() })
          .returning()
          .get();
        const game = this.ensureDanceDate(clubDate(event.date), event.title);
        for (const attendance of tx
          .select()
          .from(danceAttendance)
          .where(and(eq(danceAttendance.gameId, game.id), eq(danceAttendance.attending, true)))
          .all()) {
          tx.insert(rsvps)
            .values({ eventId: event.id, userId: attendance.userId })
            .onConflictDoNothing()
            .run();
        }
        return event;
      },
      { behavior: "immediate" },
    );
  }
  createAnnouncement(input: AnnouncementInput) {
    return this.db
      .insert(announcements)
      .values({ ...input, createdAt: new Date().toISOString() })
      .returning()
      .get();
  }
  createDocument(input: DocumentInput): DocumentMetadata {
    const slug =
      input.title
        .normalize("NFKD")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 70) || "club-document";
    const doc = this.db
      .insert(documents)
      .values({ ...input, filename: `${slug.toLowerCase()}.txt`, type: "text/plain" })
      .returning()
      .get();
    return { id: doc.id, title: doc.title, description: doc.description, filename: doc.filename };
  }
  updateSettings(input: SettingsInput) {
    this.db.update(settings).set(input).where(eq(settings.id, 1)).run();
    return this.getSettings();
  }

  danceHub(userId: number): DanceHub {
    // No account email, profile, password, or un-enrolled roster is exposed.
    return this.db.transaction((tx) => {
      const enrolled = !!tx
        .select()
        .from(dancePlayers)
        .where(eq(dancePlayers.userId, userId))
        .get();
      const players = tx
        .select({ id: users.id, name: users.name })
        .from(dancePlayers)
        .innerJoin(users, eq(users.id, dancePlayers.userId))
        .orderBy(asc(users.name), asc(users.id))
        .all();
      const slots = tx.select().from(danceSlots).all();
      const attendance = tx.select().from(danceAttendance).all();
      const calendar = tx.select().from(events).orderBy(asc(events.date)).all();
      const games = tx
        .select()
        .from(danceGames)
        .orderBy(asc(danceGames.date))
        .all()
        .map((game) => ({
          ...game,
          events: calendar.filter((event) => clubDate(event.date) === game.date),
          attendeeCount: attendance.filter((a) => a.gameId === game.id && a.attending).length,
          availablePlayerIds: players
            .filter(
              (p) =>
                !slots.some(
                  (s) => s.gameId === game.id && s.userId === p.id && s.status === "booked",
                ) &&
                !attendance.some((a) => a.gameId === game.id && a.userId === p.id && !a.attending),
            )
            .map((p) => p.id),
        }));
      return {
        enrolled,
        today: clubToday(),
        players,
        games,
        slots,
        attendance: attendance.filter(
          (a) => a.userId === userId || players.some((p) => p.id === a.userId),
        ),
      };
    });
  }
  private ensureDanceDate(date: string, title: string) {
    this.db.insert(danceGames).values({ date, title }).onConflictDoNothing().run();
    return this.db.select().from(danceGames).where(eq(danceGames.date, date)).get()!;
  }
  private recordAttendance(userId: number, gameId: number, attending: boolean) {
    this.db
      .insert(danceAttendance)
      .values({ gameId, userId, attending })
      .onConflictDoUpdate({
        target: [danceAttendance.gameId, danceAttendance.userId],
        set: { attending },
      })
      .run();
    const game = this.db.select().from(danceGames).where(eq(danceGames.id, gameId)).get()!;
    for (const event of this.db
      .select()
      .from(events)
      .all()
      .filter((e) => clubDate(e.date) === game.date)) {
      if (attending)
        this.db.insert(rsvps).values({ eventId: event.id, userId }).onConflictDoNothing().run();
      else
        this.db
          .delete(rsvps)
          .where(and(eq(rsvps.eventId, event.id), eq(rsvps.userId, userId)))
          .run();
    }
  }
  attendDance(userId: number, gameId: number, attending: boolean, bookingId?: string) {
    this.db.transaction(
      (tx) => {
        this.editableDanceGame(gameId);
        const slot = tx
          .select()
          .from(danceSlots)
          .where(and(eq(danceSlots.gameId, gameId), eq(danceSlots.userId, userId)))
          .get();
        if (!attending) {
          if (bookingId && slot?.bookingId !== bookingId)
            throw new ApiError(
              409,
              "Your partnership has changed. Refresh before changing your RSVP.",
            );
          if (slot?.status === "booked") {
            if (bookingId !== slot.bookingId)
              throw new ApiError(
                409,
                "Cancel your partnership before marking yourself as not playing.",
              );
            this.cancelDance(userId, gameId, bookingId);
          } else if (slot?.status === "standby")
            tx.delete(danceSlots)
              .where(and(eq(danceSlots.gameId, gameId), eq(danceSlots.userId, userId)))
              .run();
        }
        this.recordAttendance(userId, gameId, attending);
      },
      { behavior: "immediate" },
    );
  }
  private editableDanceGame(gameId: number) {
    const game = this.db.select().from(danceGames).where(eq(danceGames.id, gameId)).get();
    if (!game) throw new ApiError(404, "Dance-card game not found.");
    if (game.date < clubToday()) throw new ApiError(409, "Past dance cards are read-only.");
    return game;
  }
  private requireDancePlayer(userId: number) {
    if (!this.db.select().from(dancePlayers).where(eq(dancePlayers.userId, userId)).get())
      throw new ApiError(409, "Both members must join the dance-card roster first.");
  }
  enrollDance(userId: number, enrolled: boolean) {
    this.db.transaction(
      (tx) => {
        if (enrolled) {
          tx.insert(dancePlayers).values({ userId }).onConflictDoNothing().run();
        } else {
          const commitments = tx
            .select({ date: danceGames.date, status: danceSlots.status })
            .from(danceSlots)
            .innerJoin(danceGames, eq(danceGames.id, danceSlots.gameId))
            .where(eq(danceSlots.userId, userId))
            .all();
          if (commitments.some((c) => c.date >= clubToday() && c.status !== "cancelled"))
            throw new ApiError(
              409,
              "Cancel your upcoming partnerships and leave standby lists before leaving Dance Cards.",
            );
          tx.delete(dancePlayers).where(eq(dancePlayers.userId, userId)).run();
        }
      },
      { behavior: "immediate" },
    );
  }
  createDanceSchedule(input: DanceScheduleInput) {
    const first = new Date(`${input.startDate}T12:00:00Z`);
    if (first.getUTCDay() !== 1) throw new ApiError(400, "Choose a Monday as the first date.");
    if (input.startDate < clubToday())
      throw new ApiError(400, "The schedule must start today or later.");
    const horizon = new Date(`${clubToday()}T12:00:00Z`);
    horizon.setUTCFullYear(horizon.getUTCFullYear() + 2);
    const last = new Date(first);
    last.setUTCDate(last.getUTCDate() + (input.weeks - 1) * 7);
    if (last > horizon) throw new ApiError(400, "Please add dates within the next two years.");
    return this.db.transaction(
      (tx) => {
        let created = 0;
        for (let i = 0; i < input.weeks; i++) {
          const date = new Date(first);
          date.setUTCDate(date.getUTCDate() + i * 7);
          created += tx
            .insert(danceGames)
            .values({ date: date.toISOString().slice(0, 10), title: input.title })
            .onConflictDoNothing()
            .run().changes;
        }
        return { created };
      },
      { behavior: "immediate" },
    );
  }
  bookDance(userId: number, gameId: number, partnerId: number) {
    this.db.transaction(
      (tx) => {
        this.editableDanceGame(gameId);
        this.requireDancePlayer(userId);
        this.requireDancePlayer(partnerId);
        if (userId === partnerId) throw new ApiError(400, "Choose another member as your partner.");
        const slots = tx.select().from(danceSlots).where(eq(danceSlots.gameId, gameId)).all();
        if (slots.some((s) => [userId, partnerId].includes(s.userId) && s.status === "booked"))
          throw new ApiError(
            409,
            "One of you already has a partner for this date. Refresh the card and choose another available member.",
          );
        const unavailable = tx
          .select()
          .from(danceAttendance)
          .where(and(eq(danceAttendance.gameId, gameId), eq(danceAttendance.attending, false)))
          .all();
        if (unavailable.some((a) => a.userId === userId || a.userId === partnerId))
          throw new ApiError(
            409,
            "One of you is marked as not playing. Update your RSVP or choose an available partner.",
          );
        const bookingId = randomSecret();
        for (const [player, partner] of [
          [userId, partnerId],
          [partnerId, userId],
        ]) {
          tx.insert(danceSlots)
            .values({ gameId, userId: player, partnerId: partner, bookingId, status: "booked" })
            .onConflictDoUpdate({
              target: [danceSlots.gameId, danceSlots.userId],
              set: { partnerId: partner, bookingId, status: "booked" },
            })
            .run();
          this.recordAttendance(player, gameId, true);
        }
      },
      { behavior: "immediate" },
    );
  }
  cancelDance(userId: number, gameId: number, bookingId: string) {
    this.db.transaction(
      (tx) => {
        this.editableDanceGame(gameId);
        const pair = tx
          .select()
          .from(danceSlots)
          .where(
            and(
              eq(danceSlots.gameId, gameId),
              eq(danceSlots.bookingId, bookingId),
              eq(danceSlots.status, "booked"),
            ),
          )
          .all();
        if (pair.length !== 2)
          throw new ApiError(
            409,
            "This partnership has changed. Refresh the card before cancelling.",
          );
        const actor = tx.select({ role: users.role }).from(users).where(eq(users.id, userId)).get();
        if (!pair.some((s) => s.userId === userId) && actor?.role !== "admin")
          throw new ApiError(
            403,
            "Only a partner or club administrator can cancel this partnership.",
          );
        tx.update(danceSlots)
          .set({ status: "cancelled", partnerId: null, bookingId: null })
          .where(and(eq(danceSlots.gameId, gameId), eq(danceSlots.bookingId, bookingId)))
          .run();
      },
      { behavior: "immediate" },
    );
  }
  standbyDance(userId: number, gameId: number, standby: boolean) {
    this.db.transaction(
      (tx) => {
        this.editableDanceGame(gameId);
        this.requireDancePlayer(userId);
        const slot = tx
          .select()
          .from(danceSlots)
          .where(and(eq(danceSlots.gameId, gameId), eq(danceSlots.userId, userId)))
          .get();
        if (slot?.status === "booked")
          throw new ApiError(
            409,
            "You already have a partner. Cancel that partnership before joining standby.",
          );
        if (standby)
          tx.insert(danceSlots)
            .values({ gameId, userId, status: "standby", partnerId: null, bookingId: null })
            .onConflictDoUpdate({
              target: [danceSlots.gameId, danceSlots.userId],
              set: { status: "standby", partnerId: null, bookingId: null },
            })
            .run();
        else if (slot?.status === "standby")
          tx.delete(danceSlots)
            .where(and(eq(danceSlots.gameId, gameId), eq(danceSlots.userId, userId)))
            .run();
        if (standby) this.recordAttendance(userId, gameId, true);
      },
      { behavior: "immediate" },
    );
  }
}

// Lazy construction prevents importing routes/tests from modifying the real blank database.
let singleton: DatabaseStorage | undefined;
export function getStorage() {
  return (singleton ??= new DatabaseStorage());
}
