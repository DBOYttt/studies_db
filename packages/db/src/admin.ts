// Admin-only entry point (migrations, DB users). Not part of the main index
// so app bundles never pull in the migrator.
export { runMigrations } from './migrate.js';
export { ensureReadonlyUser } from './readonly-user.js';
