// Run separately from Passenger via cron. Never send on application startup.
import { pathToFileURL } from "node:url";
import path from "node:path";
import { openDatabase, transaction } from "./db.mjs";
import { notificationsAvailable, mailConfiguration, processQueue } from "./notifications.mjs";

export async function runWorker({ env = process.env, createTransport } = {}) {
  const configuration = mailConfiguration(env);
  const db = openDatabase(env.DB_PATH);
  try {
    if (env.PREVIEW_MODE === "1" || db.prepare("SELECT value FROM metadata WHERE key='preview'").get()?.value === "1")
      throw new Error("Email delivery is forbidden for preview mode/data.");
    if (!createTransport) ({ default: { createTransport } } = await import("nodemailer"));
    const transport = createTransport({ host: configuration.host, port: configuration.port, secure: true,
      auth: configuration.auth, tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
      logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true });
    try { return await processQueue(db, { transport, batch: configuration.batch, site: configuration.site }); }
    finally { transport.close?.(); }
  } finally { db.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.umask(0o077);
  try {
    const command = process.argv[2] || "status";
    if (command === "run") console.log(await runWorker());
    else if (command === "status" || command === "retry" || command === "review") {
      const db = openDatabase();
      try {
        if (!notificationsAvailable(db)) throw new Error("Run node migrate.mjs notifications first.");
        if (command === "retry") {
          const id = process.argv[3];
          if (!/^[a-f0-9]{32}$/.test(id || "") || process.argv[4] !== "--confirm-may-duplicate")
            throw new Error("Review the private queue first. Usage: node mail-worker.mjs retry ID --confirm-may-duplicate");
          console.log(transaction(db, () => db.prepare("UPDATE notification_outbox SET state='pending',attempts=0,next_attempt=?,last_error=NULL WHERE id=? AND state IN ('failed','uncertain')")
            .run(Date.now(), id).changes), "notification(s) reset. Retrying an uncertain result can send a duplicate.");
        } else if (command === "review") console.log(db.prepare("SELECT id,member_id,state,attempts,created_at,last_error,json_extract(payload_json,'$.kind') AS kind,json_extract(payload_json,'$.game.date') AS game_date FROM notification_outbox WHERE state IN ('failed','uncertain') ORDER BY created_at LIMIT 100").all());
        else console.log(db.prepare("SELECT state,count(*) AS count FROM notification_outbox GROUP BY state").all());
      } finally { db.close(); }
    } else throw new Error("Usage: node mail-worker.mjs status | review | run | retry ID --confirm-may-duplicate");
  } catch { console.error("Mail worker could not complete. Check private SMTP settings, DB_PATH, migration and preview/enable flags. No credentials are logged."); process.exitCode = 1; }
}
