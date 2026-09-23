-- AlterTable
ALTER TABLE "Chapter" ADD COLUMN     "needsReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewReason" TEXT,
ADD COLUMN     "unitNumber" INTEGER;
