CREATE TABLE `class_groups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`class_id` int NOT NULL,
	`number` smallint NOT NULL,
	`name` varchar(20) NOT NULL,
	CONSTRAINT `class_groups_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_class_groups_class_number` UNIQUE(`class_id`,`number`)
);
--> statement-breakpoint
CREATE TABLE `class_lecturers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`class_id` int NOT NULL,
	`lecturer_id` int NOT NULL,
	`group_id` int,
	CONSTRAINT `class_lecturers_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_class_lecturers` UNIQUE(`class_id`,`lecturer_id`,`group_id`)
);
--> statement-breakpoint
CREATE TABLE `classes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`subject_id` int NOT NULL,
	`kind` enum('wyklad','laboratorium','cwiczenia','projekt','seminarium') NOT NULL,
	`name` varchar(50) NOT NULL,
	CONSTRAINT `classes_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_classes_subject_kind` UNIQUE(`subject_id`,`kind`)
);
--> statement-breakpoint
ALTER TABLE `topics` ADD `class_id` int;--> statement-breakpoint
ALTER TABLE `topics` ADD `group_id` int;--> statement-breakpoint
ALTER TABLE `class_groups` ADD CONSTRAINT `class_groups_class_id_classes_id_fk` FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `class_lecturers` ADD CONSTRAINT `class_lecturers_class_id_classes_id_fk` FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `class_lecturers` ADD CONSTRAINT `class_lecturers_lecturer_id_lecturers_id_fk` FOREIGN KEY (`lecturer_id`) REFERENCES `lecturers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `class_lecturers` ADD CONSTRAINT `class_lecturers_group_id_class_groups_id_fk` FOREIGN KEY (`group_id`) REFERENCES `class_groups`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `classes` ADD CONSTRAINT `classes_subject_id_subjects_id_fk` FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `topics` ADD CONSTRAINT `topics_class_id_classes_id_fk` FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `topics` ADD CONSTRAINT `topics_group_id_class_groups_id_fk` FOREIGN KEY (`group_id`) REFERENCES `class_groups`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_topics_class` ON `topics` (`class_id`);--> statement-breakpoint
CREATE INDEX `idx_topics_group` ON `topics` (`group_id`);