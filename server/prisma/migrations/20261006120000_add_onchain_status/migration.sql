-- CreateEnum
CREATE TYPE "OnChainStatus" AS ENUM ('NOT_REGISTERED', 'REGISTERED', 'FAILED');

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN "receiverEmail" TEXT;
ALTER TABLE "Shipment" ADD COLUMN "adminFlagged" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Shipment" ADD COLUMN "assignedSensorId" TEXT;
ALTER TABLE "Shipment" ADD COLUMN "onChainStatus" "OnChainStatus" NOT NULL DEFAULT 'NOT_REGISTERED';

-- AlterTable
ALTER TABLE "SensorReading" ADD COLUMN "simulatedLocation" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
