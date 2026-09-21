// This file must be the FIRST import in register.test.ts
// so process.env.DATABASE_URL is set before db.ts evaluates.
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  `/tmp/pm-test-${Math.random().toString(36).slice(2)}.db`;
