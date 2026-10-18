ALTER TABLE `event_series` ADD `version` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `version` int DEFAULT 0 NOT NULL;