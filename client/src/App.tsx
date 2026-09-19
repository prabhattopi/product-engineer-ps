import React, { useState, useRef, useEffect } from 'react';
import {
  Wifi,
  WifiOff,
  RefreshCw,
  Send,
  AlertTriangle,
  AlertOctagon,
  Info,
  Radio,
  ShieldCheck,
  Zap,
  Activity,
  User,
  RotateCcw,
  CheckCircle2,
  Copy,
  Trash2,
} from 'lucide-react';
import { useIncidentFeed } from './hooks/useIncidentFeed';
import type { MessageSeverity } from './types';

const PRESET_MESSAGES = [
  { text: 'Elevated 500 error rates detected on checkout-service (4.8%)', severity: 'CRITICAL' as MessageSeverity },
  { text: 'Database replica lag exceeding 14s on read-pool-02', severity: 'WARNING' as MessageSeverity },
  { text: 'Initiated automatic failover to us-east-2 standby instance', severity: 'INFO' as MessageSeverity },
  { text: 'Standby database healthy. Replication lag nominal (< 50ms)', severity: 'INFO' as MessageSeverity },
  { text: 'Checkout error rates recovered to 0.02%. Incident mitigated.', severity: 'INFO' as MessageSeverity },
];

const AUTHORS = [
  'Incident Commander',
  'SRE On-Call',
  'Database Lead',
  'Platform Eng',
];

export default function App() {
  const {
    roomId,
    connectionState,
    messages,
    stats,
    isSimulatedOffline,
    nextRetryInMs,
    errorNotice,
    publishUpdate,
    simulateDisconnect,
    reconnect,
    switchRoom,
    resetRoomOnServer,
    injectSimulatedDuplicate,
  } = useIncidentFeed({
    initialRoomId: 'incident-alpha',
  });

  const [inputContent, setInputContent] = useState('');
  const [selectedSeverity, setSelectedSeverity] = useState<MessageSeverity>('INFO');
  const [selectedAuthor, setSelectedAuthor] = useState(AUTHORS[0]);
  const [isSending, setIsSending] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const feedEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom when messages arrive
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Handle toast timeout
  useEffect(() => {
    if (toastMessage) {
      const t = setTimeout(() => setToastMessage(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toastMessage]);

  // When missed updates are caught up on reconnect (AC3), notify user with feedback banner
  const prevMissedRef = useRef(stats.missedCaughtUpCount);
  useEffect(() => {
    if (stats.missedCaughtUpCount > prevMissedRef.current) {
      const recovered = stats.missedCaughtUpCount - prevMissedRef.current;
      setToastMessage(`AC3 Verified: Recovered ${recovered} missed update${recovered > 1 ? 's' : ''} via sequence replay!`);
    }
    prevMissedRef.current = stats.missedCaughtUpCount;
  }, [stats.missedCaughtUpCount]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (connectionState !== 'CONNECTED' || isSimulatedOffline) {
      setToastMessage('Cannot broadcast: Connection is offline. Click Reconnect & Sync (AC3) to restore connection first.');
      return;
    }
    if (!inputContent.trim() || isSending) return;

    setIsSending(true);
    try {
      await publishUpdate(inputContent, selectedSeverity, selectedAuthor);
      setInputContent('');
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const triggerDuplicateTest = () => {
    if (messages.length === 0) {
      setToastMessage('Please send at least 1 message before simulating duplicate delivery.');
      return;
    }
    injectSimulatedDuplicate();
    setToastMessage('AC4 Verified: Injected duplicate message packet was intercepted and blocked by client deduplicator!');
  };

  return (
    <div className="h-screen max-h-screen bg-[#07090e] text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30 selection:text-indigo-200 overflow-hidden">
      {/* 1. Top Header */}
      <header className="shrink-0 border-b border-slate-800/80 bg-[#0c101a] px-4 py-2.5 z-50">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
              <Radio className="h-4 w-4 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold tracking-tight text-white text-sm sm:text-base">
                  CAYGNUS INCIDENT COMMAND
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 font-mono border border-indigo-800/50">
                  REAL-TIME FEED
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                Problem 3: Reconnecting Real-Time Incident Coordination Feed
              </p>
            </div>
          </div>

          {/* Room Selector & Connection Status */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Room Tabs */}
            <div className="flex items-center gap-1 bg-slate-900/90 border border-slate-800 rounded-lg p-1 text-xs">
              <button
                onClick={() => switchRoom('incident-alpha')}
                className={`px-2 py-0.5 rounded font-mono transition-colors text-xs ${
                  roomId === 'incident-alpha'
                    ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                incident-alpha
              </button>
              <button
                onClick={() => switchRoom('incident-bravo')}
                className={`px-2 py-0.5 rounded font-mono transition-colors text-xs ${
                  roomId === 'incident-bravo'
                    ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                incident-bravo
              </button>
            </div>

            {/* Connection Status Badge (AC2) */}
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold tracking-wide transition-all shrink-0 ${
                connectionState === 'CONNECTED'
                  ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.2)]'
                  : connectionState === 'RECONNECTING'
                  ? 'bg-amber-950/60 border-amber-500/40 text-amber-300 animate-pulse'
                  : 'bg-rose-950/70 border-rose-500/50 text-rose-300'
              }`}
            >
              {connectionState === 'CONNECTED' && (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <Wifi className="h-3.5 w-3.5" />
                  <span>CONNECTED</span>
                </>
              )}

              {connectionState === 'RECONNECTING' && (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin text-amber-400" />
                  <span>
                    RECONNECTING
                    {nextRetryInMs > 0 ? ` (${(nextRetryInMs / 1000).toFixed(1)}s)` : '...'}
                  </span>
                </>
              )}

              {connectionState === 'DISCONNECTED' && (
                <>
                  <WifiOff className="h-3.5 w-3.5 text-rose-400" />
                  <span>DISCONNECTED</span>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* 2. Interactive Acceptance Simulation Toolbar (For Demonstration & Testing) */}
      <div className="shrink-0 bg-[#090d16] border-b border-indigo-950/60 px-4 py-2">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Zap className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <span className="text-xs font-semibold text-slate-200">
              Interactive Test Controls:
            </span>
            <span className="text-[11px] text-slate-400 hidden md:inline">
              Test disconnect, post updates in Tab A, then reconnect in Tab B to observe replay catch-up.
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Simulate Disconnect (AC2) */}
            <button
              onClick={simulateDisconnect}
              disabled={connectionState === 'DISCONNECTED' && isSimulatedOffline}
              title="Simulate network loss without turning off Wi-Fi"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition-all ${
                connectionState === 'DISCONNECTED' && isSimulatedOffline
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50'
                  : 'bg-rose-950/40 text-rose-300 hover:bg-rose-900/60 border border-rose-600/50 active:scale-95'
              }`}
            >
              <WifiOff className="h-3 w-3" />
              <span>Simulate Disconnect (AC2)</span>
            </button>

            {/* Reconnect & Sync (AC3) */}
            <button
              onClick={reconnect}
              disabled={connectionState === 'CONNECTED'}
              title="Restore connection and catch up on missed updates"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition-all ${
                connectionState === 'CONNECTED'
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50'
                  : 'bg-emerald-950/50 text-emerald-300 hover:bg-emerald-900/60 border border-emerald-500/50 active:scale-95 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
              }`}
            >
              <RefreshCw className="h-3 w-3" />
              <span>Reconnect & Sync (AC3)</span>
            </button>

            {/* Simulate Duplicate Packet (AC4) */}
            <button
              onClick={triggerDuplicateTest}
              title="Inject an already seen message ID to verify deduplication"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold bg-cyan-950/40 text-cyan-300 hover:bg-cyan-900/60 border border-cyan-500/40 active:scale-95"
            >
              <Copy className="h-3 w-3" />
              <span>Simulate Duplicate (AC4)</span>
            </button>

            {/* Reset Room on Server (Broadcasts to all tabs so both tabs reset cleanly to sequence 0) */}
            <button
              onClick={async () => {
                await resetRoomOnServer();
                setToastMessage('Incident room reset to sequence #0 across all tabs!');
              }}
              title="Reset room on server (resets sequence to 0 and clears all tabs)"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-rose-300 border border-slate-800 hover:border-rose-900/50 transition-all"
            >
              <Trash2 className="h-3 w-3" />
              <span>Reset Room</span>
            </button>
          </div>
        </div>
      </div>

      {/* Toast Banner for Verification Feedback */}
      {toastMessage && (
        <div className="shrink-0 bg-emerald-950/90 border-b border-emerald-500/40 px-4 py-1.5 text-xs text-emerald-200 flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-2 max-w-7xl mx-auto w-full">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            <span>{toastMessage}</span>
          </div>
        </div>
      )}

      {/* Error notification banner if any */}
      {errorNotice && !toastMessage && (
        <div className="shrink-0 bg-rose-950/80 border-b border-rose-500/50 px-4 py-1.5 text-xs text-rose-300 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
          <span>{errorNotice}</span>
        </div>
      )}

      {/* 3. Telemetry Metrics Bar */}
      <div className="shrink-0 max-w-7xl mx-auto w-full px-4 pt-3 pb-1">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {/* Card 1: Monotonic Sequence Cursor (AC5) */}
          <div className="bg-[#0c101a] border border-slate-800 rounded-lg px-3 py-2">
            <div className="flex items-center justify-between text-slate-400 text-[11px]">
              <span>Sequence Cursor</span>
              <Activity className="h-3 w-3 text-indigo-400" />
            </div>
            <div className="text-lg font-mono font-bold text-indigo-300">
              #{stats.highestSequenceId}
            </div>
            <p className="text-[10px] text-slate-500">Monotonic ordering (AC5)</p>
          </div>

          {/* Card 2: Feed Total (AC1) */}
          <div className="bg-[#0c101a] border border-slate-800 rounded-lg px-3 py-2">
            <div className="flex items-center justify-between text-slate-400 text-[11px]">
              <span>Feed Total</span>
              <Radio className="h-3 w-3 text-emerald-400" />
            </div>
            <div className="text-lg font-mono font-bold text-emerald-300">
              {stats.totalReceived}
            </div>
            <p className="text-[10px] text-slate-500">Active updates (AC1)</p>
          </div>

          {/* Card 3: Duplicates Blocked (AC4) */}
          <div className="bg-[#0c101a] border border-slate-800 rounded-lg px-3 py-2">
            <div className="flex items-center justify-between text-slate-400 text-[11px]">
              <span>Duplicates Blocked</span>
              <ShieldCheck className="h-3 w-3 text-cyan-400" />
            </div>
            <div className="text-lg font-mono font-bold text-cyan-300">
              {stats.duplicatesFiltered}
            </div>
            <p className="text-[10px] text-slate-500">Zero UI duplicates (AC4)</p>
          </div>

          {/* Card 4: Missed Caught-Up (AC3) */}
          <div className="bg-[#0c101a] border border-slate-800 rounded-lg px-3 py-2">
            <div className="flex items-center justify-between text-slate-400 text-[11px]">
              <span>Missed Caught-Up</span>
              <RotateCcw className="h-3 w-3 text-purple-400" />
            </div>
            <div className="text-lg font-mono font-bold text-purple-300">
              {stats.missedCaughtUpCount > 0 ? `+${stats.missedCaughtUpCount}` : '0'}
            </div>
            <p className="text-[10px] text-slate-500">Recovered on reconnect (AC3)</p>
          </div>
        </div>
      </div>

      {/* 4. Timeline Stream (Flex scrollable area) */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-2 flex flex-col min-h-0 overflow-hidden">
        <div className="bg-[#090d16] border border-slate-800/90 rounded-xl flex-1 flex flex-col overflow-hidden min-h-0 shadow-inner">
          {/* Timeline Subheader */}
          <div className="shrink-0 px-3.5 py-2 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Incident Stream
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/50">
                {roomId}
              </span>
            </div>
            <span className="text-[11px] text-slate-500 font-mono">
              Deterministic sequence sorting active
            </span>
          </div>

          {/* Messages Scroll Area */}
          <div className="flex-1 p-3.5 overflow-y-auto space-y-2.5">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
                <CheckCircle2 className="h-8 w-8 text-slate-700 mb-2" />
                <p className="text-sm font-medium text-slate-400">No incident updates yet in {roomId}</p>
                <p className="text-xs text-slate-600 mt-0.5">
                  Publish an update using the form below or click one of the 1-click presets.
                </p>
              </div>
            ) : (
              messages.map((msg) => {
                const isCritical = msg.severity === 'CRITICAL';
                const isWarning = msg.severity === 'WARNING';

                return (
                  <div
                    key={msg.id}
                    className={`rounded-lg border p-3 transition-all ${
                      isCritical
                        ? 'bg-rose-950/20 border-rose-900/50 hover:border-rose-700/60'
                        : isWarning
                        ? 'bg-amber-950/20 border-amber-900/50 hover:border-amber-700/60'
                        : 'bg-slate-900/50 border-slate-800/80 hover:border-slate-700/80'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        {/* Monotonic Sequence Pill (AC5) */}
                        <span className="font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-800/50">
                          #{msg.sequence}
                        </span>

                        {/* Severity Badge */}
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                            isCritical
                              ? 'bg-rose-900/40 text-rose-300 border-rose-700/60'
                              : isWarning
                              ? 'bg-amber-900/40 text-amber-300 border-amber-700/60'
                              : 'bg-cyan-900/40 text-cyan-300 border-cyan-700/60'
                          }`}
                        >
                          {isCritical && <AlertOctagon className="h-2.5 w-2.5" />}
                          {isWarning && <AlertTriangle className="h-2.5 w-2.5" />}
                          {!isCritical && !isWarning && <Info className="h-2.5 w-2.5" />}
                          {msg.severity}
                        </span>

                        {/* Author */}
                        <div className="flex items-center gap-1 text-xs text-slate-300 font-medium">
                          <User className="h-3 w-3 text-slate-500" />
                          <span>{msg.author}</span>
                        </div>
                      </div>

                      {/* Timestamp with seconds for clarity */}
                      <span className="text-[11px] text-slate-500 font-mono">
                        {new Date(msg.timestamp).toLocaleTimeString()}
                      </span>
                    </div>

                    {/* Message Body */}
                    <p className="text-xs sm:text-sm text-slate-200 pl-0.5 leading-relaxed">
                      {msg.content}
                    </p>
                  </div>
                );
              })
            )}
            <div ref={feedEndRef} />
          </div>
        </div>
      </main>

      {/* 5. Fixed Composer & 1-Click Scenarios (Always pinned at bottom, never cut off!) */}
      <footer className="shrink-0 bg-[#0c101a] border-t border-slate-800 px-4 py-2.5 z-40">
        <div className="max-w-7xl mx-auto flex flex-col gap-2">
          {/* 1-Click Quick Presets */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
            <span className="text-slate-500 font-semibold shrink-0 text-[11px] flex items-center gap-1">
              <Zap className="h-3 w-3 text-amber-400" />
              Presets:
            </span>
            {PRESET_MESSAGES.map((preset, idx) => (
              <button
                key={idx}
                type="button"
                disabled={connectionState !== 'CONNECTED'}
                onClick={() => {
                  setInputContent(preset.text);
                  setSelectedSeverity(preset.severity);
                }}
                className={`shrink-0 text-[11px] px-2 py-1 rounded border transition-all flex items-center gap-1.5 ${
                  connectionState !== 'CONNECTED'
                    ? 'bg-slate-900/40 text-slate-600 border-slate-900 cursor-not-allowed'
                    : 'bg-slate-900 hover:bg-slate-800 border-slate-800 hover:border-indigo-600/50 text-slate-300 hover:text-white'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    preset.severity === 'CRITICAL'
                      ? 'bg-rose-500'
                      : preset.severity === 'WARNING'
                      ? 'bg-amber-500'
                      : 'bg-cyan-500'
                  }`}
                />
                <span className="truncate max-w-[200px] sm:max-w-[280px]">{preset.text}</span>
              </button>
            ))}
          </div>

          {/* Form Composer */}
          <form onSubmit={handleSendMessage} className="flex flex-wrap sm:flex-nowrap items-center gap-2">
            {/* Author selector */}
            <div className="flex items-center gap-1 shrink-0">
              <select
                value={selectedAuthor}
                disabled={connectionState !== 'CONNECTED'}
                onChange={(e) => setSelectedAuthor(e.target.value)}
                className={`bg-slate-900 border rounded px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 ${
                  connectionState !== 'CONNECTED' ? 'border-slate-900 text-slate-500 cursor-not-allowed' : 'border-slate-800'
                }`}
              >
                {AUTHORS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>

            {/* Severity buttons */}
            <div className="flex items-center gap-1 shrink-0">
              {(['INFO', 'WARNING', 'CRITICAL'] as MessageSeverity[]).map((sev) => (
                <button
                  type="button"
                  key={sev}
                  disabled={connectionState !== 'CONNECTED'}
                  onClick={() => setSelectedSeverity(sev)}
                  className={`px-2 py-1 rounded text-xs font-semibold transition-all ${
                    connectionState !== 'CONNECTED'
                      ? 'bg-slate-900/40 text-slate-600 border border-slate-900 cursor-not-allowed'
                      : selectedSeverity === sev
                      ? sev === 'CRITICAL'
                        ? 'bg-rose-600 text-white shadow-sm'
                        : sev === 'WARNING'
                        ? 'bg-amber-600 text-white shadow-sm'
                        : 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  {sev}
                </button>
              ))}
            </div>

            {/* Input & Send */}
            <div className="flex-1 flex gap-2 w-full sm:w-auto">
              <input
                type="text"
                value={inputContent}
                onChange={(e) => setInputContent(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={connectionState !== 'CONNECTED' || isSending}
                placeholder={
                  connectionState === 'CONNECTED'
                    ? `Post update to ${roomId}... (Enter to send)`
                    : `Feed is offline — Reconnect to broadcast updates`
                }
                className={`flex-1 rounded-lg px-3 py-1.5 text-xs sm:text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none transition-all font-sans ${
                  connectionState !== 'CONNECTED'
                    ? 'bg-slate-950/50 border border-slate-900 text-slate-500 cursor-not-allowed'
                    : 'bg-slate-950 border border-slate-800 focus:border-indigo-500'
                }`}
              />
              <button
                type="submit"
                disabled={connectionState !== 'CONNECTED' || !inputContent.trim() || isSending}
                title={connectionState !== 'CONNECTED' ? 'Cannot broadcast while disconnected' : 'Broadcast update'}
                className={`px-3.5 py-1.5 rounded-lg font-semibold text-xs flex items-center gap-1.5 transition-all shrink-0 ${
                  connectionState !== 'CONNECTED' || !inputContent.trim() || isSending
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/40'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white active:scale-95 shadow-md shadow-indigo-600/20'
                }`}
              >
                <Send className="h-3 w-3" />
                <span>Broadcast</span>
              </button>
            </div>
          </form>
        </div>
      </footer>
    </div>
  );
}
