import "dotenv/config";
import path from "node:path";
import { databaseStatus, migrateDatabase } from "./migrations";
import { SchemaCompatibilityError } from "./database";

const args = new Set(process.argv.slice(2));
const usage = "Usage: node dist/migrate.cjs --status | --apply (--init | --backup-confirmed)";
try {
  if (
    [...args].some(
      (arg) => !["--status", "--apply", "--init", "--backup-confirmed"].includes(arg),
    ) ||
    args.size !== process.argv.slice(2).length ||
    (args.has("--status")
      ? args.size !== 1
      : !args.has("--apply") ||
        args.size !== 2 ||
        args.has("--init") === args.has("--backup-confirmed"))
  ) {
    throw new SchemaCompatibilityError(usage);
  }
  const filename = process.env.DB_PATH || path.resolve("data/club.sqlite");
  if (args.has("--status")) {
    const status = databaseStatus(filename);
    console.log(JSON.stringify(status));
    if (!status.compatible) process.exitCode = 2;
  } else {
    // --init must never be used as a shortcut for upgrading a populated DB.
    const status = databaseStatus(filename);
    if (args.has("--init") && status.exists && status.version !== 0)
      throw new SchemaCompatibilityError(
        "Existing versioned database: use --backup-confirmed after stopping the application and taking a backup.",
      );
    console.log(JSON.stringify(migrateDatabase(filename, { initialize: args.has("--init") })));
  }
} catch (error) {
  console.error(
    error instanceof SchemaCompatibilityError
      ? error.message
      : "Migration failed; transactional changes were rolled back. Check private storage, native dependencies, and database integrity. No private database details are logged.",
  );
  process.exitCode = 1;
}
