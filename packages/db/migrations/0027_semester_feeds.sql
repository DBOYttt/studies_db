CREATE TABLE `unitime_feeds` (
	`semester` tinyint NOT NULL,
	`class_url` varchar(500) NOT NULL,
	`exam_url` varchar(500),
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_by` int,
	CONSTRAINT `unitime_feeds_semester` PRIMARY KEY(`semester`),
	CONSTRAINT `chk_unitime_feeds_semester` CHECK(`unitime_feeds`.`semester` BETWEEN 1 AND 7)
);
--> statement-breakpoint
ALTER TABLE `class_sessions` ADD `feed_semester` tinyint;--> statement-breakpoint
ALTER TABLE `unitime_feeds` ADD CONSTRAINT `unitime_feeds_updated_by_users_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;