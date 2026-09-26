import { readdir, rm } from "node:fs/promises";
import path from "node:path";

/**
 * Remove generated output without deleting hosting-managed .htaccess files.
 * In cPanel, dist/public can be the document root and hold Passenger routing.
 * Preserve these files in place, including when a later build step fails.
 */
export async function cleanBuildOutput(outputDirectory: string): Promise<void> {
  async function clear(directory: string, keepPublicDirectory: boolean) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name === ".htaccess") continue;
      const filename = path.join(directory, entry.name);
      if (keepPublicDirectory && entry.name === "public" && entry.isDirectory()) {
        await clear(filename, false);
      } else {
        // rm removes symlinks themselves, never recursively follows their target.
        await rm(filename, { recursive: true, force: true });
      }
    }
  }
  await clear(outputDirectory, true);
}
