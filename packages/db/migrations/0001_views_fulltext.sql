ALTER TABLE `materials` ADD FULLTEXT `ft_materials` (`original_filename`, `extracted_text`);--> statement-breakpoint
ALTER TABLE `topics` ADD FULLTEXT `ft_topics` (`title`);--> statement-breakpoint
CREATE OR REPLACE VIEW `v_subjects` AS SELECT `id`, `name`, `code`, `semester`, `ects`, `description`, `discord_channel_id`, `created_at` FROM `subjects`;--> statement-breakpoint
CREATE OR REPLACE VIEW `v_lecturers` AS SELECT `id`, `name`, `title`, `email` FROM `lecturers`;--> statement-breakpoint
CREATE OR REPLACE VIEW `v_subject_lecturers` AS SELECT `subject_id`, `lecturer_id`, `role` FROM `subject_lecturers`;--> statement-breakpoint
CREATE OR REPLACE VIEW `v_topics` AS SELECT `id`, `subject_id`, `title`, `discord_thread_id`, `created_by`, `created_at` FROM `topics` WHERE `deleted_at` IS NULL;--> statement-breakpoint
CREATE OR REPLACE VIEW `v_tags` AS SELECT `id`, `subject_id`, `name`, `discord_tag_id` FROM `tags`;--> statement-breakpoint
CREATE OR REPLACE VIEW `v_topic_tags` AS SELECT `topic_id`, `tag_id` FROM `topic_tags`;--> statement-breakpoint
CREATE OR REPLACE VIEW `v_materials` AS SELECT `id`, `topic_id`, `uploader_id`, `original_filename`, `mime_type`, `size_bytes`, `preview_kind`, `status`, `created_at` FROM `materials` WHERE `deleted_at` IS NULL;--> statement-breakpoint
CREATE OR REPLACE VIEW `v_users` AS SELECT `id`, `display_name`, `created_at` FROM `users`;
