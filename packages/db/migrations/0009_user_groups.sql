CREATE TABLE `user_groups` (
	`user_id` int NOT NULL,
	`class_id` int NOT NULL,
	`group_id` int NOT NULL,
	CONSTRAINT `user_groups_user_id_class_id_pk` PRIMARY KEY(`user_id`,`class_id`)
);
--> statement-breakpoint
ALTER TABLE `user_groups` ADD CONSTRAINT `user_groups_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_groups` ADD CONSTRAINT `user_groups_class_id_classes_id_fk` FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_groups` ADD CONSTRAINT `user_groups_group_id_class_groups_id_fk` FOREIGN KEY (`group_id`) REFERENCES `class_groups`(`id`) ON DELETE cascade ON UPDATE no action;