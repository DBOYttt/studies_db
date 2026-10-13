CREATE TABLE `bot_settings` (
	`key` varchar(50) NOT NULL,
	`value` varchar(200) NOT NULL,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `bot_settings_key` PRIMARY KEY(`key`)
);
