CREATE TABLE `class_mark_skips` (
	`id` int AUTO_INCREMENT NOT NULL,
	`mark_id` int NOT NULL,
	`on_date` date NOT NULL,
	`created_by` int,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `class_mark_skips_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_class_mark_skips_mark_date` UNIQUE(`mark_id`,`on_date`)
);
--> statement-breakpoint
CREATE TABLE `class_marks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`class_id` int NOT NULL,
	`group_id` int,
	`kind` enum('wejsciowka') NOT NULL,
	`note` varchar(200),
	`created_by` int,
	`updated_by` int,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`deleted_at` datetime,
	`version` int NOT NULL DEFAULT 0,
	CONSTRAINT `class_marks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `class_sessions` ADD `kind` enum('class','exam') DEFAULT 'class' NOT NULL;--> statement-breakpoint
ALTER TABLE `class_mark_skips` ADD CONSTRAINT `class_mark_skips_mark_id_class_marks_id_fk` FOREIGN KEY (`mark_id`) REFERENCES `class_marks`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `class_mark_skips` ADD CONSTRAINT `class_mark_skips_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `class_marks` ADD CONSTRAINT `class_marks_class_id_classes_id_fk` FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `class_marks` ADD CONSTRAINT `class_marks_group_id_class_groups_id_fk` FOREIGN KEY (`group_id`) REFERENCES `class_groups`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `class_marks` ADD CONSTRAINT `class_marks_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `class_marks` ADD CONSTRAINT `class_marks_updated_by_users_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_class_marks_class` ON `class_marks` (`class_id`,`group_id`,`kind`);