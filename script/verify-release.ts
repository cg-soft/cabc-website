import { readFile } from "node:fs/promises";
import path from "node:path";
import { filesIn, sha256 } from "./release-utils";

async function main() {
  const [directory, targetFile, ...extra] = process.argv.slice(2);
  if (!directory || extra.length)
    throw new Error("Usage: npm run release:verify -- RELEASE_DIRECTORY [ACTIVE_MANIFEST]");
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  if (
    manifest.format !== 1 ||
    !["ui", "server", "full", "runtime"].includes(manifest.kind) ||
    !manifest.files ||
    typeof manifest.files !== "object"
  )
    throw new Error("Unsupported release manifest.");
  const root = path.join(directory, "payload");
  const actual = (await filesIn(root))
    .map((file) => path.relative(root, file).split(path.sep).join("/"))
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify(Object.keys(manifest.files).sort()))
    throw new Error("Payload file set does not match manifest.");
  const required =
    manifest.kind === "runtime"
      ? ["package.json", "package-lock.json"]
      : manifest.kind === "ui"
        ? ["dist/public/index.html"]
        : manifest.kind === "server"
          ? ["dist/index.cjs", "dist/migrate.cjs"]
          : ["dist/public/index.html", "dist/index.cjs", "dist/migrate.cjs"];
  if (
    required.some((file) => !actual.includes(file)) ||
    !Number.isInteger(manifest.apiContract) ||
    !Number.isInteger(manifest.schema?.min) ||
    !Number.isInteger(manifest.schema?.max) ||
    !/^[a-f0-9]{64}$/.test(manifest.runtimeFingerprint)
  )
    throw new Error("Incomplete release manifest or payload.");
  for (const [file, hash] of Object.entries(manifest.files)) {
    const allowed =
      manifest.kind === "runtime"
        ? ["package.json", "package-lock.json"].includes(file)
        : ((manifest.kind === "ui" || manifest.kind === "full") &&
            file.startsWith("dist/public/")) ||
          ((manifest.kind === "server" || manifest.kind === "full") &&
            ["dist/index.cjs", "dist/migrate.cjs"].includes(file));
    if (
      !allowed ||
      file
        .split("/")
        .some(
          (part) => part.startsWith(".") || ["private", "data", "node_modules"].includes(part),
        ) ||
      /\.(?:sqlite|db)(?:-wal|-shm|-journal)?$/i.test(file) ||
      file.endsWith("/owner-setup.txt")
    )
      throw new Error("Unsafe payload path.");
    if (sha256(await readFile(path.join(root, file))) !== hash)
      throw new Error(`Checksum mismatch: ${file}`);
  }
  if (targetFile) {
    const active = JSON.parse(await readFile(targetFile, "utf8"));
    if (manifest.kind === "ui" && manifest.apiContract !== active.apiContract)
      throw new Error("UI/API contract mismatch. Use a coordinated release.");
    if (manifest.kind === "server" && manifest.apiContract !== active.apiContract)
      throw new Error("Backend/UI contract mismatch. Use a coordinated release.");
    if (
      manifest.kind === "ui" &&
      (manifest.schema?.min !== active.schema?.min || manifest.schema?.max !== active.schema?.max)
    )
      throw new Error("UI/schema compatibility mismatch. Use a coordinated release.");
    if (manifest.kind !== "runtime" && manifest.runtimeFingerprint !== active.runtimeFingerprint)
      throw new Error("Runtime fingerprint mismatch. Complete runtime maintenance first.");
  }
  console.log(
    "Release payload checks passed. This does not verify the live database, hosting runtime, or API routing.",
  );
  if (!targetFile)
    console.log("No active manifest supplied; deployed compatibility has NOT been checked.");
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
