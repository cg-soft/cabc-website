import { defineConfig } from "drizzle-kit";
import "dotenv/config";

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DB_PATH || "./data/club.sqlite",
  },
});
