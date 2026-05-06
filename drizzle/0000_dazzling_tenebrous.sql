CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_id" uuid,
	"kb_id" uuid,
	"content" text NOT NULL,
	"page_num" integer,
	"section_title" text,
	"chunk_index" integer NOT NULL,
	"embedding" vector(1536),
	"keywords" text[],
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"department" text NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kb_id" uuid,
	"filename" text NOT NULL,
	"file_type" text NOT NULL,
	"content_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "kb_permissions" (
	"kb_id" uuid NOT NULL,
	"department" text NOT NULL,
	"can_read" boolean DEFAULT true,
	"can_write" boolean DEFAULT false,
	CONSTRAINT "kb_permissions_kb_id_department_pk" PRIMARY KEY("kb_id","department")
);
--> statement-breakpoint
CREATE TABLE "knowledge_bases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"department" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"sources" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_kb_id_knowledge_bases_id_fk" FOREIGN KEY ("kb_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_kb_id_knowledge_bases_id_fk" FOREIGN KEY ("kb_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_permissions" ADD CONSTRAINT "kb_permissions_kb_id_knowledge_bases_id_fk" FOREIGN KEY ("kb_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;