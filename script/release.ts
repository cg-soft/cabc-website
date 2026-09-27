import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { artifactFiles, sourceFingerprint, sha256, runtimeFingerprint } from "./release-utils";
import { API_CONTRACT, REQUIRED_SCHEMA_VERSION } from "../shared/release-contract";

async function main() {
  const [kind, id, ...extra] = process.argv.slice(2);
  if (
    extra.length ||
    !["ui", "server", "full", "runtime"].includes(kind) ||
    !id ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id)
  )
    throw new Error("Usage: npm run release -- ui|server|full|runtime RELEASE_ID");
  const components: ("ui" | "server")[] =
    kind === "full" ? ["ui", "server"] : kind === "runtime" ? [] : [kind as "ui" | "server"];
  const payload = new Map<string, string>();
  const built: Record<string, unknown> = {};
  for (const component of components) {
    const receipt = JSON.parse(await readFile(`dist/.build/${component}.json`, "utf8"));
    if (
      receipt.sourceFingerprint !== (await sourceFingerprint(component)) ||
      receipt.runtimeFingerprint !== (await runtimeFingerprint()) ||
      receipt.apiContract !== API_CONTRACT ||
      receipt.schemaVersion !== REQUIRED_SCHEMA_VERSION
    )
      throw new Error(`Stale ${component} build; rebuild before packaging.`);
    const files = await artifactFiles(component);
    if (JSON.stringify(files.sort()) !== JSON.stringify(Object.keys(receipt.files).sort()))
      throw new Error(`Unexpected ${component} artifact set; rebuild before packaging.`);
    for (const file of files) {
      if (sha256(await readFile(file)) !== receipt.files[file])
        throw new Error("Modified artifact; rebuild before packaging.");
      payload.set(file, file);
    }
    built[component] = receipt.sourceFingerprint;
  }
  // Runtime files intentionally map to the application's root, NOT runtime/.
  // Full application releases do not reinstall or overwrite runtime dependencies.
  if (kind === "runtime") {
    payload.set("package.json", "runtime/package.json");
    payload.set("package-lock.json", "runtime/package-lock.json");
  }
  const destination = path.join("release", id);
  await mkdir("release", { recursive: true });
  await mkdir(destination); // Refuse to overwrite an existing release.
  const checksums: Record<string, string> = {};
  for (const [target, source] of payload) {
    const content = await readFile(source);
    const output = path.join(destination, "payload", target);
    await mkdir(path.dirname(output), { recursive: true });
    await copyFile(source, output);
    checksums[target] = sha256(content);
  }
  let sourceCommit: string | null = null;
  let sourceDirty: boolean | null = null;
  try {
    sourceCommit = execFileSync("git", ["-C", process.cwd(), "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    sourceDirty = !!execFileSync("git", ["-C", process.cwd(), "status", "--porcelain"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // Source ZIPs have no Git metadata; source/artifact fingerprints still apply.
  }
  const manifest = {
    format: 1,
    releaseId: id,
    kind,
    createdAt: new Date().toISOString(),
    sourceCommit,
    sourceDirty,
    sourceFingerprints: built,
    apiContract: API_CONTRACT,
    schema: { min: REQUIRED_SCHEMA_VERSION, max: REQUIRED_SCHEMA_VERSION },
    runtimeFingerprint: await runtimeFingerprint(),
    runtimeNodeMajor: 22,
    files: checksums,
  };
  await writeFile(
    path.join(destination, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(`Prepared ${destination}. No upload, activation, or database changes performed.`);
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
