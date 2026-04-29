import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

const copyText = async (text: string) => {
  if (!text) return;

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
};

interface TerminalViewProps {
  output?: string;
  isStreaming?: boolean;
  interactive?: boolean;
  active?: boolean;
  sessionId?: string;
  status?: 'idle' | 'creating' | 'ready' | 'closed' | 'error';
}

export const TerminalView: React.FC<TerminalViewProps> = ({
  output,
  isStreaming = false,
  interactive = false,
  active = true,
  sessionId,
  status = 'idle'
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const outputRef = useRef<string | undefined>(output);
  const disposedRef = useRef(false);

  // 安全的 fit 方法，检查终端是否已销毁
  const safeFit = (fitAddon: FitAddon, term: Terminal) => {
    if (disposedRef.current) return;
    if (!containerRef.current || containerRef.current.offsetWidth === 0 || containerRef.current.offsetHeight === 0) return;
    try {
      // 检查 terminal 是否已完全初始化
      if (term.element && term.renderer) {
        fitAddon.fit();
      }
    } catch {
      // ignore fit errors when dimensions are invalid
    }
  };

  useEffect(() => {
    if (!containerRef.current) return;
    disposedRef.current = false;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: '"Cascadia Code", "Fira Code", Consolas, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        selectionBackground: '#264f78',
      },
      allowTransparency: false,
      scrollback: 5000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    termRef.current = term;
    fitRef.current = fitAddon;

    // 延迟 fit，等待 terminal 完全初始化
    requestAnimationFrame(() => {
      if (!disposedRef.current) {
        safeFit(fitAddon, term);
      }
    });

    const resize = () => {
      if (!disposedRef.current && termRef.current && fitRef.current) {
        safeFit(fitRef.current, termRef.current);
        if (interactive && sessionId) {
          void window.electronAPI.sshShellResize(sessionId, termRef.current.cols, termRef.current.rows);
        }
      }
    };

    const ro = new ResizeObserver(resize);
    ro.observe(containerRef.current);

    const keyHandler = async (event: KeyboardEvent) => {
      if (!interactive || !sessionId) return;

      const isCopy = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c';
      if (!isCopy) return;

      const selection = term.getSelection();
      if (!selection) return;

      event.preventDefault();
      event.stopPropagation();
      await copyText(selection);
    };

    const dataDisposable = term.onData((data) => {
      if (!interactive || !sessionId) return;
      void window.electronAPI.sshShellWrite(sessionId, data);
    });

    containerRef.current.addEventListener('keydown', keyHandler, true);

    if (interactive) {
      term.focus();
    }

    return () => {
      disposedRef.current = true;
      dataDisposable.dispose();
      containerRef.current?.removeEventListener('keydown', keyHandler, true);
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [interactive, sessionId]);

  useEffect(() => {
    const term = termRef.current;
    if (!term || !interactive || !sessionId) return;

    term.clear();
    if (status === 'creating') {
      term.writeln('正在连接交互式终端...');
    } else if (status === 'closed') {
      term.writeln('终端会话已关闭。');
    } else if (status === 'error') {
      term.writeln('终端会话发生错误。');
    }
  }, [interactive, sessionId, status]);

  useEffect(() => {
    if (interactive) return;
    const term = termRef.current;
    if (!term || output === undefined) return;
    if (outputRef.current === output) return;

    outputRef.current = output;

    if (!isStreaming) {
      term.clear();
    }
    term.write(output.replace(/\n/g, '\r\n'));

    if (!isStreaming) {
      term.write('\r\n$ ');
    }
  }, [output, isStreaming, interactive]);

  useEffect(() => {
    if (!interactive || !active) return;

    const term = termRef.current;
    const fitAddon = fitRef.current;
    if (!term || !fitAddon || disposedRef.current) return;

    // 延迟 fit，确保终端已渲染
    requestAnimationFrame(() => {
      if (!disposedRef.current && termRef.current && fitRef.current) {
        safeFit(fitRef.current, termRef.current);
        termRef.current.focus();
        if (sessionId) {
          void window.electronAPI.sshShellResize(sessionId, termRef.current.cols, termRef.current.rows);
        }
      }
    });
  }, [interactive, active, sessionId]);

  useEffect(() => {
    if (!interactive || !sessionId) return;

    const term = termRef.current;
    if (!term) return;

    const disposeData = window.electronAPI.onSshShellData(({ sessionId: currentSessionId, data }) => {
      if (currentSessionId !== sessionId) return;
      term.write(data);
    });

    const disposeClose = window.electronAPI.onSshShellClose(({ sessionId: currentSessionId }) => {
      if (currentSessionId !== sessionId) return;
      term.writeln('\r\n[会话已关闭]');
    });

    const disposeError = window.electronAPI.onSshShellError(({ sessionId: currentSessionId, error }) => {
      if (currentSessionId !== sessionId) return;
      term.writeln(`\r\n[错误] ${error}`);
    });

    return () => {
      disposeData();
      disposeClose();
      disposeError();
    };
  }, [interactive, sessionId]);

  return (
    <div
      ref={containerRef}
      className={`w-full rounded border border-gray-700 ${interactive ? 'h-full overflow-hidden' : 'overflow-auto'}`}
      style={{ minHeight: interactive ? '100%' : '96px', maxHeight: interactive ? '100%' : '400px' }}
    />
  );
};
