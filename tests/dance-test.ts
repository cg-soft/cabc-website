/** Isolated HTTP + SQLite lifecycle tests. Never touches real memberships. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { DatabaseStorage, clubToday } from "../server/storage";
import { migrateDatabase } from "../server/migrations";
import { createApplication } from "../server/index";
if (process.env.NODE_ENV !== "test") throw new Error("Use NODE_ENV=test");

test("dance cards: private reciprocal bookings and lifecycle", async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dance-tests-"));
  migrateDatabase(path.join(dir, "club.sqlite"), { initialize: true });
  let store = new DatabaseStorage(path.join(dir, "club.sqlite"), path.join(dir, "setup.txt"));
  const { httpServer } = await createApplication({ storage: store, apiOnly: true });
  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  const address = httpServer.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const req = async (method: string, url: string, token?: string, body?: unknown) => {
    const res = await fetch(base + url, {
      method,
      headers: {
        Connection: "close",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  const password = "Only-test-password-928!";
  const owner = await store.setup({
    code: readFileSync(path.join(dir, "setup.txt"), "utf8").trim(),
    name: "Test Owner",
    email: "owner@example.test",
    password,
  });
  const a = await store.accept({
    code: store.createInvite("a@example.test").code,
    name: "Alex",
    email: "a@example.test",
    password,
  });
  const b = await store.accept({
    code: store.createInvite("b@example.test").code,
    name: "Bailey",
    email: "b@example.test",
    password,
  });
  const c = await store.accept({
    code: store.createInvite("c@example.test").code,
    name: "Casey",
    email: "c@example.test",
    password,
  });
  const monday = new Date(`${clubToday()}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() + ((8 - monday.getUTCDay()) % 7));
  const startDate = monday.toISOString().slice(0, 10);
  const schedule = { startDate, weeks: 3, title: "Monday duplicate bridge" };
  let game = 0,
    second = 0;
  const root = "/api/member/dance";
  const action = (id: number, name: string) => `${root}/games/${id}/${name}`;
  const hub = (token = a.token) => req("GET", root, token);
  try {
    await t.test("every dance endpoint requires login; member cannot add schedule", async () => {
      for (const [method, url, body] of [
        ["GET", root, undefined],
        ["POST", `${root}/enrollment`, { enrolled: true }],
        ["POST", action(1, "book"), { partnerId: 1 }],
        ["POST", action(1, "cancel"), { bookingId: "x".repeat(43) }],
        ["POST", action(1, "standby"), { standby: true }],
        ["POST", action(1, "rsvp"), { attending: true }],
        ["POST", "/api/admin/dance/schedule", schedule],
      ] as const)
        assert.equal((await req(method, url, undefined, body)).status, 401);
      assert.equal((await req("POST", "/api/admin/dance/schedule", a.token, schedule)).status, 403);
    });
    await t.test(
      "admin dates validate Mondays and calendar dates; duplicate schedule preserves records",
      async () => {
        const invalid = await req("POST", "/api/admin/dance/schedule", owner.token, {
          ...schedule,
          startDate: "2027-02-30",
        });
        assert.equal(invalid.status, 400);
        const tue = new Date(monday);
        tue.setUTCDate(tue.getUTCDate() + 1);
        assert.equal(
          (
            await req("POST", "/api/admin/dance/schedule", owner.token, {
              ...schedule,
              startDate: tue.toISOString().slice(0, 10),
            })
          ).status,
          400,
        );
        assert.equal(
          (await req("POST", "/api/admin/dance/schedule", owner.token, { ...schedule, weeks: 53 }))
            .status,
          400,
        );
        assert.equal(
          (await req("POST", "/api/admin/dance/schedule", owner.token, schedule)).body.created,
          3,
        );
        assert.equal(
          (await req("POST", "/api/admin/dance/schedule", owner.token, schedule)).body.created,
          0,
        );
        const d = (await hub()).body;
        [game, second] = d.games.map((g: any) => g.id);
        assert.equal(d.games.length, 3);
        assert.equal(d.enrolled, false);
        assert.deepEqual(d.players, []);
      },
    );
    await t.test("opt-in is separate from directory; only safe names exposed", async () => {
      assert.equal(
        (await req("POST", action(game, "book"), a.token, { partnerId: b.user.id })).status,
        409,
      );
      for (const player of [owner, a, b, c])
        assert.equal(
          (await req("POST", `${root}/enrollment`, player.token, { enrolled: true })).status,
          200,
        );
      assert.deepEqual(store.memberHub(a.user.id).members, []);
      for (const player of (await hub()).body.players)
        assert.deepEqual(Object.keys(player).sort(), ["id", "name"]);
      assert.equal(JSON.stringify((await req("GET", "/api/public")).body).includes("dance"), false);
    });
    await t.test(
      "self-pairing, forged actor IDs, missing games and invalid bodies fail",
      async () => {
        assert.equal(
          (await req("POST", action(game, "book"), a.token, { partnerId: a.user.id })).status,
          400,
        );
        assert.equal(
          (
            await req("POST", action(game, "book"), a.token, {
              partnerId: b.user.id,
              userId: c.user.id,
            })
          ).status,
          400,
        );
        assert.equal(
          (await req("POST", action(99999, "book"), a.token, { partnerId: b.user.id })).status,
          404,
        );
        assert.equal(
          (await req("POST", action(game, "book"), a.token, { partnerId: 99999 })).status,
          409,
        );
        assert.equal(
          (await req("POST", action(game, "book"), a.token, { partnerId: "2" })).status,
          400,
        );
      },
    );
    await t.test(
      "standby is idempotent and booking creates exactly two reciprocal slots",
      async () => {
        for (let i = 0; i < 2; i++)
          assert.equal(
            (await req("POST", action(game, "standby"), a.token, { standby: true })).status,
            200,
          );
        assert.equal((await hub()).body.slots.filter((s: any) => s.gameId === game).length, 1);
        assert.equal(
          (await req("POST", action(game, "standby"), b.token, { standby: true })).status,
          200,
        );
        assert.equal(
          (await req("POST", action(game, "book"), a.token, { partnerId: b.user.id })).status,
          200,
        );
        const slots = (await hub()).body.slots.filter((s: any) => s.gameId === game);
        assert.equal(slots.length, 2);
        assert.equal(slots[0].bookingId, slots[1].bookingId);
        assert.equal(slots[0].userId, slots[1].partnerId);
        assert.equal(slots[1].userId, slots[0].partnerId);
        assert.ok(slots.every((s: any) => s.status === "booked"));
        assert.equal(
          (await req("POST", action(game, "standby"), a.token, { standby: true })).status,
          409,
        );
      },
    );
    await t.test(
      "conflicts reject without overwriting; participants cannot leave with commitments",
      async () => {
        assert.equal(
          (await req("POST", action(game, "book"), c.token, { partnerId: b.user.id })).status,
          409,
        );
        assert.equal(
          (await req("POST", action(game, "book"), a.token, { partnerId: c.user.id })).status,
          409,
        );
        assert.equal(
          (await req("POST", `${root}/enrollment`, a.token, { enrolled: false })).status,
          409,
        );
      },
    );
    await t.test("only partners/admin may cancel; cancellation updates both cards", async () => {
      const bookingId = (await hub()).body.slots.find((s: any) => s.gameId === game).bookingId;
      assert.equal((await req("POST", action(game, "cancel"), c.token, { bookingId })).status, 403);
      assert.equal((await req("POST", action(game, "cancel"), b.token, { bookingId })).status, 200);
      assert.ok(
        (await hub()).body.slots
          .filter((s: any) => s.gameId === game)
          .every(
            (s: any) => s.status === "cancelled" && s.partnerId === null && s.bookingId === null,
          ),
      );
      assert.equal(
        (await req("POST", action(game, "book"), a.token, { partnerId: c.user.id })).status,
        200,
      );
      assert.equal((await req("POST", action(game, "cancel"), a.token, { bookingId })).status, 409);
      const current = (await hub()).body.slots.find(
        (s: any) => s.gameId === game && s.userId === a.user.id,
      ).bookingId;
      assert.equal(
        (await req("POST", action(game, "cancel"), owner.token, { bookingId: current })).status,
        200,
      );
    });
    await t.test("concurrent requests cannot double-book a player", async () => {
      const responses = await Promise.all([
        req("POST", action(second, "book"), a.token, { partnerId: b.user.id }),
        req("POST", action(second, "book"), c.token, { partnerId: b.user.id }),
      ]);
      assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
      const slots = (await hub()).body.slots.filter(
        (s: any) => s.gameId === second && s.status === "booked",
      );
      assert.equal(slots.length, 2);
      assert.equal(slots.filter((s: any) => s.userId === b.user.id).length, 1);
    });
    await t.test("past games reject booking, cancellation and standby changes", async () => {
      store.sqlite
        .prepare("INSERT INTO dance_games(date,title) VALUES(?,?)")
        .run("2020-01-06", "Past game");
      const id = Number(
        store.sqlite.prepare("SELECT id FROM dance_games WHERE date=?").get("2020-01-06")!.id,
      );
      assert.equal(
        (await req("POST", action(id, "book"), a.token, { partnerId: b.user.id })).status,
        409,
      );
      assert.equal(
        (await req("POST", action(id, "standby"), a.token, { standby: true })).status,
        409,
      );
      assert.equal(
        (await req("POST", action(id, "cancel"), a.token, { bookingId: "x".repeat(43) })).status,
        409,
      );
    });
    await t.test(
      "standby marks attendance; leaving roster preserves the member's RSVP",
      async () => {
        assert.equal(
          (await req("POST", action(game, "standby"), owner.token, { standby: true })).status,
          200,
        );
        assert.equal(
          (await req("POST", `${root}/enrollment`, owner.token, { enrolled: false })).status,
          409,
        );
        assert.equal(
          (await req("POST", action(game, "standby"), owner.token, { standby: false })).status,
          200,
        );
        assert.equal(
          (await req("POST", `${root}/enrollment`, owner.token, { enrolled: false })).status,
          200,
        );
        assert.ok(!(await hub()).body.players.some((p: any) => p.id === owner.user.id));
        assert.equal(
          (await hub(owner.token)).body.attendance.find(
            (r: any) => r.gameId === game && r.userId === owner.user.id,
          ).attending,
          true,
        );
        assert.ok(!(await hub()).body.attendance.some((r: any) => r.userId === owner.user.id));
      },
    );
    await t.test(
      "RSVP and calendar events share a single local-date row without losing event details",
      async () => {
        const third = (await hub()).body.games.filter((g: any) => g.date >= clubToday())[2];
        const event = store.createEvent({
          title: "Morning session",
          date: `${third.date}T11:30:00-07:00`,
          location: "Test venue",
          description: "Test details",
          visibility: "members",
        });
        const other = store.createEvent({
          title: "Additional session",
          date: `${third.date}T18:30:00-07:00`,
          location: "Second venue",
          description: "Other details",
          visibility: "public",
        });
        await req("POST", action(third.id, "rsvp"), a.token, { attending: true });
        const rows = (await hub()).body.games.filter((g: any) => g.date === third.date);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].events.length, 2);
        assert.equal(rows[0].attendeeCount, 1);
        assert.ok(
          store
            .memberHub(a.user.id)
            .events.filter((e) => [event.id, other.id].includes(e.id))
            .every((e) => e.rsvped),
        );
        assert.equal(
          (await req("POST", `/api/member/events/${event.id}/rsvp`, a.token, { attending: false }))
            .status,
          200,
        );
        assert.ok(
          store
            .memberHub(a.user.id)
            .events.filter((e) => [event.id, other.id].includes(e.id))
            .every((e) => !e.rsvped),
        );
        assert.equal(
          (await hub()).body.attendance.find(
            (r: any) => r.gameId === third.id && r.userId === a.user.id,
          ).attending,
          false,
        );
        await req("POST", action(third.id, "rsvp"), a.token, { attending: true });
      },
    );
    await t.test(
      "available-member lists omit declined or booked players; server rejects stale selections",
      async () => {
        const third = (await hub()).body.games.filter((g: any) => g.date >= clubToday())[2];
        assert.equal(
          (await req("POST", action(third.id, "rsvp"), b.token, { attending: false })).status,
          200,
        );
        assert.ok(
          !(await hub()).body.games
            .find((g: any) => g.id === third.id)
            .availablePlayerIds.includes(b.user.id),
        );
        assert.equal(
          (await req("POST", action(third.id, "book"), a.token, { partnerId: b.user.id })).status,
          409,
        );
        assert.equal(
          (await req("POST", action(third.id, "book"), b.token, { partnerId: c.user.id })).status,
          409,
        );
        await req("POST", action(third.id, "rsvp"), b.token, { attending: true });
        assert.ok(
          (await hub()).body.games
            .find((g: any) => g.id === third.id)
            .availablePlayerIds.includes(b.user.id),
        );
        assert.equal(
          (await req("POST", action(third.id, "book"), a.token, { partnerId: b.user.id })).status,
          200,
        );
        const current = (await hub()).body;
        assert.ok(
          !current.games
            .find((g: any) => g.id === third.id)
            .availablePlayerIds.some((id: number) => [a.user.id, b.user.id].includes(id)),
        );
        assert.ok(
          current.attendance
            .filter((r: any) => r.gameId === third.id && [a.user.id, b.user.id].includes(r.userId))
            .every((r: any) => r.attending),
        );
        assert.equal(current.games.find((g: any) => g.id === third.id).attendeeCount, 2);
      },
    );
    await t.test(
      "declining a paired date requires current booking confirmation and preserves partner RSVP",
      async () => {
        const third = (await hub()).body.games.filter((g: any) => g.date >= clubToday())[2];
        const bookingId = (await hub()).body.slots.find(
          (s: any) => s.gameId === third.id && s.userId === a.user.id,
        ).bookingId;
        assert.equal(
          (await req("POST", action(third.id, "rsvp"), a.token, { attending: false })).status,
          409,
        );
        assert.equal(
          (
            await req("POST", action(third.id, "rsvp"), a.token, {
              attending: false,
              bookingId: "z".repeat(43),
            })
          ).status,
          409,
        );
        assert.equal(
          (await req("POST", action(third.id, "rsvp"), a.token, { attending: false, bookingId }))
            .status,
          200,
        );
        const state = (await hub()).body;
        assert.ok(
          state.slots
            .filter((s: any) => s.gameId === third.id)
            .every((s: any) => s.status === "cancelled"),
        );
        assert.equal(
          state.attendance.find((r: any) => r.gameId === third.id && r.userId === a.user.id)
            .attending,
          false,
        );
        assert.equal(
          state.attendance.find((r: any) => r.gameId === third.id && r.userId === b.user.id)
            .attending,
          true,
        );
        await req("POST", action(third.id, "rsvp"), a.token, { attending: true });
        await req("POST", action(third.id, "book"), a.token, { partnerId: b.user.id });
        assert.equal(
          (await req("POST", action(third.id, "rsvp"), a.token, { attending: false, bookingId }))
            .status,
          409,
        );
      },
    );
    await t.test(
      "a date exposes every distinct reciprocal pair, and new events inherit RSVPs",
      async () => {
        const third = (await hub()).body.games.filter((g: any) => g.date >= clubToday())[2];
        store.enrollDance(owner.user.id, true);
        assert.equal(
          (await req("POST", action(third.id, "book"), c.token, { partnerId: owner.user.id }))
            .status,
          200,
        );
        const state = (await hub()).body;
        const pairs = state.slots.filter(
          (s: any) => s.gameId === third.id && s.status === "booked" && s.userId < s.partnerId,
        );
        assert.equal(pairs.length, 2);
        assert.equal(new Set(pairs.flatMap((s: any) => [s.userId, s.partnerId])).size, 4);
        const event = store.createEvent({
          title: "Same date new listing",
          date: `${third.date}T09:00:00-07:00`,
          location: "",
          description: "",
          visibility: "members",
        });
        assert.equal(
          store.memberHub(a.user.id).events.find((e) => e.id === event.id)?.attendeeCount,
          4,
        );
      },
    );
    await t.test(
      "unified RSVP rejects forged actors and historical edits; standby decline clears commitment",
      async () => {
        assert.equal(
          (await req("POST", action(game, "rsvp"), a.token, { attending: true, userId: b.user.id }))
            .status,
          400,
        );
        assert.equal(
          (await req("POST", action(game, "rsvp"), a.token, { attending: "yes" })).status,
          400,
        );
        const past = (await hub()).body.games.find((g: any) => g.date === "2020-01-06");
        assert.equal(
          (await req("POST", action(past.id, "rsvp"), a.token, { attending: true })).status,
          409,
        );
        await req("POST", action(game, "standby"), owner.token, { standby: true });
        await req("POST", action(game, "rsvp"), owner.token, { attending: false });
        assert.ok(
          !(await hub()).body.slots.some(
            (s: any) => s.gameId === game && s.userId === owner.user.id && s.status === "standby",
          ),
        );
      },
    );
    await t.test("all dance data persists across database reopen", async () => {
      const before = store.danceHub(a.user.id);
      const secondStore = new DatabaseStorage(
        path.join(dir, "club.sqlite"),
        path.join(dir, "setup.txt"),
      );
      assert.deepEqual(secondStore.danceHub(a.user.id), before);
      secondStore.close();
    });
    await t.test(
      "version-two upgrade preserves events, RSVP records and reciprocal bookings",
      async () => {
        const eventCount = (store.sqlite.prepare("SELECT COUNT(*) n FROM events").get() as any).n;
        const slots = store.danceHub(a.user.id).slots;
        store.sqlite.exec("DROP TABLE dance_attendance; PRAGMA user_version=2;");
        assert.throws(
          () => new DatabaseStorage(path.join(dir, "club.sqlite"), path.join(dir, "setup.txt")),
          /schema version 2/,
        );
        migrateDatabase(path.join(dir, "club.sqlite"));
        const upgraded = new DatabaseStorage(
          path.join(dir, "club.sqlite"),
          path.join(dir, "setup.txt"),
        );
        const state = upgraded.danceHub(a.user.id);
        assert.deepEqual(state.slots, slots);
        assert.equal(
          (upgraded.sqlite.prepare("SELECT COUNT(*) n FROM events").get() as any).n,
          eventCount,
        );
        assert.equal(new Set(state.games.map((g) => g.date)).size, state.games.length);
        for (const slot of slots.filter((s) => s.status === "booked"))
          assert.equal(
            state.attendance.find((a) => a.gameId === slot.gameId && a.userId === slot.userId)
              ?.attending,
            true,
          );
        assert.equal(upgraded.sqlite.pragma("user_version", { simple: true }), 3);
        upgraded.close();
      },
    );
  } finally {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
