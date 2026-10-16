CREATE TABLE `reminder_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`event_id` int NOT NULL,
	`user_id` int NOT NULL DEFAULT 0,
	`kind` enum('day','hour','digest') NOT NULL,
	`for_starts_at` datetime NOT NULL,
	`sent_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `reminder_log_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_reminder_log` UNIQUE(`event_id`,`user_id`,`kind`,`for_starts_at`)
);
--> statement-breakpoint
CREATE TABLE `reminder_prefs` (
	`user_id` int NOT NULL,
	`day_before` boolean NOT NULL DEFAULT false,
	`hour_before` boolean NOT NULL DEFAULT false,
	`disabled_reason` varchar(100),
	CONSTRAINT `reminder_prefs_user_id` PRIMARY KEY(`user_id`)
);
--> statement-breakpoint
ALTER TABLE `reminder_log` ADD CONSTRAINT `reminder_log_event_id_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reminder_prefs` ADD CONSTRAINT `reminder_prefs_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;