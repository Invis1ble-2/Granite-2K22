// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import logoGranite from './assets/images/logo-granite.png';
import { Locale, LocalizedLike, pickText, UI_TEXT } from './i18n';
import {
  CourtBlueprintSvg,
  IconArrowRight,
  IconCheck,
  IconChevron,
  IconCopy,
  IconCpu,
  IconFileConfig,
  IconFolder,
  IconLanguage,
  IconMoon,
  IconNetwork,
  IconPlay,
  IconRadio,
  IconRotateCcw,
  IconServer,
  IconSliders,
  IconSteam,
  IconSun,
  IconTerminal,
} from './icons';
import {
  GetInitialState,
  OpenSteam,
  RefreshFileStatus,
  SaveConnection,
  SaveModuleSettings,
  SelectGameExecutable,
  SetDirty,
  StartGame,
  UpdatePreferences,
} from '../wailsjs/go/main/App';
import { main } from '../wailsjs/go/models';
import { ClipboardSetText, EventsOn } from '../wailsjs/runtime/runtime';

type PageKey = 'home' | 'network' | 'module';
type ModuleTab = 'features' | 'logging';
type Tone = 'neutral' | 'ok' | 'err' | 'warn';

interface LogEntry {
  id: number;
  stamp: string;
  text: LocalizedLike;
}

interface LaunchUpdateEvent {
  stage: boolean;
  timestamp: string;
  text: LocalizedLike;
}

interface LaunchCompleteEvent {
  success: boolean;
  timestamp: string;
  message: LocalizedLike;
  gameRunning: boolean;
}

interface GameExitedEvent {
  wasSuccess: boolean;
  timestamp: string;
  message: LocalizedLike;
}

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function checkIpv4Format(raw: string): boolean {
  const text = raw.trim();
  if (!text || text === '0.0.0.0' || text === '255.255.255.255') return false;
  const parts = text.split('.');
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    if (n < 0 || n > 255) return false;
  }
  return true;
}

function checkPortFormat(raw: string): boolean {
  const text = raw.trim();
  if (!/^\d{1,5}$/.test(text)) return false;
  const n = Number(text);
  return n >= 1 && n <= 65535;
}

function parseTaggedLog(line: string): { tag: string | null; kind: 'identity' | 'game' | 'injector' | 'plain'; rest: string } {
  const match = line.match(/^\[(身份|Identity|游戏|Game|注入器|Injector)\]\s*(.*)$/);
  if (!match) {
    return { tag: null, kind: 'plain', rest: line };
  }
  const rawTag = match[1];
  const rest = match[2] || '';
  if (rawTag === '身份' || rawTag === 'Identity') {
    return { tag: rawTag, kind: 'identity', rest };
  }
  if (rawTag === '游戏' || rawTag === 'Game') {
    return { tag: rawTag, kind: 'game', rest };
  }
  return { tag: rawTag, kind: 'injector', rest };
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<PageKey>('home');
  const [moduleTab, setModuleTab] = useState<ModuleTab>('features');

  const [dark, setDark] = useState(true);
  const [locale, setLocale] = useState<Locale>('zh');

  const [toggleDefs, setToggleDefs] = useState<main.ToggleDef[]>([]);
  const [files, setFiles] = useState<main.FileStatus | null>(null);

  const [savedHost, setSavedHost] = useState('127.0.0.1');
  const [savedPort, setSavedPort] = useState('21000');
  const [savedToggles, setSavedToggles] = useState<boolean[]>([]);

  const [editedHost, setEditedHost] = useState('127.0.0.1');
  const [editedPort, setEditedPort] = useState('21000');
  const [editedToggles, setEditedToggles] = useState<boolean[]>([]);

  const [hostError, setHostError] = useState<LocalizedLike | null>(null);
  const [portError, setPortError] = useState<LocalizedLike | null>(null);

  const [loadWarning, setLoadWarning] = useState<LocalizedLike | null>(null);
  const [notice, setNotice] = useState<LocalizedLike | null>(null);
  const [noticeTone, setNoticeTone] = useState<Tone>('neutral');

  const [status, setStatus] = useState<LocalizedLike | null>(null);
  const [statusTone, setStatusTone] = useState<Tone>('neutral');
  const [busy, setBusy] = useState(false);

  const [logExpanded, setLogExpanded] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const logIdRef = useRef(1);
  const logViewerRef = useRef<HTMLDivElement | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  const t = useCallback((item: LocalizedLike | null | undefined) => pickText(item, locale), [locale]);

  const appendLog = useCallback((text: LocalizedLike, customStamp?: string) => {
    const id = logIdRef.current++;
    const stamp = customStamp || nowStamp();
    setLogs((prev) => {
      const next = [...prev, { id, stamp, text }];
      return next.length > 800 ? next.slice(next.length - 800) : next;
    });
    setCopied(false);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => {
    let active = true;
    GetInitialState().then((init) => {
      if (!active) return;
      const isDark = Boolean(init.preferences.dark);
      const loc: Locale = init.preferences.locale === 'en' ? 'en' : 'zh';
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');

      setDark(isDark);
      setLocale(loc);
      setToggleDefs(init.toggleDefs || []);
      setFiles(init.files);
      setBusy(Boolean(init.files?.busy));

      setSavedHost(init.settings.host);
      setSavedPort(init.settings.port);
      setSavedToggles([...init.settings.toggles]);

      setEditedHost(init.settings.host);
      setEditedPort(init.settings.port);
      setEditedToggles([...init.settings.toggles]);

      if (init.loadWarning) {
        setLoadWarning(init.loadWarning);
      }
      if (init.pathWarning) {
        setStatus(init.pathWarning);
        setStatusTone('neutral');
      }

      const initialEntries: LogEntry[] = [];
      const stamp = nowStamp();
      if (init.pathWarning) {
        initialEntries.push({ id: logIdRef.current++, stamp, text: init.pathWarning });
      }
      if (init.loadWarning) {
        initialEntries.push({ id: logIdRef.current++, stamp, text: init.loadWarning });
      }
      if (initialEntries.length > 0) {
        setLogs(initialEntries);
      }

      setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const offUpdate = EventsOn('launch:update', (payload: LaunchUpdateEvent) => {
      if (payload.stage) {
        setStatus(payload.text);
        setStatusTone('neutral');
      }
      appendLog(payload.text, payload.timestamp);
    });

    const offComplete = EventsOn('launch:complete', (payload: LaunchCompleteEvent) => {
      setBusy(false);
      setStatus(payload.message);
      setStatusTone(payload.success ? 'ok' : 'err');
      setFiles((prev) => (prev ? main.FileStatus.createFrom({ ...prev, busy: false, gameRunning: payload.gameRunning }) : prev));
      appendLog(payload.message, payload.timestamp);
      if (!payload.success) {
        setLogExpanded(true);
      }
    });

    const offExited = EventsOn('game:exited', (payload: GameExitedEvent) => {
      setFiles((prev) => (prev ? main.FileStatus.createFrom({ ...prev, gameRunning: false }) : prev));
      if (payload.wasSuccess && payload.message) {
        setStatus(payload.message);
        setStatusTone('neutral');
        appendLog(payload.message, payload.timestamp);
      }
    });

    return () => {
      offUpdate();
      offComplete();
      offExited();
    };
  }, [appendLog]);

  useEffect(() => {
    if (!ready) return;
    const refresh = () => {
      RefreshFileStatus().then((next) => {
        setFiles(next);
        setBusy(next.busy);
      });
    };
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 2500);
    return () => {
      window.removeEventListener('focus', refresh);
      window.clearInterval(timer);
    };
  }, [ready]);

  useEffect(() => {
    setAvatarFailed(false);
  }, [files?.steam?.avatarUrl]);

  const networkDirty = useMemo(
    () => editedHost.trim() !== savedHost || editedPort.trim() !== savedPort,
    [editedHost, editedPort, savedHost, savedPort]
  );

  const moduleDirty = useMemo(
    () => editedToggles.some((val, i) => val !== savedToggles[i]),
    [editedToggles, savedToggles]
  );
  const anyDirty = networkDirty || moduleDirty;

  useEffect(() => {
    if (!ready) return;
    SetDirty(anyDirty);
  }, [ready, anyDirty]);

  useEffect(() => {
    if (logExpanded && logViewerRef.current) {
      logViewerRef.current.scrollTop = logViewerRef.current.scrollHeight;
    }
  }, [logs, logExpanded]);

  const switchPage = (target: PageKey) => {
    setPage(target);
    setNotice(null);
    setNoticeTone('neutral');
  };

  const handleToggleTheme = async () => {
    const nextDark = !dark;
    setDark(nextDark);
    const err = await UpdatePreferences(nextDark, locale);
    if (err) {
      setStatus(err);
      setStatusTone('err');
      setNotice(err);
      setNoticeTone('err');
      appendLog(err);
    }
  };

  const handleToggleLocale = async () => {
    const nextLocale: Locale = locale === 'zh' ? 'en' : 'zh';
    setLocale(nextLocale);
    const err = await UpdatePreferences(dark, nextLocale);
    if (err) {
      setStatus(err);
      setStatusTone('err');
      setNotice(err);
      setNoticeTone('err');
      appendLog(err);
    }
  };

  const handleBrowseGame = async () => {
    if (busy) return;
    const res = await SelectGameExecutable();
    if (res.cancelled) return;
    setFiles(res.files);
    if (res.message) {
      const okTone: Tone = res.ok && res.saved ? 'ok' : 'err';
      setStatus(res.message);
      setStatusTone(okTone);
      appendLog(res.message);
    }
  };

  const handleSaveConnection = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (busy) return;
    const res = await SaveConnection(editedHost, editedPort);
    setHostError(res.hostError || null);
    setPortError(res.portError || null);

    if (!res.ok) {
      setNotice(res.message);
      setNoticeTone('err');
      appendLog(res.message);
      return;
    }

    setSavedHost(res.host);
    setSavedPort(res.port);
    setEditedHost(res.host);
    setEditedPort(res.port);
    setLoadWarning(null);
    setFiles((prev) => (prev ? main.FileStatus.createFrom({ ...prev, iniExists: res.iniExists }) : prev));
    setNotice(res.message);
    setNoticeTone('ok');
    appendLog(res.message);
  };

  const handleRevertConnection = () => {
    setEditedHost(savedHost);
    setEditedPort(savedPort);
    setHostError(null);
    setPortError(null);
    setNotice(null);
  };

  const handleToggleSwitch = (idx: number) => {
    if (busy) return;
    setEditedToggles((prev) => {
      const next = [...prev];
      next[idx] = !next[idx];
      return next;
    });
    setNotice(null);
  };

  const handleResetTabDefaults = () => {
    if (busy) return;
    const targetDefs = toggleDefs.filter((d) => d.category === moduleTab);
    setEditedToggles((prev) => {
      const next = [...prev];
      for (const def of targetDefs) {
        next[def.index] = Boolean(def.defaultValue);
      }
      return next;
    });
    setNotice(null);
  };

  const handleSaveModule = async () => {
    if (busy) return;
    const res = await SaveModuleSettings(editedToggles);
    if (!res.ok) {
      setNotice(res.message);
      setNoticeTone('err');
      appendLog(res.message);
      return;
    }
    setSavedToggles([...res.toggles]);
    setEditedToggles([...res.toggles]);
    setLoadWarning(null);
    setFiles((prev) => (prev ? main.FileStatus.createFrom({ ...prev, iniExists: res.iniExists }) : prev));
    setNotice(res.message);
    setNoticeTone(res.changed > 0 ? 'ok' : 'neutral');
    appendLog(res.message);
  };

  const handleRevertModule = () => {
    setEditedToggles([...savedToggles]);
    setNotice(null);
  };

  const handleOpenSteam = async () => {
    if (busy) return;
    const err = await OpenSteam();
    if (err) {
      setStatus(err);
      setStatusTone('err');
      appendLog(err);
    }
  };

  const handleStartGame = async () => {
    if (busy || files?.gameRunning) return;
    if (!files?.steam?.loggedIn) {
      setStatus(UI_TEXT.steamLoginRequiredHint);
      setStatusTone('err');
      appendLog(UI_TEXT.steamLoginRequiredHint);
      return;
    }
    if (networkDirty || moduleDirty) {
      setPage(networkDirty ? 'network' : 'module');
      setNotice(UI_TEXT.unsavedBeforeLaunch);
      setNoticeTone('err');
      appendLog(UI_TEXT.unsavedBeforeLaunch);
      return;
    }

    setBusy(true);
    setStatusTone('neutral');
    setLogs([]);
    setCopied(false);

    const res = await StartGame();
    if (!res.started) {
      setBusy(false);
      if (res.files) {
        setFiles(res.files);
      }
      if (res.message) {
        setStatus(res.message);
        setStatusTone('err');
        appendLog(res.message);
      }
    }
  };
  const handleCopyLog = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const content = logs.map((entry) => `[${entry.stamp}] ${pickText(entry.text, locale)}`).join('\r\n');
    let ok = false;
    try {
      ok = await ClipboardSetText(content);
    } catch {
      ok = false;
    }
    if (!ok && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(content);
        ok = true;
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      setStatus(UI_TEXT.copyFailed);
      setStatusTone('err');
      return;
    }
    setCopied(true);
    if (copyTimerRef.current) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => setCopied(false), 2200);
  };

  const gameOk = Boolean(files?.gameOk);
  const moduleOk = Boolean(files?.moduleOk);
  const iniExists = Boolean(files?.iniExists);
  const gameRunning = Boolean(files?.gameRunning);
  const steam = files?.steam;
  const steamOk = Boolean(steam?.loggedIn);
  const steamInstalled = Boolean(steam?.installed);
  const steamRunning = Boolean(steam?.running);
  const allFilesOk = gameOk && moduleOk;
  const canLaunch = !busy && !gameRunning && allFilesOk && steamOk;
  const featureDefs = useMemo(() => toggleDefs.filter((d) => d.category === 'features'), [toggleDefs]);
  const loggingDefs = useMemo(() => toggleDefs.filter((d) => d.category === 'logging'), [toggleDefs]);
  const visibleToggles = moduleTab === 'features' ? featureDefs : loggingDefs;

  const outputLogDefs = useMemo(() => loggingDefs.filter((d) => t(d.description) !== ''), [loggingDefs, t]);
  const channelLogDefs = useMemo(() => loggingDefs.filter((d) => t(d.description) === ''), [loggingDefs, t]);

  const activeFeaturesCount = useMemo(
    () => featureDefs.reduce((acc, d) => acc + (editedToggles[d.index] ? 1 : 0), 0),
    [featureDefs, editedToggles]
  );
  const activeLoggingCount = useMemo(
    () => loggingDefs.reduce((acc, d) => acc + (editedToggles[d.index] ? 1 : 0), 0),
    [loggingDefs, editedToggles]
  );

  const tabMatchesDefaults = useMemo(
    () => visibleToggles.every((d) => Boolean(editedToggles[d.index]) === Boolean(d.defaultValue)),
    [visibleToggles, editedToggles]
  );

  const savedEndpointIsLocal = savedHost.trim() === '127.0.0.1';
  const editedHostValid = checkIpv4Format(editedHost);
  const editedPortValid = checkPortFormat(editedPort);
  const editedEndpointIsLocal = editedHost.trim() === '127.0.0.1';

  const heroStatus = useMemo((): { text: string; state: 'ok' | 'busy' | 'live' | 'warn' | 'err' } => {
    if (busy) return { text: status ? t(status) : t(UI_TEXT.stateLaunching), state: 'busy' };
    if (status && statusTone === 'err') return { text: t(status), state: 'err' };
    if (gameRunning) return { text: t(UI_TEXT.stateRunning), state: 'live' };
    if (!allFilesOk) return { text: t(UI_TEXT.stateMissing), state: 'err' };
    if (!steamOk) return { text: t(UI_TEXT.stateSteamRequired), state: 'err' };
    if (anyDirty) return { text: t(UI_TEXT.stateUnsaved), state: 'warn' };
    if (status && statusTone === 'ok') return { text: t(status), state: 'ok' };
    return { text: t(UI_TEXT.stateReady), state: 'ok' };
  }, [busy, status, statusTone, gameRunning, allFilesOk, steamOk, anyDirty, t]);

  const latestLogPreview = useMemo(() => {
    if (logs.length === 0) return '';
    const last = logs[logs.length - 1];
    return `${last.stamp}  ${pickText(last.text, locale)}`;
  }, [logs, locale]);

  const networkFeedback = useMemo((): { text: string; tone: Tone } | null => {
    if (notice) return { text: t(notice), tone: noticeTone };
    if (networkDirty) return { text: t(UI_TEXT.stateUnsaved), tone: 'warn' };
    if (loadWarning) return { text: t(loadWarning), tone: 'neutral' };
    return null;
  }, [notice, noticeTone, networkDirty, loadWarning, t]);

  const moduleFeedback = useMemo((): { text: string; tone: Tone } | null => {
    if (notice) return { text: t(notice), tone: noticeTone };
    if (moduleDirty) return { text: t(UI_TEXT.stateUnsaved), tone: 'warn' };
    if (loadWarning) return { text: t(loadWarning), tone: 'neutral' };
    return null;
  }, [notice, noticeTone, moduleDirty, loadWarning, t]);

  const renderToggleCard = (def: main.ToggleDef, compactChannel: boolean) => {
    const isOn = Boolean(editedToggles[def.index]);
    const isModified = editedToggles[def.index] !== savedToggles[def.index];
    const desc = t(def.description);
    return (
      <button
        key={def.key}
        type="button"
        role="switch"
        aria-checked={isOn}
        disabled={busy}
        className={`toggle-card ${compactChannel ? 'channel' : ''} ${isOn ? 'is-on' : ''} ${
          isModified ? 'modified' : ''
        }`}
        onClick={() => handleToggleSwitch(def.index)}
      >
        <div className="toggle-info">
          <div className="toggle-title">{t(def.label)}</div>
          {desc && <div className="toggle-desc">{desc}</div>}
        </div>
        <span className={`switch-track ${isOn ? 'on' : ''}`}>
          <span className="switch-thumb" />
        </span>
      </button>
    );
  };

  return (
    <div className="launcher-shell">
      <div className="ambient-backdrop" aria-hidden="true">
        <div className="ambient-orb orb-top" />
        <div className="ambient-orb orb-bottom" />
      </div>

      {/* Minimal Architectural Rail */}
      <aside className="sidebar">
        <div className="brand-plaque">
          <div className={`brand-emblem-wrap ${busy || gameRunning ? 'pulsing' : ''}`}>
            <img className="brand-logo" src={logoGranite} alt="Granite" draggable={false} />
          </div>
          <div className="brand-title-row">
            <span className="brand-title">GRANITE</span>
            <span className="brand-edition">22</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Primary">
          <button
            type="button"
            className={`nav-btn ${page === 'home' ? 'active' : ''}`}
            onClick={() => switchPage('home')}
          >
            <span className="nav-icon-tile">
              <IconPlay className="nav-icon" />
            </span>
            <span className="nav-label">{t(UI_TEXT.navPlay)}</span>
            <span className={`nav-pip ${gameRunning ? 'live' : busy ? 'busy' : allFilesOk && steamOk ? 'ok' : 'err'}`} />
          </button>

          <button
            type="button"
            className={`nav-btn ${page === 'network' ? 'active' : ''}`}
            onClick={() => switchPage('network')}
          >
            <span className="nav-icon-tile">
              <IconNetwork className="nav-icon" />
            </span>
            <span className="nav-label">{t(UI_TEXT.navConnection)}</span>
            {networkDirty && <span className="dirty-dot" />}
          </button>

          <button
            type="button"
            className={`nav-btn ${page === 'module' ? 'active' : ''}`}
            onClick={() => switchPage('module')}
          >
            <span className="nav-icon-tile">
              <IconSliders className="nav-icon" />
            </span>
            <span className="nav-label">{t(UI_TEXT.navModule)}</span>
            {moduleDirty && <span className="dirty-dot" />}
          </button>
        </nav>

        <div className="sidebar-spacer" />

        <div className="prefs-dock">
          <button type="button" className="pref-pill" onClick={handleToggleTheme}>
            {dark ? <IconSun className="pref-icon" /> : <IconMoon className="pref-icon" />}
            <span>{dark ? t(UI_TEXT.switchToLight) : t(UI_TEXT.switchToDark)}</span>
          </button>

          <button type="button" className="pref-pill" onClick={handleToggleLocale}>
            <IconLanguage className="pref-icon" />
            <span className="lang-pair">
              <span className={locale === 'zh' ? 'active' : ''}>中</span>
              <span className="lang-sep">/</span>
              <span className={locale === 'en' ? 'active' : ''}>EN</span>
            </span>
          </button>
        </div>
      </aside>

      {/* Main Workspace */}
      <main className="workspace">
        {page === 'home' && (
          <div className="page-body home-body">
            {/* Poster-Scale Arena Hero */}
            <section className="hero-stage">
              <CourtBlueprintSvg className="hero-court-blueprint" />
              <div className="hero-spotlight" aria-hidden="true" />

              <div className="hero-left">
                <div className={`state-badge ${heroStatus.state}`}>
                  {heroStatus.state === 'busy' ? (
                    <span className="mini-spinner" />
                  ) : (
                    <span className="state-badge-dot" />
                  )}
                  <span>{heroStatus.text}</span>
                </div>

                <h1 className="hero-display">
                  <span>NBA</span>
                  <span className="hero-accent-word">2K22</span>
                </h1>

                <div className="hero-actions">
                  <button
                    type="button"
                    className={`btn btn-primary btn-launch ${gameRunning ? 'is-running' : ''}`}
                    disabled={!canLaunch}
                    onClick={handleStartGame}
                  >
                    <span className="launch-sheen" aria-hidden="true" />
                    {busy ? (
                      <span className="spinner spinner-on-accent" />
                    ) : gameRunning ? (
                      <IconRadio className="launch-btn-icon" />
                    ) : (
                      <IconPlay className="launch-btn-icon" />
                    )}
                    <span>
                      {busy
                        ? t(UI_TEXT.startingGame)
                        : gameRunning
                          ? t(UI_TEXT.gameRunning)
                          : t(UI_TEXT.startGame)}
                    </span>
                  </button>

                  <button
                    type="button"
                    className="server-pill-btn"
                    onClick={() => switchPage('network')}
                  >
                    <span className={`endpoint-dot ${savedEndpointIsLocal ? 'local' : 'lan'}`} />
                    <span className="server-pill-addr">
                      {savedHost}:{savedPort}
                    </span>
                    <span className={`node-mode-pill ${savedEndpointIsLocal ? 'local' : 'lan'}`}>
                      {savedEndpointIsLocal ? t(UI_TEXT.modeLocal) : t(UI_TEXT.modeLan)}
                    </span>
                    <IconArrowRight className="pill-arrow" />
                  </button>
                </div>
              </div>

              <div className="hero-orb-stage" aria-hidden="true">
                <div className="hero-orb-ring" />
                <div className="hero-orb-inner-ring" />
                <img className="hero-emblem" src={logoGranite} alt="" draggable={false} />
              </div>
            </section>

            {/* Single-Row Game Executable Bar */}
            <section className={`card path-card ${gameOk ? 'ok' : 'err'}`}>
              <div className={`tile-icon-box ${gameOk ? 'ok' : 'err'}`}>
                <IconFolder className="tile-icon" />
              </div>
              <input
                type="text"
                readOnly
                title={files?.gamePath || t(UI_TEXT.gamePlaceholder)}
                className={`text-input mono readonly path-bare ${!files?.gamePath ? 'placeholder' : ''}`}
                value={files?.gamePath || t(UI_TEXT.gamePlaceholder)}
              />
              <button type="button" className="btn btn-elevated btn-sm" disabled={busy} onClick={handleBrowseGame}>
                <span>{t(UI_TEXT.browse)}</span>
              </button>
            </section>

            {/* Launch File Status */}
            <section className="hardware-row">
              <div className={`card hw-chip ${moduleOk ? 'ok' : 'err'}`}>
                <IconCpu className={`hw-icon ${moduleOk ? 'ok' : 'err'}`} />
                <span className="hw-name">Module.dll</span>
                {moduleOk ? (
                  <span className="hw-dot ok" />
                ) : (
                  <span className="hw-tag err">{t(UI_TEXT.fileMissing)}</span>
                )}
              </div>

              <button
                type="button"
                className={`card hw-chip interactive ${anyDirty ? 'warn' : 'ok'}`}
                onClick={() => switchPage(networkDirty ? 'network' : 'module')}
              >
                <IconFileConfig className={`hw-icon ${anyDirty ? 'warn' : 'ok'}`} />
                <span className="hw-name">Granite.ini</span>
                {anyDirty ? (
                  <span className="hw-tag warn">{t(UI_TEXT.stateUnsaved)}</span>
                ) : !iniExists ? (
                  <span className="hw-tag muted">{t(UI_TEXT.iniDefault)}</span>
                ) : (
                  <span className="hw-dot ok" />
                )}
              </button>
            </section>

            {/* Steam Login & Identity Card */}
            <section className={`card steam-card ${steamOk ? 'ok' : steamRunning ? 'warn' : 'err'}`}>
              <div className={`steam-avatar-wrap ${steamOk ? 'ok' : steamRunning ? 'warn' : 'err'}`}>
                {steamOk && steam?.avatarUrl && !avatarFailed ? (
                  <img
                    className="steam-avatar-img"
                    src={steam.avatarUrl}
                    alt=""
                    draggable={false}
                    onError={() => setAvatarFailed(true)}
                  />
                ) : (
                  <IconSteam className="steam-avatar-icon" />
                )}
                <span className={`steam-presence-dot ${steamOk ? 'ok' : steamRunning ? 'warn' : 'err'}`} />
              </div>

              <div className="steam-meta">
                <div className="steam-title-row">
                  <span className="steam-primary-name">
                    {steamOk
                      ? steam?.personaName || steam?.accountName || 'Steam'
                      : !steamInstalled
                        ? t(UI_TEXT.steamTitleNotFound)
                        : steamRunning
                          ? t(UI_TEXT.steamTitleNotSignedIn)
                          : t(UI_TEXT.steamTitleNotRunning)}
                  </span>
                  <span className="steam-brand-tag">
                    <IconSteam className="steam-brand-icon" />
                    <span>STEAM</span>
                  </span>
                </div>

                {steamOk ? (
                  <div className="steam-sub-row mono">
                    {steam?.accountName && (
                      <>
                        <span className="steam-sub-item">
                          <span className="steam-sub-key">{t(UI_TEXT.steamAccountPrefix)}</span>
                          <span className="steam-sub-val">{steam.accountName}</span>
                        </span>
                        <span className="steam-sub-sep">·</span>
                      </>
                    )}
                    <span className="steam-sub-item">
                      <span className="steam-sub-key">SteamID</span>
                      <span className="steam-sub-val">{steam?.steamId64}</span>
                    </span>
                  </div>
                ) : (
                  <div className="steam-sub-row hint">
                    {steamInstalled ? t(UI_TEXT.steamLoginRequiredHint) : t(UI_TEXT.steamInstallRequiredHint)}
                  </div>
                )}
              </div>

              <div className="steam-right">
                {!steamOk && steamInstalled && (
                  <button type="button" className="btn btn-elevated btn-sm" disabled={busy} onClick={handleOpenSteam}>
                    <span>{t(UI_TEXT.openSteam)}</span>
                  </button>
                )}
                <div className={`steam-state-pill ${steamOk ? 'ok' : 'err'}`}>
                  <span className="steam-state-dot" />
                  <span>{steamOk ? t(UI_TEXT.steamSignedIn) : t(UI_TEXT.steamNotSignedIn)}</span>
                </div>
              </div>
            </section>

            <div className="home-spacer" />

            {/* Minimal Collapsible Console Bar */}
            <section className={`console-drawer ${logExpanded ? 'expanded' : ''}`}>
              <div
                className="console-bar"
                role="button"
                tabIndex={0}
                aria-expanded={logExpanded}
                onClick={() => setLogExpanded((prev) => !prev)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setLogExpanded((prev) => !prev);
                  }
                }}
              >
                <div className="console-bar-left">
                  <IconTerminal className="console-icon" />
                  <span className="console-title">{t(UI_TEXT.consoleTitle)}</span>
                  {logs.length > 0 && <span className="count-chip">{logs.length}</span>}
                  {!logExpanded && latestLogPreview && (
                    <span className="console-preview">{latestLogPreview}</span>
                  )}
                </div>

                <div className="console-bar-right">
                  {logs.length > 0 && (
                    <button type="button" className="btn btn-xs" onClick={handleCopyLog}>
                      {copied ? <IconCheck className="xs-icon ok" /> : <IconCopy className="xs-icon" />}
                      <span>{copied ? t(UI_TEXT.copied) : t(UI_TEXT.copyLog)}</span>
                    </button>
                  )}
                  <IconChevron className="xs-icon muted" expanded={logExpanded} />
                </div>
              </div>

              {logExpanded && (
                <div className="log-viewer" ref={logViewerRef}>
                  {logs.length === 0 ? (
                    <div className="log-empty">{t(UI_TEXT.emptyLog)}</div>
                  ) : (
                    logs.map((entry) => {
                      const parsed = parseTaggedLog(t(entry.text));
                      return (
                        <div className="log-line" key={entry.id}>
                          <span className="log-stamp">{entry.stamp}</span>
                          {parsed.tag && <span className={`log-tag ${parsed.kind}`}>{parsed.tag}</span>}
                          <span className="log-msg">{parsed.rest}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </section>
          </div>
        )}

        {page === 'network' && (
          <>
            <header className="top-bar">
              <h1 className="page-title">{t(UI_TEXT.networkTitle)}</h1>
              <span className="ini-section-tag">Granite.ini · [Network]</span>
            </header>

            <form className="page-body" onSubmit={handleSaveConnection}>
              {/* Visual Link Diagram */}
              <section className="card topology-card">
                <div className="topo-node">
                  <div className="topo-icon-box client">
                    <IconCpu className="topo-icon" />
                  </div>
                  <span className="topo-value">NBA 2K22</span>
                </div>

                <div className="topo-bridge" aria-hidden="true">
                  <span className="topo-line" />
                  <span className="topo-proto-pill">HTTPS</span>
                  <span className="topo-line" />
                </div>

                <div className="topo-node server">
                  <span className="topo-value mono">
                    {editedHost.trim() || '—'}:{editedPort.trim() || '—'}
                  </span>
                  <span
                    className={`node-mode-pill ${
                      !editedHostValid || !editedPortValid
                        ? 'err'
                        : editedEndpointIsLocal
                          ? 'local'
                          : 'lan'
                    }`}
                  >
                    {!editedHostValid || !editedPortValid
                      ? t(UI_TEXT.modeInvalid)
                      : editedEndpointIsLocal
                        ? t(UI_TEXT.modeLocal)
                        : t(UI_TEXT.modeLan)}
                  </span>
                  <div className={`topo-icon-box ${editedHostValid && editedPortValid ? 'ok' : 'err'}`}>
                    <IconServer className="topo-icon" />
                  </div>
                </div>
              </section>

              {/* Clean Dual Input Card */}
              <section className="card form-card">
                <div className="network-grid">
                  <div className="field-group">
                    <label className="field-label" htmlFor="host-input">
                      {t(UI_TEXT.serverIpv4)}
                    </label>
                    <div className={`input-shell ${hostError ? 'invalid' : ''}`}>
                      <input
                        id="host-input"
                        type="text"
                        maxLength={63}
                        disabled={busy}
                        className="text-input mono shelled"
                        value={editedHost}
                        placeholder="127.0.0.1"
                        onChange={(e) => {
                          setEditedHost(e.target.value);
                          setHostError(null);
                          setNotice(null);
                        }}
                      />
                      {editedHost.trim() !== '127.0.0.1' && (
                        <button
                          type="button"
                          className="inline-preset-btn"
                          disabled={busy}
                          onClick={() => {
                            setEditedHost('127.0.0.1');
                            setHostError(null);
                            setNotice(null);
                          }}
                        >
                          {t(UI_TEXT.useLocalhost)}
                        </button>
                      )}
                    </div>
                    {hostError && <div className="field-hint err">{t(hostError)}</div>}
                  </div>

                  <div className="field-group">
                    <label className="field-label" htmlFor="port-input">
                      {t(UI_TEXT.httpsPort)}
                    </label>
                    <div className={`input-shell ${portError ? 'invalid' : ''}`}>
                      <input
                        id="port-input"
                        type="text"
                        maxLength={5}
                        disabled={busy}
                        className="text-input mono shelled"
                        value={editedPort}
                        placeholder="21000"
                        onChange={(e) => {
                          setEditedPort(e.target.value);
                          setPortError(null);
                          setNotice(null);
                        }}
                      />
                      {editedPort.trim() !== '21000' && (
                        <button
                          type="button"
                          className="inline-preset-btn"
                          disabled={busy}
                          onClick={() => {
                            setEditedPort('21000');
                            setPortError(null);
                            setNotice(null);
                          }}
                        >
                          {t(UI_TEXT.useDefaultPort)}
                        </button>
                      )}
                    </div>
                    {portError && <div className="field-hint err">{t(portError)}</div>}
                  </div>
                </div>

                <div className="port-pills-row">
                  <span className="port-pill">TCP 21000</span>
                  <span className="port-pill">TCP 20054</span>
                  <span className="port-pill">UDP 28091</span>
                </div>
              </section>
            </form>

            <footer className="action-footer">
              <div className="footer-left">
                {networkFeedback && (
                  <div className={`feedback-row ${networkFeedback.tone}`}>
                    <span className={`feedback-dot ${networkFeedback.tone}`} />
                    <span className="feedback-text">{networkFeedback.text}</span>
                  </div>
                )}
              </div>
              <div className="footer-actions">
                {networkDirty && (
                  <button type="button" className="btn btn-elevated" disabled={busy} onClick={handleRevertConnection}>
                    <IconRotateCcw className="btn-icon" />
                    <span>{t(UI_TEXT.revert)}</span>
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => handleSaveConnection()}
                >
                  <IconCheck className="btn-icon" />
                  <span>{t(UI_TEXT.save)}</span>
                </button>
              </div>
            </footer>
          </>
        )}

        {page === 'module' && (
          <>
            <header className="top-bar">
              <h1 className="page-title">{t(UI_TEXT.moduleTitle)}</h1>

              <div className="top-bar-controls">
                <div className="tabs-bar" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={moduleTab === 'features'}
                    className={`tab-btn ${moduleTab === 'features' ? 'active' : ''}`}
                    onClick={() => setModuleTab('features')}
                  >
                    <span>{t(UI_TEXT.tabFeatures)}</span>
                    <span className="count-chip">
                      {activeFeaturesCount}/{featureDefs.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={moduleTab === 'logging'}
                    className={`tab-btn ${moduleTab === 'logging' ? 'active' : ''}`}
                    onClick={() => setModuleTab('logging')}
                  >
                    <span>{t(UI_TEXT.tabLogging)}</span>
                    <span className="count-chip">
                      {activeLoggingCount}/{loggingDefs.length}
                    </span>
                  </button>
                </div>

                <button
                  type="button"
                  className="btn btn-sm btn-elevated"
                  disabled={busy || tabMatchesDefaults}
                  onClick={handleResetTabDefaults}
                >
                  <IconRotateCcw className="xs-icon" />
                  <span>{t(UI_TEXT.resetDefaults)}</span>
                </button>
              </div>
            </header>

            <div className="page-body">
              {moduleTab === 'features' ? (
                <div className="toggles-grid two-col" key="features">
                  {featureDefs.map((def) => renderToggleCard(def, false))}
                </div>
              ) : (
                <div className="logging-layout" key="logging">
                  {outputLogDefs.length > 0 && (
                    <div className="toggles-grid two-col">
                      {outputLogDefs.map((def) => renderToggleCard(def, false))}
                    </div>
                  )}
                  <div className={`toggles-grid ${channelLogDefs.length <= 4 ? 'two-col' : 'three-col'}`}>
                    {channelLogDefs.map((def) => renderToggleCard(def, true))}
                  </div>
                </div>
              )}
            </div>

            <footer className="action-footer">
              <div className="footer-left">
                {moduleFeedback && (
                  <div className={`feedback-row ${moduleFeedback.tone}`}>
                    <span className={`feedback-dot ${moduleFeedback.tone}`} />
                    <span className="feedback-text">{moduleFeedback.text}</span>
                  </div>
                )}
              </div>
              <div className="footer-actions">
                {moduleDirty && (
                  <button type="button" className="btn btn-elevated" disabled={busy} onClick={handleRevertModule}>
                    <IconRotateCcw className="btn-icon" />
                    <span>{t(UI_TEXT.revert)}</span>
                  </button>
                )}
                <button type="button" className="btn btn-primary" disabled={busy} onClick={handleSaveModule}>
                  <IconCheck className="btn-icon" />
                  <span>{t(UI_TEXT.save)}</span>
                </button>
              </div>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
