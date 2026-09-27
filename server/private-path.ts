import { mkdirSync, existsSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
export function privatePath(filename: string, createParent = true) {
  const absolute = path.resolve(filename);
  // Never store secrets in directories that a build or a static server may expose.
  if (
    absolute
      .split(path.sep)
      .some((part) => ["dist", "public", "client", "node_modules"].includes(part))
  )
    throw new Error("Private storage must be outside static and build directories");
  if (createParent) mkdirSync(path.dirname(absolute), { recursive: true, mode: 0o700 });
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
