CREATE TABLE `event_series` (
	`id` int AUTO_INCREMENT NOT NULL,
	`rule` enum('weekly','biweekly') NOT NULL,
	`until` date NOT NULL,
	`topic_id` int,
	`created_by` int,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`deleted_at` datetime,
	CONSTRAINT `event_series_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `event_topics` MODIFY COLUMN `event_id` int;--> statement-breakpoint
ALTER TABLE `event_topics` ADD `series_id` int;--> statement-breakpoint
ALTER TABLE `events` ADD `series_id` int;--> statement-breakpoint
ALTER TABLE `event_topics` ADD CONSTRAINT `uq_event_topics_series` UNIQUE(`series_id`,`topic_id`);--> statement-breakpoint
ALTER TABLE `event_series` ADD CONSTRAINT `event_series_topic_id_topics_id_fk` FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_series` ADD CONSTRAINT `event_series_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_topics` ADD CONSTRAINT `chk_event_topics_owner` CHECK ((`event_topics`.`event_id` IS NULL) <> (`event_topics`.`series_id` IS NULL));--> statement-breakpoint
ALTER TABLE `event_topics` ADD CONSTRAINT `event_topics_series_id_event_series_id_fk` FOREIGN KEY (`series_id`) REFERENCES `event_series`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `events` ADD CONSTRAINT `events_series_id_event_series_id_fk` FOREIGN KEY (`series_id`) REFERENCES `event_series`(`id`) ON DELETE no action ON UPDATE no action;