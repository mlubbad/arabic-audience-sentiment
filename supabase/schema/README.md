# Schema snapshot

`current.sql` is a generated snapshot of the schema after every migration has been applied to a fresh PGlite database; it is generated, never hand-edited. Regenerate it with `npm run db:snapshot`, or check that it is current with `npm run db:snapshot:check`.
