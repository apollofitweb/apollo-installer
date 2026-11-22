-- CreateTable
CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "adminEmail" TEXT NOT NULL,
    "adminName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "totalSteps" INTEGER NOT NULL DEFAULT 6,
    "errorMessage" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME
);

-- CreateTable
CREATE TABLE "DeploymentStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deploymentId" TEXT NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DeploymentStep_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeploymentConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deploymentId" TEXT NOT NULL,
    "supabaseProjectRef" TEXT,
    "supabaseRegion" TEXT,
    "renderServiceId" TEXT,
    "netlifySiteId" TEXT,
    "netlifyDomain" TEXT,
    "customDomain" TEXT,
    "jwtAccessSecret" TEXT,
    "jwtRefreshSecret" TEXT,
    "allowedOrigins" TEXT,
    "mercadoPagoEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mercadoPagoMode" TEXT DEFAULT 'sandbox',
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpUser" TEXT,
    "smtpPass" TEXT,
    "smtpFrom" TEXT,
    "repo" TEXT,
    "branch" TEXT,
    "dockerfilePath" TEXT,
    "publicApiUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DeploymentConfig_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Deployment_slug_key" ON "Deployment"("slug");

-- CreateIndex
CREATE INDEX "DeploymentStep_deploymentId_idx" ON "DeploymentStep"("deploymentId");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentStep_deploymentId_stepNumber_key" ON "DeploymentStep"("deploymentId", "stepNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentConfig_deploymentId_key" ON "DeploymentConfig"("deploymentId");
