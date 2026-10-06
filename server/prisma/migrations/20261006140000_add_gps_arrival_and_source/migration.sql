-- CreateEnum
CREATE TYPE "ReadingSource" AS ENUM ('GPS', 'SIMULATED');

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN "destLat" DOUBLE PRECISION,
ADD COLUMN "destLon" DOUBLE PRECISION,
ADD COLUMN "arrivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SensorReading" DROP COLUMN IF EXISTS "simulatedLocation",
ADD COLUMN "source" "ReadingSource" NOT NULL DEFAULT 'GPS';
