/**
 * Aspire command — Launch Aspire dashboard for Squad observability
 * (Issue #265)
 *
 * Starts the Aspire dashboard and configures OTLP export so Squad
 * traces and metrics flow into the dashboard automatically.
 */

import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { BOLD, RESET, DIM, GREEN, RED, YELLOW } from '../core/output.js';

// ============================================================================
// Constants
// ============================================================================

/** Default OTLP endpoint the Aspire dashboard listens on (host-mapped gRPC port). */
const ASPIRE_OTLP_ENDPOINT = 'http://localhost:4317';

/** Default Aspire dashboard UI port. */
const ASPIRE_DASHBOARD_PORT = 18888;

/** Docker container name for the Aspire dashboard. */
const ASPIRE_CONTAINER_NAME = 'squad-aspire-dashboard';

/** Docker image for the Aspire dashboard. */
const ASPIRE_DOCKER_IMAGE = 'mcr.microsoft.com/dotnet/aspire-dashboard:latest';

// ============================================================================
// Detection helpers
// ============================================================================

function commandExists(cmd: string): boolean {
  try {
    execSync(`${cmd} --version`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function isDockerAvailable(): boolean {
  return commandExists('docker');
}

function isAspireAvailable(): boolean {
  try {
    const output = execSync('aspire --version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const version = /^(\d+)\.\d+\.\d+(?:\+[\w.-]+)?$/.exec(output.trim());
    return version !== null && Number(version[1]) >= 17;
  } catch {
    return false;
  }
}

// ============================================================================
// Launch strategies
// ============================================================================

function launchWithDocker(port: number): ChildProcess {
  console.log(`${DIM}Starting Aspire dashboard via Docker...${RESET}`);
  const child = spawn('docker', [
    'run', '--rm',
    '--name', ASPIRE_CONTAINER_NAME,
    '-p', `${port}:18888`,
    '-p', '4317:18889',
    '-e', 'DASHBOARD__FRONTEND__AUTHMODE=Unsecured',
    '-e', 'DASHBOARD__OTLP__AUTHMODE=Unsecured',
    ASPIRE_DOCKER_IMAGE,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  return child;
}

function launchWithAspire(port: number): ChildProcess {
  console.log(`${DIM}Starting standalone Aspire dashboard via Aspire CLI...${RESET}`);
  return spawn('aspire', [
    'dashboard', 'run',
    '--frontend-url', `http://localhost:${port}`,
    '--otlp-grpc-url', ASPIRE_OTLP_ENDPOINT,
    '--otlp-http-url', '',
    '--allow-anonymous',
    '--persistence', 'None',
    '--non-interactive',
    '--nologo',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
}

// ============================================================================
// Public API
// ============================================================================

export interface AspireOptions {
  /** Explicitly use the held legacy Docker image instead of Aspire CLI 17+. */
  docker?: boolean;
  /** Custom dashboard UI port; OTLP/gRPC remains on port 4317. */
  port?: number;
}

/**
 * Run the `squad aspire` command.
 * Launches the Aspire dashboard and configures OTLP export.
 */
export async function runAspire(options: AspireOptions = {}): Promise<void> {
  const port = options.port ?? ASPIRE_DASHBOARD_PORT;
  const otlpEndpoint = ASPIRE_OTLP_ENDPOINT;

  console.log(`\n${BOLD}🔭 Squad Aspire — OpenTelemetry Dashboard${RESET}\n`);

  // Set OTLP environment so OTel providers pick it up (gRPC endpoint, not dashboard UI)
  process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = otlpEndpoint;
  console.log(`${DIM}OTLP endpoint: ${otlpEndpoint}${RESET}`);

  if (options.docker ? !isDockerAvailable() : !isAspireAvailable()) {
    console.log(options.docker
      ? `${RED}✗${RESET} Docker is required for squad aspire --docker.`
      : `${RED}✗${RESET} Aspire CLI 17 or newer is required for the standalone dashboard.`);
    console.log(options.docker
      ? `    ${BOLD}Docker:${RESET}  https://docker.com/get-started`
      : `    ${BOLD}Aspire CLI:${RESET}  https://aspire.dev/get-started/install-cli/`);
    if (!options.docker) {
      console.log(`    Use squad aspire --docker only to opt into the held legacy dashboard image.`);
    }
    process.exitCode = 1;
    return;
  }

  const child = options.docker ? launchWithDocker(port) : launchWithAspire(port);

  // Wire up output
  child.stdout?.on('data', (data: Buffer) => {
    const text = data.toString().trim();
    if (text) console.log(`${DIM}[aspire]${RESET} ${text}`);
  });

  child.stderr?.on('data', (data: Buffer) => {
    const text = data.toString().trim();
    if (text) console.log(`${YELLOW}[aspire]${RESET} ${text}`);
  });

  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      console.log(`\n${GREEN}✓${RESET} Aspire dashboard launching`);
      console.log(`  ${BOLD}Dashboard:${RESET}  http://localhost:${port}`);
      console.log(`  ${BOLD}OTLP gRPC:${RESET}  localhost:4317`);
      console.log(`\n${DIM}Squad OTel will automatically export to this endpoint.${RESET}`);
      console.log(`${DIM}Press Ctrl+C to stop.${RESET}\n`);
    }, 2000);

    const finish = () => {
      clearTimeout(timer);
      process.removeListener('SIGINT', shutdown);
      process.removeListener('SIGTERM', shutdown);
      child.removeListener('close', onClose);
      child.removeListener('error', onError);
      resolve();
    };
    const shutdown = () => {
      console.log(`\n${DIM}🔭 Aspire dashboard stopping...${RESET}`);
      child.kill();
      finish();
    };
    const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
      if (code === 0) {
        console.log(`${DIM}Aspire process exited.${RESET}`);
      } else {
        const reason = signal ? `after signal ${signal}` : `with code ${code ?? 'unknown'}`;
        console.error(`${RED}✗${RESET} Aspire dashboard exited ${reason}.`);
        process.exitCode = 1;
      }
      finish();
    };
    const onError = (err: Error) => {
      console.error(`${RED}✗${RESET} Failed to start Aspire: ${err.message}`);
      process.exitCode = 1;
      finish();
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    child.once('close', onClose);
    child.once('error', onError);
  });
}
