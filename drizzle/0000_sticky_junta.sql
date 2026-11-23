CREATE TABLE "admin_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"claimed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admin_config_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "campus_locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"radius_meters" integer DEFAULT 95 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "campus_locations_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "complaint_images" (
	"id" text PRIMARY KEY NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data_base64" text NOT NULL,
	"uploaded_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "complaints" (
	"id" serial PRIMARY KEY NOT NULL,
	"complaint_code" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"location" text NOT NULL,
	"building_block" text NOT NULL,
	"floor_room" text DEFAULT 'Not specified' NOT NULL,
	"status" text DEFAULT 'Reported' NOT NULL,
	"student_user_id" integer,
	"student_name" text NOT NULL,
	"roll_number" text NOT NULL,
	"student_mobile" text NOT NULL,
	"image_id" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "complaints_complaint_code_unique" UNIQUE("complaint_code")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"uid" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'student' NOT NULL,
	"roll_number" text,
	"mobile_number" text,
	"department" text,
	"password_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_uid_unique" UNIQUE("uid"),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_roll_number_unique" UNIQUE("roll_number")
);
--> statement-breakpoint
ALTER TABLE "complaint_images" ADD CONSTRAINT "complaint_images_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_image_id_complaint_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."complaint_images"("id") ON DELETE set null ON UPDATE no action;