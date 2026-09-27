import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

export async function filesIn(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink())
      throw new Error(`Symlink not permitted in release inputs: ${entry.name}`);
    const file = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await filesIn(file)));
    else if (entry.isFile()) result.push(file);
    else throw new Error("Unexpected filesystem entry in release inputs.");
  }
  return result.sort();
}

export async function runtimeFingerprint() {
  const manifest = await readFile("runtime/package.json");
  const lock = await readFile("runtime/package-lock.json");
  return sha256(Buffer.concat([manifest, Buffer.from("\n"), lock]));
}

export async function sourceFingerprint(component: "ui" | "server") {
  const directories = component === "ui" ? ["client", "shared"] : ["server", "shared", "runtime"];
  const config =
    component === "ui"
      ? ["vite.config.ts", "tailwind.config.ts", "postcss.config.js", "tsconfig.json"]
      : ["tsconfig.json"];
  const files = [
    ...(await Promise.all(directories.map(filesIn))).flat(),
    ...config,
    "package.json",
    "package-lock.json",
    "script/build.ts",
    "script/clean-build.ts",
    "script/release-utils.ts",
  ].sort();
  // runtime/node_modules must never become part of the source or a release.
  if (files.some((file) => file.includes("/node_modules/")))
    throw new Error(
      "Install runtime dependencies in a separate staging directory, not inside runtime/.",
    );
  return sha256(
    JSON.stringify(
      await Promise.all(files.map(async (file) => [file, sha256(await readFile(file))])),
    ),
  );
}

export async function artifactFiles(component: "ui" | "server") {
  if (component === "server") return ["dist/index.cjs", "dist/migrate.cjs"];
  const files = (await filesIn("dist/public")).filter(
    (file) => path.basename(file) !== ".htaccess",
  );
  for (const file of files) {
    if (
      file
        .split("/")
        .some(
          (part) =>
            part.startsWith(".") || ["private", "data", "node_modules", "server"].includes(part),
        ) ||
      /\.(?:sqlite|db)(?:-wal|-shm|-journal)?$/i.test(file) ||
      file.endsWith("/owner-setup.txt")
    )
      throw new Error("Protected or unexpected file in frontend output.");
  }
  if (!files.includes("dist/public/index.html"))
    throw new Error("Frontend build is missing index.html.");
  return files;
}
