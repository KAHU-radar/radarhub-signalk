#!/usr/bin/env node
/**
 * kahu-signalk uses Node's built-in node:sqlite (no native sqlite3 bindings).
 * Requires Node 22.5+ where DatabaseSync is available.
 */
const [major, minor] = process.versions.node.split('.').map(Number);
const ok = major > 22 || (major === 22 && minor >= 5);
if (!ok) {
  console.error(
    '\nkahu-signalk requires Node.js 22.5.0 or later.\n' +
      'This plugin uses the built-in SQLite module (node:sqlite) so it does not depend on native sqlite3 binaries.\n' +
      'Signal K recommends Node 22: https://github.com/SignalK/signalk-server/wiki/Installing-and-Updating-Node.js\n' +
      `Current Node version: ${process.version}\n`
  );
  process.exit(1);
}
