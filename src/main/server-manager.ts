import { Client, ClientChannel, ConnectConfig } from 'ssh2';
import { ServerConfig } from './database';

export interface ConnectionResult {
  connectionId: string;
  success: boolean;
  error?: string;
}

export interface ExecuteResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: string;
}

export interface ShellSessionResult {
  success: boolean;
  sessionId?: string;
  error?: string;
}

type ShellSession = {
  connectionId: string;
  channel: ClientChannel;
};

export class ServerManager {
  private connections = new Map<string, Client>();
  private shellSessions = new Map<string, ShellSession>();
  private connectionCounter = 0;
  private shellSessionCounter = 0;

  connect(server: ServerConfig): Promise<ConnectionResult> {
    return new Promise((resolve) => {
      const conn = new Client();
      const connectionId = `conn_${++this.connectionCounter}`;

      const config: ConnectConfig = {
        host: server.host,
        port: server.port || 22,
        username: server.username,
        readyTimeout: 10000,
      };

      if (server.password) {
        config.password = server.password;
      } else if (server.privateKey) {
        config.privateKey = server.privateKey;
      }

      conn.on('ready', () => {
        this.connections.set(connectionId, conn);
        resolve({ connectionId, success: true });
      });

      conn.on('error', (err) => {
        resolve({ connectionId, success: false, error: err.message });
      });

      conn.connect(config);
    });
  }

  execute(connectionId: string, command: string): Promise<ExecuteResult> {
    return new Promise((resolve) => {
      const conn = this.connections.get(connectionId);
      if (!conn) {
        resolve({ success: false, error: 'Connection not found' });
        return;
      }

      conn.exec(command, (err, stream) => {
        if (err) {
          resolve({ success: false, error: err.message });
          return;
        }

        let stdout = '';
        let stderr = '';

        stream.on('close', (code: number | boolean, signal?: string) => {
          const exitCode = typeof code === 'number' ? code : 0;
          resolve({ 
            success: exitCode === 0, 
            stdout, 
            stderr, 
            exitCode 
          });
        });

        stream.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
      });
    });
  }

  createShellSession(
    connectionId: string,
    cols: number,
    rows: number,
    onData: (sessionId: string, data: string) => void,
    onClose: (sessionId: string) => void,
    onError: (sessionId: string, error: string) => void,
  ): Promise<ShellSessionResult> {
    return new Promise((resolve) => {
      const conn = this.connections.get(connectionId);
      if (!conn) {
        resolve({ success: false, error: 'Connection not found' });
        return;
      }

      conn.shell({ term: 'xterm-256color', cols, rows }, (err, channel) => {
        if (err) {
          resolve({ success: false, error: err.message });
          return;
        }

        const sessionId = `shell_${++this.shellSessionCounter}`;
        this.shellSessions.set(sessionId, { connectionId, channel });

        channel.on('data', (data: Buffer) => {
          onData(sessionId, data.toString());
        });

        channel.on('close', () => {
          this.shellSessions.delete(sessionId);
          onClose(sessionId);
        });

        channel.on('error', (error: Error) => {
          onError(sessionId, error.message);
        });

        resolve({ success: true, sessionId });
      });
    });
  }

  writeToShell(sessionId: string, data: string): void {
    const session = this.shellSessions.get(sessionId);
    if (!session) {
      throw new Error('Shell session not found');
    }
    session.channel.write(data);
  }

  resizeShell(sessionId: string, cols: number, rows: number): void {
    const session = this.shellSessions.get(sessionId);
    if (!session) {
      throw new Error('Shell session not found');
    }
    session.channel.setWindow(rows, cols, rows, cols);
  }

  closeShell(sessionId: string): void {
    const session = this.shellSessions.get(sessionId);
    if (!session) return;
    session.channel.close();
    this.shellSessions.delete(sessionId);
  }

  disconnect(connectionId: string): void {
    for (const [sessionId, session] of this.shellSessions.entries()) {
      if (session.connectionId === connectionId) {
        session.channel.close();
        this.shellSessions.delete(sessionId);
      }
    }

    const conn = this.connections.get(connectionId);
    if (conn) {
      conn.end();
      this.connections.delete(connectionId);
    }
  }

  disconnectAll(): void {
    for (const [sessionId, session] of this.shellSessions.entries()) {
      session.channel.close();
      this.shellSessions.delete(sessionId);
    }

    for (const [connectionId, conn] of this.connections.entries()) {
      conn.end();
      this.connections.delete(connectionId);
    }
  }
}
