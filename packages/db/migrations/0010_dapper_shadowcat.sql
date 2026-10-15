CREATE TABLE `bot_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`kind` varchar(40) NOT NULL,
	`target` varchar(100) NOT NULL,
	`status` enum('queued','running','done','failed') NOT NULL DEFAULT 'queued',
	`payload` json,
	`error` varchar(500),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`started_at` datetime,
	`finished_at` datetime,
	CONSTRAINT `bot_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `event_topics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`event_id` int NOT NULL,
	`topic_id` int NOT NULL,
	CONSTRAINT `event_topics_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_event_topics` UNIQUE(`event_id`,`topic_id`)
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`kind` enum('kolokwium','egzamin','wyjazd','zajecia_dodatkowe','inne') NOT NULL,
	`title` varchar(100) NOT NULL,
	`subject_id` int,
	`class_id` int,
	`group_id` int,
	`starts_at` datetime NOT NULL,
	`ends_at` datetime,
	`all_day` boolean NOT NULL DEFAULT false,
	`place` varchar(100),
	`note` varchar(1000),
	`topic_id` int,
	`created_by` int,
	`updated_by` int,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`deleted_at` datetime,
	CONSTRAINT `events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `topics` MODIFY COLUMN `subject_id` int;--> statement-breakpoint
ALTER TABLE `event_topics` ADD CONSTRAINT `event_topics_event_id_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_topics` ADD CONSTRAINT `event_topics_topic_id_topics_id_fk` FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `events` ADD CONSTRAINT `events_subject_id_subjects_id_fk` FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `events` ADD CONSTRAINT `events_class_id_classes_id_fk` FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `events` ADD CONSTRAINT `events_group_id_class_groups_id_fk` FOREIGN KEY (`group_id`) REFERENCES `class_groups`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `events` ADD CONSTRAINT `events_topic_id_topics_id_fk` FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `events` ADD CONSTRAINT `events_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `events` ADD CONSTRAINT `events_updated_by_users_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_bot_requests_status` ON `bot_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_events_starts` ON `events` (`starts_at`);--> statement-breakpoint
CREATE INDEX `idx_events_subject_starts` ON `events` (`subject_id`,`starts_at`);