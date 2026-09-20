import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import type { Server } from "node:http";
import { z } from "zod";
import {
  signupSchema,
  loginSchema,
  resetSchema,
  emailInputSchema,
  profileSchema,
  rsvpSchema,
  eventInputSchema,
  announcementInputSchema,
  documentInputSchema,
  contactSchema,
  settingsInputSchema,
  type SafeUser,
} from "@shared/schema";
import { ApiError, getStorage, hashSecret, type IStorage } from "./storage";
import {
  danceEnrollmentSchema,
  danceBookingSchema,
  danceStandbySchema,
  danceCancelSchema,
  danceScheduleSchema,
  danceAttendanceSchema,
} from "@shared/schema";

// Bounded, process-local limiter. Do not trust spoofable forwarding or visitor headers.
function rateLimit(
  limit: number,
  windowMs: number,
  keyFn: (req: Request) => string,
): RequestHandler {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (req, res, next) => {
    const now = Date.now();
    // Evict only expired keys, never active ones that an attacker could rotate away.
    if (buckets.size >= 10000)
      buckets.forEach((entry, key) => {
        if (entry.resetAt <= now) buckets.delete(key);
      });
    const key = keyFn(req),
      old = buckets.get(key);
    if (!old && buckets.size >= 10000) {
      res
        .set("Retry-After", "60")
        .status(429)
        .json({ message: "Too many requests. Please try again later." });
      return;
    }
    const entry = old && old.resetAt > now ? old : { count: 0, resetAt: now + windowMs };
    entry.count++;
    buckets.set(key, entry);
    if (entry.count > limit) {
      res
        .set("Retry-After", String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))))
        .status(429)
        .json({ message: "Too many requests. Please try again later." });
      return;
    }
    next();
  };
}
const peer = (req: Request) => req.socket.remoteAddress || "unknown";
const member = (res: Response): SafeUser => res.locals.user as SafeUser;
const numericId = (raw: string | string[]) => {
  if (typeof raw !== "string" || !/^[1-9]\d{0,9}$/.test(raw) || !Number.isSafeInteger(Number(raw)))
    throw new ApiError(400, "Invalid record ID.");
  return Number(raw);
};
function parse<T>(validator: z.ZodType<T>, req: Request): T {
  const parsed = validator.safeParse(req.body);
  if (!parsed.success)
    throw new ApiError(400, "Please check the form fields and their length limits.");
  return parsed.data;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
  store: IStorage = getStorage(),
): Promise<Server> {
  const requireAuth: RequestHandler = (req, res, next) => {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(req.get("Authorization") || "");
    const user = match ? store.authenticate(match[1]) : undefined;
    if (!user) {
      res.status(401).json({ message: "Your session has ended. Please sign in." });
      return;
    }
    res.locals.user = user;
    res.locals.token = match![1];
    next();
  };
  const requireAdmin: RequestHandler = (_req, res, next) => {
    if (member(res).role !== "admin") {
      res.status(403).json({ message: "Administrator access is required." });
      return;
    }
    next();
  };
  const authLimit = rateLimit(50, 15 * 60 * 1000, peer);
  const accountLimit = rateLimit(12, 15 * 60 * 1000, (req) =>
    hashSecret(
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase().slice(0, 254)
        : "unknown",
    ),
  );
  let activePasswordJobs = 0;
  const passwordJob =
    (handler: (req: Request, res: Response) => Promise<void>): RequestHandler =>
    async (req, res, next) => {
      if (activePasswordJobs >= 4) {
        res
          .set("Retry-After", "2")
          .status(429)
          .json({ message: "Please wait a moment and try again." });
        return;
      }
      activePasswordJobs++;
      try {
        await handler(req, res);
      } catch (error) {
        next(error);
      } finally {
        activePasswordJobs--;
      }
    };

  app.get("/api/public", (_req, res) => res.json(store.publicData()));
  app.get("/api/auth/status", (_req, res) => res.json({ setupRequired: store.setupRequired() }));
  app.use("/api/auth", (req, res, next) =>
    req.method === "POST" && req.path.toLowerCase() !== "/logout"
      ? authLimit(req, res, next)
      : next(),
  );
  app.post(
    "/api/auth/setup",
    accountLimit,
    passwordJob(async (req, res) => {
      res.status(201).json(await store.setup(parse(signupSchema, req)));
    }),
  );
  app.post(
    "/api/auth/login",
    accountLimit,
    passwordJob(async (req, res) => {
      const input = parse(loginSchema, req);
      res.json(await store.login(input.email, input.password));
    }),
  );
  app.post(
    "/api/auth/accept",
    accountLimit,
    passwordJob(async (req, res) => {
      res.status(201).json(await store.accept(parse(signupSchema, req)));
    }),
  );
  app.post(
    "/api/auth/reset",
    accountLimit,
    passwordJob(async (req, res) => {
      const input = parse(resetSchema, req);
      await store.resetPassword(input.code, input.email, input.password);
      res.json({ ok: true });
    }),
  );
  app.post("/api/auth/logout", requireAuth, (req, res) => {
    store.logout(res.locals.token);
    res.json({ ok: true });
  });

  // These prefix guards cover all current AND future private API routes.
  app.use("/api/member", requireAuth);
  app.use(
    "/api/member/dance",
    rateLimit(180, 60 * 1000, (req) => hashSecret(req.get("Authorization") || "unknown")),
  );
  app.get("/api/member/dance", (_req, res) => res.json(store.danceHub(member(res).id)));
  app.post("/api/member/dance/games/:id/rsvp", (req, res) => {
    const input = parse(danceAttendanceSchema, req);
    store.attendDance(member(res).id, numericId(req.params.id), input.attending, input.bookingId);
    res.json({ ok: true });
  });
  app.post("/api/member/dance/enrollment", (req, res) => {
    store.enrollDance(member(res).id, parse(danceEnrollmentSchema, req).enrolled);
    res.json({ ok: true });
  });
  app.post("/api/member/dance/games/:id/book", (req, res) => {
    store.bookDance(
      member(res).id,
      numericId(req.params.id),
      parse(danceBookingSchema, req).partnerId,
    );
    res.json({ ok: true });
  });
  app.post("/api/member/dance/games/:id/cancel", (req, res) => {
    store.cancelDance(
      member(res).id,
      numericId(req.params.id),
      parse(danceCancelSchema, req).bookingId,
    );
    res.json({ ok: true });
  });
  app.post("/api/member/dance/games/:id/standby", (req, res) => {
    store.standbyDance(
      member(res).id,
      numericId(req.params.id),
      parse(danceStandbySchema, req).standby,
    );
    res.json({ ok: true });
  });
  app.get("/api/member/hub", (_req, res) => res.json(store.memberHub(member(res).id)));
  app.patch("/api/member/profile", (req, res) =>
    res.json(store.updateProfile(member(res).id, parse(profileSchema, req))),
  );
  app.post("/api/member/events/:id/rsvp", (req, res) => {
    store.setRsvp(member(res).id, numericId(req.params.id), parse(rsvpSchema, req).attending);
    res.json({ ok: true });
  });
  app.get("/api/member/documents/:id", (req, res) => {
    const doc = store.getDocument(numericId(req.params.id));
    if (!doc) throw new ApiError(404, "Document not found.");
    res.json(doc);
  });

  app.post("/api/contact", rateLimit(5, 60 * 60 * 1000, peer), (req, res) => {
    store.createInquiry(parse(contactSchema, req));
    res.status(201).json({ ok: true });
  });

  app.use("/api/admin", requireAuth, requireAdmin);
  app.use(
    "/api/admin",
    rateLimit(120, 60 * 1000, (_req: Request) => "admin-api"),
  );
  app.get("/api/admin", (_req, res) => res.json(store.adminData()));
  app.post("/api/admin/dance/schedule", (req, res) =>
    res.status(201).json(store.createDanceSchedule(parse(danceScheduleSchema, req))),
  );
  app.post("/api/admin/invites", (req, res) =>
    res.status(201).json(store.createInvite(parse(emailInputSchema, req).email)),
  );
  app.post("/api/admin/reset", (req, res) =>
    res.status(201).json(store.createReset(parse(emailInputSchema, req).email)),
  );
  app.post("/api/admin/events", (req, res) =>
    res.status(201).json(store.createEvent(parse(eventInputSchema, req))),
  );
  app.post("/api/admin/announcements", (req, res) =>
    res.status(201).json(store.createAnnouncement(parse(announcementInputSchema, req))),
  );
  app.post("/api/admin/documents", (req, res) =>
    res.status(201).json(store.createDocument(parse(documentInputSchema, req))),
  );
  app.patch("/api/admin/settings", (req, res) =>
    res.json(store.updateSettings(parse(settingsInputSchema, req))),
  );
  app.use("/api", (_req, res) => res.status(404).json({ message: "API endpoint not found." }));
  return httpServer;
}
