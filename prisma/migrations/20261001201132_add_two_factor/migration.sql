-- AlterTable: 2FA (TOTP) en users. Columnas aditivas, no destructivas.
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "twoFactorSecret" TEXT;

