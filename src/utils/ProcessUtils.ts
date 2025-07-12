import { ChildProcess } from 'child_process';
import kill from 'tree-kill';
import crossSpawn from 'cross-spawn';

export interface ProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  shell?: boolean;
  detached?: boolean;
  stdio?: 'inherit' | 'pipe' | 'ignore';
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class ProcessUtils {
  static async execute(
    command: string,
    args: string[] = [],
    options: ProcessOptions = {}
  ): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const child = crossSpawn(command, args, {
        cwd: options.cwd || process.cwd(),
        env: { ...process.env, ...options.env },
        shell: options.shell || false,
        stdio: options.stdio || 'pipe',
      });

      let stdout = '';
      let stderr = '';

      if (child.stdout) {
        child.stdout.on('data', (data: Buffer) => {
          stdout += data.toString();
        });
      }

      if (child.stderr) {
        child.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
      }

      child.on('close', (code: number | null) => {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code || 0,
        });
      });

      child.on('error', (error: Error) => {
        reject(new Error(`Process execution failed: ${error.message}`));
      });
    });
  }

  static spawn(command: string, args: string[] = [], options: ProcessOptions = {}): ChildProcess {
    return crossSpawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.env },
      shell: options.shell || false,
      stdio: options.stdio || 'inherit',
      detached: options.detached || false,
    });
  }

  static async killProcess(pid: number, signal: string = 'SIGTERM'): Promise<void> {
    return new Promise((resolve, reject) => {
      kill(pid, signal, (error?: Error) => {
        if (error) {
          reject(new Error(`Failed to kill process ${pid}: ${error.message}`));
        } else {
          resolve();
        }
      });
    });
  }

  static isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  static async findProcessByPort(port: number): Promise<number | null> {
    try {
      const isWindows = process.platform === 'win32';
      const command = isWindows ? 'netstat' : 'lsof';
      const args = isWindows ? ['-ano'] : ['-ti', `:${port}`];

      const result = await this.execute(command, args);

      if (isWindows) {
        const lines = result.stdout.split('\n');
        for (const line of lines) {
          if (line.includes(`:${port}`) && line.includes('LISTENING')) {
            const parts = line.trim().split(/\s+/);
            const pid = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(pid)) {
              return pid;
            }
          }
        }
      } else {
        const pid = parseInt(result.stdout.trim(), 10);
        if (!isNaN(pid)) {
          return pid;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  static async isPortAvailable(port: number): Promise<boolean> {
    const pid = await this.findProcessByPort(port);
    return pid === null;
  }

  static parseCommand(commandString: string): { command: string; args: string[] } {
    const parts = commandString.trim().split(/\s+/);
    const command = parts[0];
    const args = parts.slice(1);

    return { command, args };
  }

  static getEnvironmentVariables(): NodeJS.ProcessEnv {
    return { ...process.env };
  }

  static setEnvironmentVariable(key: string, value: string): void {
    process.env[key] = value;
  }

  static unsetEnvironmentVariable(key: string): void {
    delete process.env[key];
  }
}
