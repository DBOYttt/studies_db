ALTER TABLE `materials` ADD `search_name` varchar(500) DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `materials` SET `search_name` = TRIM(REGEXP_REPLACE(REGEXP_REPLACE(`original_filename`, '[_.-]', ' '), '[[:space:]]+', ' '));--> statement-breakpoint
ALTER TABLE `materials` DROP INDEX `ft_materials`;--> statement-breakpoint
ALTER TABLE `materials` ADD FULLTEXT `ft_materials` (`search_name`, `extracted_text`);
