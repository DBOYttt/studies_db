CREATE TABLE `class_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`uid` varchar(100) NOT NULL,
	`occurrence_start` datetime NOT NULL,
	`subject_id` int NOT NULL,
	`class_id` int,
	`group_id` int,
	`lecturer_id` int,
	`label` varchar(100),
	`room` varchar(100),
	`starts_at` datetime NOT NULL,
	`ends_at` datetime NOT NULL,
	`status` enum('confirmed','cancelled') NOT NULL DEFAULT 'confirmed',
	`sequence` int NOT NULL DEFAULT 0,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `class_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_class_sessions_occurrence` UNIQUE(`uid`,`occurrence_start`)
);
--> statement-breakpoint
CREATE TABLE `plan_sync` (
	`id` int NOT NULL,
	`requested_at` datetime,
	`last_run_at` datetime,
	`last_ok_at` datetime,
	`last_error` text,
	`stats` json,
	CONSTRAINT `plan_sync_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `classes` MODIFY COLUMN `kind` enum('wyklad','laboratorium','cwiczenia','projekt','seminarium','praktyczne','wf') NOT NULL;--> statement-breakpoint
ALTER TABLE `subjects` MODIFY COLUMN `discord_channel_id` varchar(32);--> statement-breakpoint
ALTER TABLE `classes` ADD `assessment` enum('egzamin','kolokwium','projekt','sprawozdania','zaliczenie');--> statement-breakpoint
ALTER TABLE `classes` ADD `assessment_note` varchar(500);--> statement-breakpoint
ALTER TABLE `classes` ADD `platform_url` varchar(500);--> statement-breakpoint
ALTER TABLE `lecturers` ADD `office_hours` varchar(500);--> statement-breakpoint
ALTER TABLE `lecturers` ADD `room` varchar(100);--> statement-breakpoint
ALTER TABLE `subjects` ADD `platform_url` varchar(500);--> statement-breakpoint
ALTER TABLE `subjects` ADD `unitime_name` varchar(200);--> statement-breakpoint
ALTER TABLE `lecturers` ADD CONSTRAINT `lecturers_email_unique` UNIQUE(`email`);--> statement-breakpoint
ALTER TABLE `subjects` ADD CONSTRAINT `subjects_unitime_name_unique` UNIQUE(`unitime_name`);--> statement-breakpoint
ALTER TABLE `class_sessions` ADD CONSTRAINT `class_sessions_subject_id_subjects_id_fk` FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `class_sessions` ADD CONSTRAINT `class_sessions_class_id_classes_id_fk` FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `class_sessions` ADD CONSTRAINT `class_sessions_group_id_class_groups_id_fk` FOREIGN KEY (`group_id`) REFERENCES `class_groups`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `class_sessions` ADD CONSTRAINT `class_sessions_lecturer_id_lecturers_id_fk` FOREIGN KEY (`lecturer_id`) REFERENCES `lecturers`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_class_sessions_starts` ON `class_sessions` (`starts_at`);--> statement-breakpoint
CREATE OR REPLACE VIEW `v_subjects` AS SELECT `id`, `name`, `code`, `semester`, `ects`, `description`, `discord_channel_id`, `created_at`, `platform_url`, `unitime_name` FROM `subjects`;--> statement-breakpoint
CREATE OR REPLACE VIEW `v_lecturers` AS SELECT `id`, `name`, `title`, `email`, `office_hours`, `room` FROM `lecturers`;--> statement-breakpoint
CREATE OR REPLACE VIEW `v_classes` AS SELECT `id`, `subject_id`, `kind`, `name`, `assessment`, `assessment_note`, `platform_url` FROM `classes`;--> statement-breakpoint
CREATE OR REPLACE VIEW `v_class_sessions` AS SELECT `cs`.`id` AS `id`, `cs`.`starts_at` AS `starts_at`, `cs`.`ends_at` AS `ends_at`, `cs`.`subject_id` AS `subject_id`, `s`.`name` AS `subject_name`, `cs`.`class_id` AS `class_id`, `c`.`kind` AS `class_kind`, `c`.`name` AS `class_name`, `cs`.`group_id` AS `group_id`, `g`.`name` AS `group_name`, `cs`.`lecturer_id` AS `lecturer_id`, `l`.`name` AS `lecturer_name`, `cs`.`room` AS `room`, `cs`.`label` AS `label`, `cs`.`status` AS `status` FROM `class_sessions` `cs` JOIN `subjects` `s` ON `s`.`id` = `cs`.`subject_id` LEFT JOIN `classes` `c` ON `c`.`id` = `cs`.`class_id` LEFT JOIN `class_groups` `g` ON `g`.`id` = `cs`.`group_id` LEFT JOIN `lecturers` `l` ON `l`.`id` = `cs`.`lecturer_id`;--> statement-breakpoint
INSERT IGNORE INTO `plan_sync` (`id`) VALUES (1);
