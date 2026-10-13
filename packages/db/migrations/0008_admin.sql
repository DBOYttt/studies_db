CREATE TABLE `admin_audit` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`action` varchar(50) NOT NULL,
	`target` varchar(100),
	`statement` mediumtext,
	`rows_affected` int,
	`details` json,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `admin_audit_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `is_admin` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `admin_audit` ADD CONSTRAINT `admin_audit_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_admin_audit_created_at` ON `admin_audit` (`created_at`);