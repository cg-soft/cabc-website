import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { builtinModules } from "node:module";
import { cleanBuildOutput } from "./clean-build";
import { artifactFiles, sourceFingerprint, sha256, runtimeFingerprint } from "./release-utils";
import { API_CONTRACT, REQUIRED_SCHEMA_VERSION } from "../shared/release-contract";

const kind = process.argv[2] || "all";
if (!["ui", "server", "all"].includes(kind))
  throw new Error("Build target must be ui, server, or all.");
process.env.NODE_ENV = "production";

async function recordBuild(component: "ui" | "server", before: string) {
  if ((await sourceFingerprint(component)) !== before)
    throw new Error("Source changed during build; rerun before packaging.");
  const files = await artifactFiles(component);
  await mkdir("dist/.build", { recursive: true });
  await writeFile(
    `dist/.build/${component}.json`,
    JSON.stringify(
      {
        component,
        sourceFingerprint: before,
        apiContract: API_CONTRACT,
        schemaVersion: REQUIRED_SCHEMA_VERSION,
        runtimeFingerprint: await runtimeFingerprint(),
        files: Object.fromEntries(
          await Promise.all(files.map(async (file) => [file, sha256(await readFile(file))])),
        ),
      },
      null,
      2,
    ) + "\n",
  );
}

async function main() {
  if (kind === "ui" || kind === "all") {
    await rm("dist/.build/ui.json", { force: true });
    const fingerprint = await sourceFingerprint("ui");
    // This call clears only the frontend directory and preserves its .htaccess.
    await cleanBuildOutput("dist/public");
    await viteBuild();
    await recordBuild("ui", fingerprint);
  }
  if (kind === "server" || kind === "all") {
    await rm("dist/.build/server.json", { force: true });
    const fingerprint = await sourceFingerprint("server");
    const runtime = JSON.parse(await readFile("runtime/package.json", "utf8"));
    const rootLock = JSON.parse(await readFile("package-lock.json", "utf8"));
    if (
      rootLock.packages["node_modules/better-sqlite3"].version !==
      runtime.dependencies["better-sqlite3"]
    )
      throw new Error("Development and runtime SQLite versions must match.");
    await mkdir("dist", { recursive: true });
    for (const [source, output] of [
      ["server/index.ts", "dist/index.cjs"],
      ["server/migrate.ts", "dist/migrate.cjs"],
    ]) {
      const result = await esbuild({
        entryPoints: [source],
        platform: "node",
        bundle: true,
        format: "cjs",
        target: "node22",
        outfile: output,
        define: { "process.env.NODE_ENV": '"production"' },
        minify: true,
        external: ["better-sqlite3"],
        plugins: [
          {
            name: "disable-optional-terminal-colors",
            setup(build) {
              build.onResolve({ filter: /^supports-color$/ }, () => ({
                path: "supports-color",
                namespace: "optional-color",
              }));
              build.onLoad({ filter: /.*/, namespace: "optional-color" }, () => ({
                contents: "module.exports = false;",
                loader: "js",
              }));
            },
          },
        ],
        metafile: true,
        logLevel: "info",
      });
      const allowed = new Set([
        ...builtinModules,
        ...builtinModules.map((name) => `node:${name}`),
        "better-sqlite3",
      ]);
      for (const file of Object.values(result.metafile.outputs)) {
        for (const entry of file.imports) {
          if (entry.external && !allowed.has(entry.path))
            throw new Error(`Unexpected external dependency: ${entry.path}`);
        }
      }
    }
    await recordBuild("server", fingerprint);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
