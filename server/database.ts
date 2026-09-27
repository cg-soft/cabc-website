import Database from "better-sqlite3";
import { existsSync, chmodSync } from "node:fs";
import { privatePath } from "./private-path";
import { SCHEMA_V3_SQL } from "./migrations/schema-v3";
import { REQUIRED_SCHEMA_VERSION } from "../shared/release-contract";

export class SchemaCompatibilityError extends Error {}

export function schemaVersion(db: Database.Database): number {
  return Number(db.pragma("user_version", { simple: true }));
}

// Validate required columns, primary keys, nullability, indexes and FK definitions
// against the frozen baseline without repairing the application's database.
export function assertSchemaShape(db: Database.Database) {
  const reference = new Database(":memory:");
  try {
    reference.exec(SCHEMA_V3_SQL);
    const tables = reference
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    for (const { name } of tables) {
      const expected = reference.pragma(`table_info("${name}")`) as Record<string, unknown>[];
      const actual = db.pragma(`table_info("${name}")`) as Record<string, unknown>[];
      for (const column of expected) {
        const found = actual.find((entry) => entry.name === column.name);
        if (
          !found ||
          ["type", "notnull", "dflt_value", "pk"].some((key) => found[key] !== column[key])
        ) {
          throw new SchemaCompatibilityError(
            "Database structure is incompatible. Inspect a backup before migrating.",
          );
        }
      }
      for (const pragma of ["foreign_key_list", "index_list"]) {
        // Index origins / names can differ between equivalent legacy DDL; compare
        // index columns and uniqueness, not sqlite's generated index names.
        const definitions = (connection: Database.Database) => {
          if (pragma === "foreign_key_list")
            return (connection.pragma(`${pragma}("${name}")`) as Record<string, unknown>[])
              .map(({ id: _id, ...row }) => JSON.stringify(row))
              .sort();
          return (
            connection.pragma(`index_list("${name}")`) as {
              name: string;
              unique: number;
              partial: number;
            }[]
          )
            .map((index) =>
              JSON.stringify({
                unique: index.unique,
                partial: index.partial,
                columns: (
                  connection.pragma(`index_info("${index.name.replaceAll('"', '""')}")`) as {
                    name: string;
                  }[]
                ).map((column) => column.name),
              }),
            )
            .sort();
        };
        const actualDefinitions = definitions(db);
        if (definitions(reference).some((entry) => !actualDefinitions.includes(entry)))
          throw new SchemaCompatibilityError(
            "Database constraints are incompatible. Inspect a backup before migrating.",
          );
      }
    }
  } finally {
    reference.close();
  }
}

export function assertCompatibleSchema(db: Database.Database) {
  const version = schemaVersion(db);
  if (version !== REQUIRED_SCHEMA_VERSION) {
    throw new SchemaCompatibilityError(
      `Database schema version ${version} is incompatible; this server requires ${REQUIRED_SCHEMA_VERSION}. Stop the application, back up the database, and run the explicit migration command.`,
    );
  }
  assertSchemaShape(db);
}

export function openApplicationDatabase(filename: string): Database.Database {
  if (!existsSync(filename))
    throw new SchemaCompatibilityError(
      "Database is missing. Run the explicit migration command with --apply --init before starting the application.",
    );
  const canonical = privatePath(filename, false);
  const db = new Database(canonical, { fileMustExist: true });
  try {
    // No schema writes, journal changes, private setup directory, or bootstrap
    // credentials are created before this compatibility check succeeds.
    assertCompatibleSchema(db);
    chmodSync(canonical, 0o600);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    db.pragma("secure_delete = ON");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
