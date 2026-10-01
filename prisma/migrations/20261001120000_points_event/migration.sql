-- CreateTable
CREATE TABLE "PointsEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL,
    "orderId" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PointsEvent_shop_customerId_createdAt_idx" ON "PointsEvent"("shop", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "PointsEvent_shop_createdAt_idx" ON "PointsEvent"("shop", "createdAt");

