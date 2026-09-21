-- Migration: BE-002e — add rate-limiting columns to users table
-- Adds failedAttempts counter and lockedUntil timestamp for
-- wrong-password lockout (5 attempts → 15m lockout).

ALTER TABLE `users` ADD COLUMN `failed_attempts` integer NOT NULL DEFAULT 0;
ALTER TABLE `users` ADD COLUMN `locked_until` integer;
