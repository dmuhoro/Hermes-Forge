import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/Logger';

export interface ScaffoldingMetadata {
    projectName: string;
    nodeVersion: string;
    port: number;
    hasDatabase: boolean;
    dbType: 'postgres' | 'none';
}

export class CloudScaffolder {
    private static instance: CloudScaffolder | null = null;

    private constructor() {}

    public static getInstance(): CloudScaffolder {
        if (!CloudScaffolder.instance) {
            CloudScaffolder.instance = new CloudScaffolder();
        }
        return CloudScaffolder.instance;
    }

    private getWorkspaceRoot(): string {
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            return vscode.workspace.workspaceFolders[0].uri.fsPath;
        }
        return '';
    }

    public async readProjectMetadata(): Promise<ScaffoldingMetadata> {
        const root = this.getWorkspaceRoot();
        const metadata: ScaffoldingMetadata = {
            projectName: 'hermes-app',
            nodeVersion: '20-alpine',
            port: 3000,
            hasDatabase: false,
            dbType: 'none'
        };

        if (!root) return metadata;

        try {
            const pkgPath = path.join(root, 'package.json');
            const data = await fs.readFile(pkgPath, 'utf8');
            const parsed = JSON.parse(data);

            if (parsed.name) {
                metadata.projectName = parsed.name.replace(/[^a-zA-Z-]/g, '-').toLowerCase();
            }

            const enginesNode = parsed.engines?.node;
            if (enginesNode) {
                const cleanVer = enginesNode.replace(/[^0-9.]/g, '');
                if (cleanVer) {
                    metadata.nodeVersion = `${cleanVer.split('.')[0]}-alpine`;
                }
            }

            const deps = { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) };
            if (deps['pg'] || deps['postgres'] || deps['sequelize'] || deps['typeorm'] || deps['drizzle-orm']) {
                metadata.hasDatabase = true;
                metadata.dbType = 'postgres';
            }

            // Simple port detective logic
            const buildText = data + ' ' + (parsed.scripts?.start || '') + ' ' + (parsed.scripts?.dev || '');
            const portMatch = buildText.match(/port\s*[:=\s]\s*([0-9]{4,5})/i) || buildText.match(/--port\s+([0-9]{4,5})/i);
            if (portMatch && portMatch[1]) {
                metadata.port = parseInt(portMatch[1], 10);
            }
        } catch {
            // Ignore - fallback to defaults
        }

        return metadata;
    }

    public async scaffoldCloudEnvironment(): Promise<void> {
        const root = this.getWorkspaceRoot();
        if (!root) {
            vscode.window.showErrorMessage('Error: No active workspace found to scaffold cloud configurations.');
            return;
        }

        const meta = await this.readProjectMetadata();

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'HermesForge: Assembling Elite Infrastructure Specifications...',
            cancellable: false
        }, async (progress) => {
            try {
                // 1. Scaffold Dockerfile & .dockerignore
                progress.report({ message: 'Generating multi-stage Dockerfile...' });
                const dockerfile = this.generateDockerfile(meta);
                await fs.writeFile(path.join(root, 'Dockerfile'), dockerfile, 'utf8');

                progress.report({ message: 'Generating .dockerignore exclusion matrices...' });
                const dockerignore = this.generateDockerIgnore();
                await fs.writeFile(path.join(root, '.dockerignore'), dockerignore, 'utf8');

                // 2. Scaffold docker-compose.yml
                progress.report({ message: 'Synthesizing container compose file...' });
                const compose = this.generateCompose(meta);
                await fs.writeFile(path.join(root, 'docker-compose.yml'), compose, 'utf8');

                // 3. Scaffold Kubernetes Deployment/Manifests
                progress.report({ message: 'Structuring K8s micro-manifests...' });
                const k8sDir = path.join(root, 'k8s');
                await fs.mkdir(k8sDir, { recursive: true });

                const k8sDeployment = this.generateK8sDeployment(meta);
                await fs.writeFile(path.join(k8sDir, 'deployment.yaml'), k8sDeployment, 'utf8');

                const k8sSvcs = this.generateK8sServices(meta);
                await fs.writeFile(path.join(k8sDir, 'service.yaml'), k8sSvcs, 'utf8');

                const k8sIngress = this.generateK8sIngress(meta);
                await fs.writeFile(path.join(k8sDir, 'ingress.yaml'), k8sIngress, 'utf8');

                const k8sConfigMap = this.generateK8sConfigMap(meta);
                await fs.writeFile(path.join(k8sDir, 'configmap.yaml'), k8sConfigMap, 'utf8');

                // 4. Scaffold Helm Chart
                progress.report({ message: 'Assembling Helm charts...' });
                const helmDir = path.join(root, 'helm', meta.projectName);
                const helmTemplatesDir = path.join(helmDir, 'templates');
                await fs.mkdir(helmTemplatesDir, { recursive: true });

                await fs.writeFile(path.join(helmDir, 'Chart.yaml'), this.generateHelmChartYaml(meta), 'utf8');
                await fs.writeFile(path.join(helmDir, 'values.yaml'), this.generateHelmValuesYaml(meta), 'utf8');
                await fs.writeFile(path.join(helmTemplatesDir, 'deployment.yaml'), this.generateHelmDeployment(meta), 'utf8');
                await fs.writeFile(path.join(helmTemplatesDir, 'service.yaml'), this.generateHelmService(meta), 'utf8');
                await fs.writeFile(path.join(helmTemplatesDir, 'ingress.yaml'), this.generateHelmIngress(meta), 'utf8');

                // 5. Scaffold Terraform Configurations
                progress.report({ message: 'Assembling Terraform environment modules...' });
                const tfAwsDir = path.join(root, 'terraform', 'aws');
                const tfGcpDir = path.join(root, 'terraform', 'gcp');
                await fs.mkdir(tfAwsDir, { recursive: true });
                await fs.mkdir(tfGcpDir, { recursive: true });

                // Write AWS Terraform
                await fs.writeFile(path.join(tfAwsDir, 'main.tf'), this.generateAwsTerraformMain(meta), 'utf8');
                await fs.writeFile(path.join(tfAwsDir, 'variables.tf'), this.generateAwsTerraformVariables(meta), 'utf8');
                await fs.writeFile(path.join(tfAwsDir, 'outputs.tf'), this.generateAwsTerraformOutputs(meta), 'utf8');

                // Write GCP Terraform
                await fs.writeFile(path.join(tfGcpDir, 'main.tf'), this.generateGcpTerraformMain(meta), 'utf8');
                await fs.writeFile(path.join(tfGcpDir, 'variables.tf'), this.generateGcpTerraformVariables(meta), 'utf8');
                await fs.writeFile(path.join(tfGcpDir, 'outputs.tf'), this.generateGcpTerraformOutputs(meta), 'utf8');

                // 6. Scaffold CI Security Pipeline Checks
                progress.report({ message: 'Synthesizing pipeline scanning and lint automation...' });
                const githubDir = path.join(root, '.github', 'workflows');
                await fs.mkdir(githubDir, { recursive: true });
                await fs.writeFile(path.join(githubDir, 'security-scan.yml'), this.generateSecurityScanYml(meta), 'utf8');

                logger.info(`Successfully scaffolded complex cloud configurations for ${meta.projectName}`);
                vscode.window.showInformationMessage('Success! Multi-stage Dockerfile and full K8s orchestration manifests loaded into the active workspace.');
            } catch (err: any) {
                logger.error('Failed to generate cloud configs', err);
                vscode.window.showErrorMessage(`Infrastructure failure: ${err.message}`);
            }
        });
    }

    private generateDockerfile(meta: ScaffoldingMetadata): string {
        return `# =========================================================
# 🏛️ HermesForge Production-Grade Multi-Stage Dockerfile
# =========================================================

# Phase 1: Dependency Assembly
FROM node:${meta.nodeVersion} AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# Phase 2: Compiler Build Engine
FROM node:${meta.nodeVersion} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Run build block if present, else fallback safely
RUN npm run build || echo "No compiler build runner step needed."

# Phase 3: Ultra-lean Runtime Container
FROM node:${meta.nodeVersion} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=${meta.port}

# Create micro non-privileged service user to run safely
RUN addgroup --system --gid 1001 nodejs && \\
    adduser --system --uid 1001 expressjs

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder --chown=expressjs:nodejs /app/dist ./dist || COPY --from=builder --chown=expressjs:nodejs /app/src ./src

USER expressjs
EXPOSE ${meta.port}

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \\
  CMD node -e "require('http').get('http://localhost:' + process.env.PORT + '/health', (r) => { if(r.statusCode === 200) process.exit(0); else process.exit(1); })" || exit 1

CMD ["node", "dist/extension.js"]
`;
    }

    private generateDockerIgnore(): string {
        return `# 🚫 Docker Compilation Ignores
.git
.github
node_modules
dist
out
.vscode
.aistudio
vsix
.env
.env.local
.DS_Store
*.vsix
*.vsixmanifest
lifecycle_spec_*.md
.telemetry
.nyc_output
coverage
`;
    }

    private generateCompose(meta: ScaffoldingMetadata): string {
        const dbPart = meta.hasDatabase ? `
  postgres-db:
    image: postgres:15-alpine
    container_name: \${COMPOSE_PROJECT_NAME:-${meta.projectName}}-db
    environment:
      POSTGRES_DB: ${meta.projectName}_db
      POSTGRES_USER: hermes_admin
      POSTGRES_PASSWORD: super_secure_vault_password
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    networks:
      - app-net
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U hermes_admin -d ${meta.projectName}_db"]
      interval: 10s
      timeout: 5s
      retries: 5
` : '';

        const volumePart = meta.hasDatabase ? `
volumes:
  pgdata:
    driver: local
` : '';

        const dependsPart = meta.hasDatabase ? `
    depends_on:
      postgres-db:
        condition: service_healthy
` : '';

        const dbEnvPart = meta.hasDatabase ? `      DATABASE_URL: postgres://hermes_admin:super_secure_vault_password@postgres-db:5432/${meta.projectName}_db
` : '';

        return `# =========================================================
# 📦 HermesForge docker-compose Orchestration Profile
# =========================================================
version: '3.8'

services:
  web-app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: \${COMPOSE_PROJECT_NAME:-${meta.projectName}}-srv
    restart: always
    ports:
      - "${meta.port}:${meta.port}"
    environment:
      PORT: ${meta.port}
      NODE_ENV: production
${dbEnvPart}    networks:
      - app-net${dependsPart}

${dbPart}
networks:
  app-net:
    driver: bridge

${volumePart}
`;
    }

    private generateK8sDeployment(meta: ScaffoldingMetadata): string {
        return `# =========================================================
# ☸️ Production Kubernetes Deployment Manifest Sheet
# =========================================================
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${meta.projectName}-deployment
  namespace: default
  labels:
    app: ${meta.projectName}
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: ${meta.projectName}
  template:
    metadata:
      labels:
        app: ${meta.projectName}
    spec:
      containers:
      - name: ${meta.projectName}-container
        image: gcr.io/hermesforge-registry/${meta.projectName}:latest
        imagePullPolicy: IfNotPresent
        ports:
        - containerPort: ${meta.port}
        envFrom:
        - configMapRef:
            name: ${meta.projectName}-config
        resources:
          limits:
            cpu: "500m"
            memory: "512Mi"
          requests:
            cpu: "100m"
            memory: "128Mi"
        livenessProbe:
          httpGet:
            path: /health
            port: ${meta.port}
          initialDelaySeconds: 15
          periodSeconds: 20
        readinessProbe:
          httpGet:
            path: /health
            port: ${meta.port}
          initialDelaySeconds: 5
          periodSeconds: 10
`;
    }

    private generateK8sServices(meta: ScaffoldingMetadata): string {
        return `# =========================================================
# ☸️ Kubernetes ClusterIP Stable Service Definition
# =========================================================
apiVersion: v1
kind: Service
metadata:
  name: ${meta.projectName}-service
  namespace: default
spec:
  type: ClusterIP
  selector:
    app: ${meta.projectName}
  ports:
  - port: 80
    targetPort: ${meta.port}
    protocol: TCP
`;
    }

    private generateK8sIngress(meta: ScaffoldingMetadata): string {
        return `# =========================================================
# ☸️ Kubernetes Ingress Layer with TLS Annotation
# =========================================================
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${meta.projectName}-ingress
  namespace: default
  annotations:
    kubernetes.io/ingress.class: nginx
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  rules:
  - host: ${meta.projectName}.local
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: ${meta.projectName}-service
            port:
              number: 80
  tls:
  - hosts:
    - ${meta.projectName}.local
    secretName: ${meta.projectName}-tls-secret
`;
    }

    private generateK8sConfigMap(meta: ScaffoldingMetadata): string {
        return `# =========================================================
# ☸️ Kubernetes General Env ConfigMap
# =========================================================
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${meta.projectName}-config
  namespace: default
data:
  NODE_ENV: "production"
  PORT: "${meta.port}"
  LOG_LEVEL: "info"
`;
    }

    // =========================================================
    // 📦 HELM CHART GENERATION TEMPLATES
    // =========================================================

    private generateHelmChartYaml(meta: ScaffoldingMetadata): string {
        return `apiVersion: v2
name: ${meta.projectName}
description: A production-grade Helm Chart for ${meta.projectName} auto-generated by HermesForge
type: application
version: 1.0.0
appVersion: "1.0.0"
`;
    }

    private generateHelmValuesYaml(meta: ScaffoldingMetadata): string {
        return `# Default Helm Values for ${meta.projectName}
replicaCount: 2

image:
  repository: hermesforge-registry/${meta.projectName}
  pullPolicy: IfNotPresent
  tag: "latest"

service:
  type: ClusterIP
  port: 80
  targetPort: ${meta.port}

ingress:
  enabled: true
  className: "nginx"
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
  hosts:
    - host: ${meta.projectName}.local
      paths:
        - path: /
          pathType: Prefix

resources:
  limits:
    cpu: 100m
    memory: 128Mi
  requests:
    cpu: 100m
    memory: 128Mi

autoscaling:
  enabled: false
  minReplicas: 1
  maxReplicas: 10
  targetCPUUtilizationPercentage: 80

nodeSelector: {}
tolerations: []
affinity: {}
`;
    }

    private generateHelmDeployment(meta: ScaffoldingMetadata): string {
        return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "${meta.projectName}.fullname" . }}
  labels:
    {{- include "${meta.projectName}.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      {{- include "${meta.projectName}.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "${meta.projectName}.selectorLabels" . | nindent 8 }}
    spec:
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - name: http
              containerPort: {{ .Values.service.targetPort }}
              protocol: TCP
          livenessProbe:
            httpGet:
              path: /health
              port: http
          readinessProbe:
            httpGet:
              path: /health
              port: http
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
`;
    }

    private generateHelmService(meta: ScaffoldingMetadata): string {
        return `apiVersion: v1
kind: Service
metadata:
  name: {{ include "${meta.projectName}.fullname" . }}
  labels:
    {{- include "${meta.projectName}.labels" . | nindent 4 }}
spec:
  type: {{ .Values.service.type }}
  ports:
    - port: {{ .Values.service.port }}
      targetPort: {{ .Values.service.targetPort }}
      protocol: TCP
      name: http
  selector:
    {{- include "${meta.projectName}.selectorLabels" . | nindent 4 }}
`;
    }

    private generateHelmIngress(meta: ScaffoldingMetadata): string {
        return `{{- if .Values.ingress.enabled -}}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "${meta.projectName}.fullname" . }}
  labels:
    {{- include "${meta.projectName}.labels" . | nindent 4 }}
  {{- with .Values.ingress.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
spec:
  {{- if .Values.ingress.className }}
  ingressClassName: {{ .Values.ingress.className }}
  {{- end }}
  rules:
    {{- range .Values.ingress.hosts }}
    - host: {{ .host | quote }}
      http:
        paths:
          {{- range .paths }}
          - path: {{ .path }}
            {{- if .pathType }}
            pathType: {{ .pathType }}
            {{- end }}
            backend:
              service:
                name: {{ include "${meta.projectName}.fullname" $ }}
                port:
                  number: {{ $.Values.service.port }}
          {{- end }}
    {{- end }}
{{- end }}
`;
    }

    // =========================================================
    // 🏛️ TERRAFORM STATE GENERATION (AWS & GCP MODULES)
    // =========================================================

    private generateAwsTerraformMain(meta: ScaffoldingMetadata): string {
        return `# =========================================================
# 🏛️ Terraform AWS ECS Fargate Deployment Blueprint
# =========================================================
terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# Networking Layer (VPC)
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags = {
    Name = "\${var.project_name}-vpc"
  }
}

resource "aws_subnet" "public_1" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = "\${var.aws_region}a"
  tags = {
    Name = "\${var.project_name}-pub-subnet-1"
  }
}

# ECS Cluster Setup
resource "aws_ecs_cluster" "main" {
  name = "\${var.project_name}-cluster"
}

# Task Formulation
resource "aws_ecs_task_definition" "main" {
  family                   = "\${var.project_name}-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"

  container_definitions = jsonencode([{
    name      = "\${var.project_name}-app"
    image     = "\${var.docker_image}"
    essential = true
    portMappings = [{
      containerPort = ${meta.port}
      hostPort      = ${meta.port}
    }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "${meta.port}" }
    ]
  }])
}

# ECS Resilient Service
resource "aws_ecs_service" "main" {
  name            = "\${var.project_name}-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.main.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [aws_subnet.public_1.id]
    assign_public_ip = true
  }
}
`;
    }

    private generateAwsTerraformVariables(meta: ScaffoldingMetadata): string {
        return `# Terraform Input Variables - AWS Segment
variable "aws_region" {
  type        = string
  default     = "us-east-1"
  description = "Target deployment region on Amazon Web Services"
}

variable "project_name" {
  type        = string
  default     = "${meta.projectName}"
  description = "Active microservice identifier name"
}

variable "docker_image" {
  type        = string
  default     = "123456789012.dkr.ecr.us-east-1.amazonaws.com/${meta.projectName}:latest"
  description = "Target production Docker container URI"
}
`;
    }

    private generateAwsTerraformOutputs(_meta: ScaffoldingMetadata): string {
        return `# Terraform Deployment Outputs - AWS Segment
output "ecs_cluster_name" {
  value       = aws_ecs_cluster.main.name
  description = "Instantiated ECS cluster container identity"
}

output "ecs_service_name" {
  value       = aws_ecs_service.main.name
  description = "Active Fargate worker service endpoint cluster ID"
}
`;
    }

    private generateGcpTerraformMain(meta: ScaffoldingMetadata): string {
        return `# =========================================================
# 🏛️ Terraform GCP Cloud Run Service Mesh Setup
# =========================================================
terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}

# Serverless Cloud Run Deployment Setup
resource "google_cloud_run_v2_service" "main" {
  name     = var.project_name
  location = var.gcp_region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    containers {
      image = var.docker_image
      ports {
        container_port = ${meta.port}
      }
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "PORT"
        value = "${meta.port}"
      }
      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
  }
}

# Allow external, non-authenticated requests safely for application testing
resource "google_cloud_run_v2_service_iam_member" "public_access" {
  name     = google_cloud_run_v2_service.main.name
  location = google_cloud_run_v2_service.main.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
`;
    }

    private generateGcpTerraformVariables(meta: ScaffoldingMetadata): string {
        return `# Google Cloud Platform Variable Configurations
variable "gcp_project_id" {
  type        = string
  default     = "hermes-forge-project"
  description = "Target Google Cloud Project Identifier ID"
}

variable "gcp_region" {
  type        = string
  default     = "us-central1"
  description = "Primary Cloud Run provisioning region"
}

variable "project_name" {
  type        = string
  default     = "${meta.projectName}"
  description = "Associated microservice identification signature"
}

variable "docker_image" {
  type        = string
  default     = "gcr.io/hermes-forge-project/${meta.projectName}:latest"
  description = "Source Artifact Registry deployment URI"
}
`;
    }

    private generateGcpTerraformOutputs(_meta: ScaffoldingMetadata): string {
        return `# Google Cloud Run Service Deployment Summary Output
output "cloud_run_service_url" {
  value       = google_cloud_run_v2_service.main.uri
  description = "Live exposed Cloud Run service network gateway URL"
}
`;
    }

    // =========================================================
    // 🛡️ SECURITY PIPELINE SCANNING TEMPLATE
    // =========================================================

    private generateSecurityScanYml(_meta: ScaffoldingMetadata): string {
        return `# =========================================================
# 🛡️ HermesForge SDLC Security Integrity Scan
# =========================================================
name: "HermesForge Security Safeguards"

on:
  push:
    branches: [ "main", "master", "develop" ]
  pull_request:
    branches: [ "main", "master" ]

jobs:
  static-security-analysis:
    name: "Trivy & Docker Security Scan"
    runs-on: ubuntu-latest
    steps:
      - name: "Checkout code repository"
        uses: actions/checkout@v4

      - name: "Run Trivy Filesystem Vulnerability Scanner"
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: 'fs'
          ignore-unfixed: true
          format: 'table'
          exit-code: '1' # Fail pipeline on severe vulnerability detection
          severity: 'CRITICAL,HIGH'

      - name: "Validate Dockerfile Best Practices with Hadolint"
        uses: hadolint/hadolint-action@v3.1.0
        with:
          dockerfile: "Dockerfile"

  iac-vulnerability-analysis:
    name: "Terraform & Helm IaC Linter Check"
    runs-on: ubuntu-latest
    steps:
      - name: "Checkout workspace repository"
        uses: actions/checkout@v4

      - name: "Initialize Terraform Linters and Security Audit"
        uses: bridgecrewio/checkov-action@master
        with:
          framework: terraform,kubernetes,helm
          quiet: true
          soft_fail: false # Fail runner if IaC security flaws are uncovered
`;
    }
}
