CREATE TABLE `web_uploads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`event_id` int NOT NULL,
	`user_id` int NOT NULL,
	`storage_path` varchar(255) NOT NULL,
	`original_filename` varchar(255) NOT NULL,
	`size_bytes` bigint NOT NULL,
	`status` enum('queued','posting','done','failed') NOT NULL DEFAULT 'queued',
	`error` varchar(500),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`finished_at` datetime,
	CONSTRAINT `web_uploads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `web_uploads` ADD CONSTRAINT `web_uploads_event_id_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `web_uploads` ADD CONSTRAINT `web_uploads_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_web_uploads_event` ON `web_uploads` (`event_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_web_uploads_status` ON `web_uploads` (`status`,`created_at`);