-- Files of a soft-deleted topic disappear from v_materials, as they already do from v_files.
-- A plain JOIN on topics only (not subjects): files of subject-less event topics stay listed.
CREATE OR REPLACE VIEW `v_materials` AS SELECT `m`.`id`, `m`.`topic_id`, `m`.`uploader_id`, `m`.`original_filename`, `m`.`mime_type`, `m`.`size_bytes`, `m`.`preview_kind`, `m`.`status`, `m`.`created_at` FROM `materials` `m` JOIN `topics` `t` ON `t`.`id` = `m`.`topic_id` AND `t`.`deleted_at` IS NULL WHERE `m`.`deleted_at` IS NULL;
