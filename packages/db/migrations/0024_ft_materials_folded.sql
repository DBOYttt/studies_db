-- Search ignores ł like the other Polish diacritics (utf8mb4_unicode_ci does
-- not): file names are folded in search_name (searchNameFor) and file text in
-- the generated search_text column (0023), and the FULLTEXT index moves to it.
UPDATE `materials` SET `search_name` = REPLACE(REPLACE(`search_name`, 'ł', 'l'), 'Ł', 'L') WHERE `search_name` LIKE BINARY '%ł%' OR `search_name` LIKE BINARY '%Ł%';--> statement-breakpoint
ALTER TABLE `materials` DROP INDEX `ft_materials`;--> statement-breakpoint
ALTER TABLE `materials` ADD FULLTEXT `ft_materials` (`search_name`, `search_text`);
