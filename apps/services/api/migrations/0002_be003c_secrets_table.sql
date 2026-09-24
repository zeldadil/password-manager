CREATE TABLE `secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`user_id` text NOT NULL,
	`ciphertext` blob NOT NULL,
	`iv` blob NOT NULL,
	`tag` blob NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_secrets_resource_id` ON `secrets` (`resource_id`);--> statement-breakpoint
CREATE INDEX `idx_secrets_user_id` ON `secrets` (`user_id`);