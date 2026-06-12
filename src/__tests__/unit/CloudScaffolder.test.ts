import { describe, test, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { CloudScaffolder } from '../../services/CloudScaffolder';

vi.mock('fs/promises', () => ({
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn()
}));

describe('CloudScaffolder Unit Tests', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('should return singleton instance', () => {
        const s1 = CloudScaffolder.getInstance();
        const s2 = CloudScaffolder.getInstance();
        expect(s1).toBe(s2);
    });

    test('should read project node configurations from package.json package rules', async () => {
        const pkgData = JSON.stringify({
            name: 'test-microservice',
            engines: { node: '22' },
            dependencies: { pg: '^8.11.0' }
        });
        
        vi.mocked(fs.readFile).mockResolvedValue(pkgData);

        const scaffolder = CloudScaffolder.getInstance();
        const meta = await scaffolder.readProjectMetadata();

        expect(meta.projectName).toBe('test-microservice');
        expect(meta.nodeVersion).toBe('22-alpine');
        expect(meta.hasDatabase).toBe(true);
        expect(meta.dbType).toBe('postgres');
    });

    test('should execute full set of file creations for Docker, Compose, Kubernetes, Helm, Terraform, and Security profiles', async () => {
        const pkgData = JSON.stringify({
            name: 'k8s-pod',
            engines: { node: '20' }
        });

        vi.mocked(fs.readFile).mockResolvedValue(pkgData);
        const mkdirMock = vi.mocked(fs.mkdir).mockResolvedValue(undefined);
        const writeMock = vi.mocked(fs.writeFile).mockResolvedValue(undefined);
        const showInfoSpy = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined as any);

        const scaffolder = CloudScaffolder.getInstance();
        await scaffolder.scaffoldCloudEnvironment();

        // Expect directory creation for manifests, helm, terraform and workflows
        expect(mkdirMock).toHaveBeenCalledWith(expect.stringContaining('k8s'), { recursive: true });
        expect(mkdirMock).toHaveBeenCalledWith(expect.stringContaining('helm'), { recursive: true });
        expect(mkdirMock).toHaveBeenCalledWith(expect.stringContaining('terraform'), { recursive: true });
        expect(mkdirMock).toHaveBeenCalledWith(expect.stringContaining('.github'), { recursive: true });

        // Expect Dockerfile write
        expect(writeMock).toHaveBeenCalledWith(
            expect.stringContaining('Dockerfile'),
            expect.stringContaining('HermesForge Production-Grade Multi-Stage Dockerfile'),
            'utf8'
        );

        // Expect .dockerignore write
        expect(writeMock).toHaveBeenCalledWith(
            expect.stringContaining('.dockerignore'),
            expect.stringContaining('node_modules'),
            'utf8'
        );

        // Expect compose write
        expect(writeMock).toHaveBeenCalledWith(
            expect.stringContaining('docker-compose.yml'),
            expect.stringContaining('web-app'),
            'utf8'
        );

        // Expect Kubernetes deployment, service, ingress, and configmap writes
        expect(writeMock).toHaveBeenCalledWith(
            expect.stringContaining('k8s/deployment.yaml'),
            expect.stringContaining('Deployment'),
            'utf8'
        );

        expect(writeMock).toHaveBeenCalledWith(
            expect.stringContaining('k8s/service.yaml'),
            expect.stringContaining('Service'),
            'utf8'
        );

        expect(writeMock).toHaveBeenCalledWith(
            expect.stringContaining('k8s/ingress.yaml'),
            expect.stringContaining('Ingress'),
            'utf8'
        );

        expect(writeMock).toHaveBeenCalledWith(
            expect.stringContaining('k8s/configmap.yaml'),
            expect.stringContaining('ConfigMap'),
            'utf8'
        );

        // Expect Helm manifests write
        expect(writeMock).toHaveBeenCalledWith(
            expect.stringContaining('Chart.yaml'),
            expect.stringContaining('apiVersion: v2'),
            'utf8'
        );

        expect(writeMock).toHaveBeenCalledWith(
            expect.stringContaining('values.yaml'),
            expect.stringContaining('replicaCount'),
            'utf8'
        );

        // Expect Terraform modules write
        expect(writeMock).toHaveBeenCalledWith(
            expect.stringContaining('terraform/aws/main.tf'),
            expect.stringContaining('aws_ecs_cluster'),
            'utf8'
        );

        expect(writeMock).toHaveBeenCalledWith(
            expect.stringContaining('terraform/gcp/main.tf'),
            expect.stringContaining('google_cloud_run_v2_service'),
            'utf8'
        );

        // Expect Security Pipeline workflow write
        expect(writeMock).toHaveBeenCalledWith(
            expect.stringContaining('security-scan.yml'),
            expect.stringContaining('Trivy & Docker Security Scan'),
            'utf8'
        );

        expect(showInfoSpy).toHaveBeenCalledWith(expect.stringContaining('Success!'));
    });
});
