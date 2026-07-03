-- CreateEnum
CREATE TYPE "Role" AS ENUM ('VELA_ADMIN', 'ADMIN', 'MEMBER');

-- AlterTable
-- Cast the existing "role" string column to the new enum in place, instead
-- of Prisma's default drop-and-recreate strategy (which would reset every
-- existing user's role to the column default, silently de-escalating any
-- ADMIN back to MEMBER). Existing values ('ADMIN', 'MEMBER') already match
-- enum labels exactly, so the cast is lossless.
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role" USING ("role"::"Role");
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'MEMBER';
