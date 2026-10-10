CREATE TABLE `bot_state` (
	`subject_id` int NOT NULL,
	`last_synced_at` datetime,
	CONSTRAINT `bot_state_subject_id` PRIMARY KEY(`subject_id`)
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`material_id` int NOT NULL,
	`type` enum('convert','extract_text') NOT NULL,
	`status` enum('queued','running','done','failed') NOT NULL DEFAULT 'queued',
	`attempts` tinyint NOT NULL DEFAULT 0,
	`last_error` text,
	`run_after` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`locked_at` datetime,
	CONSTRAINT `jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `lecturers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(200) NOT NULL,
	`title` varchar(50),
	`email` varchar(200),
	CONSTRAINT `lecturers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `login_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`token_hash` char(64) NOT NULL,
	`expires_at` datetime NOT NULL,
	`used_at` datetime,
	CONSTRAINT `login_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `login_tokens_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `materials` (
	`id` int AUTO_INCREMENT NOT NULL,
	`topic_id` int NOT NULL,
	`uploader_id` int NOT NULL,
	`discord_message_id` varchar(32) NOT NULL,
	`discord_attachment_id` varchar(32) NOT NULL,
	`original_filename` varchar(500) NOT NULL,
	`mime_type` varchar(150) NOT NULL,
	`size_bytes` bigint NOT NULL,
	`sha256` char(64) NOT NULL,
	`storage_path` varchar(500) NOT NULL,
	`preview_path` varchar(500),
	`preview_kind` enum('pdf','image','text','none') NOT NULL,
	`extracted_text` mediumtext,
	`status` enum('pending','ready','failed') NOT NULL DEFAULT 'pending',
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`deleted_at` datetime,
	CONSTRAINT `materials_id` PRIMARY KEY(`id`),
	CONSTRAINT `materials_discord_attachment_id_unique` UNIQUE(`discord_attachment_id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`token_hash` char(64) NOT NULL,
	`expires_at` datetime NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `sessions_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `subject_lecturers` (
	`subject_id` int NOT NULL,
	`lecturer_id` int NOT NULL,
	`role` enum('wyklad','laboratorium','cwiczenia','projekt') NOT NULL,
	CONSTRAINT `subject_lecturers_subject_id_lecturer_id_role_pk` PRIMARY KEY(`subject_id`,`lecturer_id`,`role`)
);
--> statement-breakpoint
CREATE TABLE `subjects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(200) NOT NULL,
	`code` varchar(20) NOT NULL,
	`semester` tinyint NOT NULL,
	`ects` tinyint NOT NULL,
	`description` text,
	`discord_channel_id` varchar(32) NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `subjects_id` PRIMARY KEY(`id`),
	CONSTRAINT `subjects_code_unique` UNIQUE(`code`),
	CONSTRAINT `subjects_discord_channel_id_unique` UNIQUE(`discord_channel_id`)
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` int AUTO_INCREMENT NOT NULL,
	`subject_id` int NOT NULL,
	`name` varchar(50) NOT NULL,
	`discord_tag_id` varchar(32) NOT NULL,
	CONSTRAINT `tags_id` PRIMARY KEY(`id`),
	CONSTRAINT `tags_discord_tag_id_unique` UNIQUE(`discord_tag_id`)
);
--> statement-breakpoint
CREATE TABLE `topic_tags` (
	`topic_id` int NOT NULL,
	`tag_id` int NOT NULL,
	CONSTRAINT `topic_tags_topic_id_tag_id_pk` PRIMARY KEY(`topic_id`,`tag_id`)
);
--> statement-breakpoint
CREATE TABLE `topics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`subject_id` int NOT NULL,
	`title` varchar(300) NOT NULL,
	`discord_thread_id` varchar(32) NOT NULL,
	`created_by` int,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`deleted_at` datetime,
	CONSTRAINT `topics_id` PRIMARY KEY(`id`),
	CONSTRAINT `topics_discord_thread_id_unique` UNIQUE(`discord_thread_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`discord_user_id` varchar(32) NOT NULL,
	`display_name` varchar(100) NOT NULL,
	`avatar_url` varchar(500),
	`is_banned` boolean NOT NULL DEFAULT false,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_discord_user_id_unique` UNIQUE(`discord_user_id`)
);
--> statement-breakpoint
ALTER TABLE `bot_state` ADD CONSTRAINT `bot_state_subject_id_subjects_id_fk` FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `jobs` ADD CONSTRAINT `jobs_material_id_materials_id_fk` FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `login_tokens` ADD CONSTRAINT `login_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `materials` ADD CONSTRAINT `materials_topic_id_topics_id_fk` FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `materials` ADD CONSTRAINT `materials_uploader_id_users_id_fk` FOREIGN KEY (`uploader_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subject_lecturers` ADD CONSTRAINT `subject_lecturers_subject_id_subjects_id_fk` FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subject_lecturers` ADD CONSTRAINT `subject_lecturers_lecturer_id_lecturers_id_fk` FOREIGN KEY (`lecturer_id`) REFERENCES `lecturers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tags` ADD CONSTRAINT `tags_subject_id_subjects_id_fk` FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `topic_tags` ADD CONSTRAINT `topic_tags_topic_id_topics_id_fk` FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `topic_tags` ADD CONSTRAINT `topic_tags_tag_id_tags_id_fk` FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `topics` ADD CONSTRAINT `topics_subject_id_subjects_id_fk` FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `topics` ADD CONSTRAINT `topics_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_jobs_status_run_after` ON `jobs` (`status`,`run_after`);--> statement-breakpoint
CREATE INDEX `idx_materials_sha256` ON `materials` (`sha256`);--> statement-breakpoint
CREATE INDEX `idx_materials_message` ON `materials` (`discord_message_id`);