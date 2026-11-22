-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('PENDING', 'VALIDATING', 'IN_PROGRESS', 'WAITING_EXTERNAL', 'COMPLETED', 'FAILED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "adminEmail" TEXT NOT NULL,
    "adminName" TEXT NOT NULL,
    "status" "DeploymentStatus" NOT NULL DEFAULT 'PENDING',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "totalSteps" INTEGER NOT NULL DEFAULT 5,
    "errorMessage" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeploymentStep" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "StepStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "metadata" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeploymentStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeploymentConfig" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "supabaseProjectRef" TEXT,
    "supabaseRegion" TEXT,
    "renderServiceId" TEXT,
    "netlifySiteId" TEXT,
    "customDomain" TEXT,
    "repo" TEXT,
    "branch" TEXT,
    "dockerfilePath" TEXT,
    "publicApiUrl" TEXT,
    "allowedOrigins" TEXT,
    "mercadoPagoEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mercadoPagoMode" TEXT DEFAULT 'sandbox',
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpUser" TEXT,
    "smtpFrom" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeploymentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeploymentSecret" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'deployment',
    "key" TEXT NOT NULL,
    "valueEncrypted" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeploymentSecret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalSecret" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "key" TEXT NOT NULL,
    "valueEncrypted" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalSecret_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Deployment_slug_key" ON "Deployment"("slug");

-- CreateIndex
CREATE INDEX "DeploymentStep_deploymentId_idx" ON "DeploymentStep"("deploymentId");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentStep_deploymentId_stepNumber_key" ON "DeploymentStep"("deploymentId", "stepNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentConfig_deploymentId_key" ON "DeploymentConfig"("deploymentId");

-- CreateIndex
CREATE INDEX "DeploymentSecret_deploymentId_idx" ON "DeploymentSecret"("deploymentId");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentSecret_deploymentId_scope_key_key" ON "DeploymentSecret"("deploymentId", "scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "GlobalSecret_scope_key_key" ON "GlobalSecret"("scope", "key");

-- AddForeignKey
ALTER TABLE "DeploymentStep" ADD CONSTRAINT "DeploymentStep_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentConfig" ADD CONSTRAINT "DeploymentConfig_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

