-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_tenantId_fkey";

-- AddForeignKey
-- Deleting a Tenant now cascades to its Users at the database level. This
-- backs the `force=true` flow on DELETE /tenants/:id: without force, the
-- route still blocks deletion via an application-level user count check
-- before ever reaching the database.
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
