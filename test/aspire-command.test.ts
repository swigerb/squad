/**
 * Aspire Command Tests — CLI command for launching Aspire dashboard (Issue #265)
 *
 * Tests the runAspire function's configuration and validation logic.
 * Does NOT actually launch dashboard, Docker, or dotnet processes.
 */

import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync, spawn } from 'node:child_process';
import { runAspire } from '../packages/squad-cli/src/cli/commands/aspire.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

describe('squad aspire command', () => {
  const originalEndpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
  const originalExitCode = process.exitCode;
  let child: EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn> };
  let signalHandlers: Array<() => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(execSync).mockReset();
    vi.mocked(execSync).mockReturnValue('17.0.0+2d325b13709752ba6d9a943635c5e2940a2530c0\n');
    vi.mocked(spawn).mockReset();
    child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    });
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    signalHandlers = [];
    vi.spyOn(process, 'on').mockImplementation((event, listener) => {
      if (event === 'SIGINT' || event === 'SIGTERM') {
        signalHandlers.push(listener as () => void);
      }
      return process;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.exitCode = originalExitCode;
    if (originalEndpoint === undefined) {
      delete process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
    } else {
      process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = originalEndpoint;
    }
  });

  it('uses the supported CLI 17 standalone command with the existing ports and anonymous access', async () => {
    const running = runAspire();
    await vi.advanceTimersByTimeAsync(2000);

    expect(vi.mocked(execSync).mock.calls.map(([command]) => command)).toEqual(['aspire --version']);
    expect(spawn).toHaveBeenCalledWith('aspire', [
      'dashboard', 'run',
      '--frontend-url', 'http://localhost:18888',
      '--otlp-grpc-url', 'http://localhost:4317',
      '--otlp-http-url', '',
      '--allow-anonymous',
      '--persistence', 'None',
      '--non-interactive',
      '--nologo',
    ], expect.objectContaining({ detached: false }));
    expect(process.env['OTEL_EXPORTER_OTLP_ENDPOINT']).toBe('http://localhost:4317');
    child.stdout.emit('data', Buffer.from('dashboard output'));
    child.stderr.emit('data', Buffer.from('dashboard warning'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('dashboard output'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('dashboard warning'));

    child.emit('close', 0);
    await running;
  });

  it('uses Docker only when explicitly requested and preserves the held image and OTLP settings', async () => {
    const running = runAspire({ docker: true });
    await vi.advanceTimersByTimeAsync(2000);

    expect(vi.mocked(execSync).mock.calls.map(([command]) => command)).toEqual(['docker --version']);
    expect(spawn).toHaveBeenCalledWith('docker', expect.arrayContaining([
      '18888:18888',
      '4317:18889',
      'DASHBOARD__FRONTEND__AUTHMODE=Unsecured',
      'DASHBOARD__OTLP__AUTHMODE=Unsecured',
      'mcr.microsoft.com/dotnet/aspire-dashboard:latest',
    ]), expect.objectContaining({ detached: false }));
    expect(process.env['OTEL_EXPORTER_OTLP_ENDPOINT']).toBe('http://localhost:4317');

    child.emit('close', 0);
    await running;
  });

  it('maps the requested UI port and retains the docker option', async () => {
    const running = runAspire({ docker: true, port: 19999 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(spawn).toHaveBeenCalledWith('docker', expect.arrayContaining(['19999:18888']), expect.anything());
    signalHandlers[0]!();
    expect(child.kill).toHaveBeenCalledOnce();
    await running;
  });

  it('maps the requested UI port with the CLI', async () => {
    const running = runAspire({ port: 19999 });
    expect(spawn).toHaveBeenCalledWith('aspire', expect.arrayContaining(['http://localhost:19999']), expect.anything());
    signalHandlers[0]!();
    expect(child.kill).toHaveBeenCalledOnce();
    await running;
  });

  it('requires Docker for the explicit legacy path without probing dotnet', async () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('docker not found'); });

    await runAspire({ docker: true });

    expect(spawn).not.toHaveBeenCalled();
    expect(vi.mocked(execSync).mock.calls.map(([command]) => command)).toEqual(['docker --version']);
    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('Docker is required');
    expect(output).not.toMatch(/workload install|dotnet run/);
    expect(process.exitCode).toBe(1);
  });

  it.each(['9.0.0', '13.6.5', '17.0.0-preview.1', 'not an Aspire version'])('rejects unsupported CLI version %s without a silent fallback', async (version) => {
    vi.mocked(execSync).mockReturnValue(version);
    await runAspire();
    expect(spawn).not.toHaveBeenCalled();
    expect(vi.mocked(execSync).mock.calls.map(([command]) => command)).toEqual(['aspire --version']);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Aspire CLI 17 or newer is required'));
    expect(process.exitCode).toBe(1);
  });

  it('reports a missing CLI without probing Docker, tools, or workloads', async () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('aspire not found'); });
    await runAspire();
    expect(spawn).not.toHaveBeenCalled();
    expect(vi.mocked(execSync).mock.calls.map(([command]) => command)).toEqual(['aspire --version']);
    expect(process.exitCode).toBe(1);
  });

  it('settles when the child exits before the startup delay without printing success', async () => {
    const running = runAspire();
    child.emit('close', 1);
    await running;
    await vi.advanceTimersByTimeAsync(2000);
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).not.toContain('dashboard launching');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('with code 1'));
    expect(process.exitCode).toBe(1);
  });

  it('settles on a spawn error without claiming the dashboard started', async () => {
    const running = runAspire();
    child.emit('error', new Error('dashboard failed'));
    await running;
    await vi.advanceTimersByTimeAsync(2000);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('dashboard failed'));
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).not.toContain('dashboard launching');
    expect(process.exitCode).toBe(1);
  });

  it('reports a dashboard failure after the startup delay as a failed command', async () => {
    const running = runAspire();
    await vi.advanceTimersByTimeAsync(2000);
    child.emit('close', 42);
    await running;

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('with code 42'));
    expect(process.exitCode).toBe(1);
  });

  it('reports an unexpected dashboard signal as a failed command', async () => {
    const running = runAspire();
    child.emit('close', null, 'SIGKILL');
    await running;

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('after signal SIGKILL'));
    expect(process.exitCode).toBe(1);
  });
});
