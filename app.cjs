// Hosting entry point: works when launched directly or loaded by Passenger.
// Keep server.mjs as the implementation; do not duplicate application logic.
process.umask(0o077);
const passenger = typeof PhusionPassenger !== "undefined";
if (passenger) PhusionPassenger.configure({ autoInstall: false });

(async () => {
  if (process.env.PREVIEW_MODE === "1")
    throw new Error("The hosting entry point does not allow preview access.");
  const { openDatabase } = await import("./db.mjs");
  const { createApp } = await import("./server.mjs");
  const db = openDatabase();
  try {
    if (db.prepare("SELECT value FROM metadata WHERE key='preview'").get()?.value === "1")
      throw new Error("Use a fresh production database, not the fictional preview database.");
    const port = Number(process.env.PORT || 5005);
    if (!passenger && (!Number.isInteger(port) || port < 0 || port > 65535))
      throw new Error("PORT must be a valid port number.");
    const server = createApp({ db });
    server.on("error", (error) => {
      console.error(`CABC startup error: ${error.message}`);
      db.close();
      process.exitCode = 1;
    });
    const ready = () => console.log(passenger ? "CABC ready under Passenger." : `CABC ready on port ${server.address().port}.`);
    if (passenger) server.listen("passenger", ready);
    else server.listen(port, "0.0.0.0", ready);
    for (const signal of ["SIGTERM", "SIGINT"])
      process.once(signal, () => server.close(() => { db.close(); process.exit(0); }));
  } catch (error) { db.close(); throw error; }
})().catch((error) => {
  console.error(`CABC startup error: ${error.message}`);
  process.exitCode = 1;
});
