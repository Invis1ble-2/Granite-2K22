// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

export type Locale = 'zh' | 'en';

export interface LocalizedLike {
  zh: string;
  en: string;
}

export function pickText(text: LocalizedLike | undefined | null, locale: Locale): string {
  if (!text) return '';
  return locale === 'en' ? text.en : text.zh;
}

export function bi(zh: string, en: string): LocalizedLike {
  return { zh, en };
}

export const UI_TEXT = {
  navPlay: bi('开始', 'Play'),
  navConnection: bi('连接设置', 'Connection Settings'),
  navModule: bi('模块设置', 'Module Settings'),

  switchToLight: bi('浅色', 'Light'),
  switchToDark: bi('深色', 'Dark'),

  networkTitle: bi('服务器', 'Server'),
  moduleTitle: bi('模块', 'Module'),

  stateReady: bi('就绪', 'Ready'),
  stateLaunching: bi('启动中', 'Starting'),
  stateRunning: bi('运行中', 'Running'),
  stateMissing: bi('缺少文件', 'Missing Files'),
  stateSteamRequired: bi('未登录 Steam', 'Steam Required'),
  stateUnsaved: bi('未保存', 'Unsaved'),
  modeLocal: bi('本机', 'Local'),
  modeLan: bi('在线服务器', 'Online Server'),
  modeInvalid: bi('无效', 'Invalid'),

  gamePlaceholder: bi('选择 NBA2K22.exe', 'Select NBA2K22.exe'),
  browse: bi('浏览', 'Browse'),

  fileMissing: bi('缺失', 'Missing'),
  iniDefault: bi('默认', 'Default'),

  unsavedBeforeLaunch: bi('请先保存更改', 'Save pending changes first'),

  startGame: bi('启动游戏', 'PLAY'),
  startingGame: bi('启动中…', 'STARTING…'),
  gameRunning: bi('运行中', 'RUNNING'),

  consoleTitle: bi('日志', 'Logs'),
  copyLog: bi('复制', 'Copy'),
  copied: bi('已复制', 'Copied'),
  emptyLog: bi('暂无日志', 'No logs'),
  copyFailed: bi('复制失败', 'Copy failed'),

  serverIpv4: bi('IP 地址', 'IP Address'),
  httpsPort: bi('端口', 'Port'),
  useLocalhost: bi('使用默认本机地址', 'Use Localhost'),
  useDefaultPort: bi('使用默认端口', 'Use Default Port'),

  save: bi('保存', 'Save'),
  revert: bi('撤销', 'Revert'),

  tabFeatures: bi('功能', 'Features'),
  tabLogging: bi('日志', 'Logs'),
  resetDefaults: bi('默认', 'Defaults'),

  steamSignedIn: bi('已登录', 'Signed In'),
  steamNotSignedIn: bi('未登录', 'Not Signed In'),
  steamTitleNotRunning: bi('Steam 未运行', 'Steam Not Running'),
  steamTitleNotSignedIn: bi('Steam 未登录', 'Steam Not Signed In'),
  steamTitleNotFound: bi('未检测到 Steam', 'Steam Not Found'),
  steamLoginRequiredHint: bi('请先登录 Steam 后再启动游戏', 'Sign in to Steam before launching'),
  steamInstallRequiredHint: bi('请先安装并登录 Steam', 'Install and sign in to Steam first'),
  steamAccountPrefix: bi('账号', 'Account'),
  openSteam: bi('打开 Steam', 'Open Steam'),
} as const;
