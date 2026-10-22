import type { CSSProperties } from 'react';
import { PALETTES, type ThemeMode } from '../render/theme.ts';
import { Icon } from './icon.tsx';

export function ThemePicker({ value, lastDayTheme = 'light', lastNightTheme = 'dark', onChange }: {
  value: ThemeMode; lastDayTheme?: ThemeMode; lastNightTheme?: ThemeMode; onChange(theme: ThemeMode): void;
}) {
  const scheme = PALETTES[value].scheme;
  return <div className="theme-picker">
    <div className="theme-modes" role="group" aria-label="阅读模式">
      {(['light', 'dark'] as const).map(mode => <button type="button" key={mode} aria-pressed={scheme === mode}
        onClick={() => { if (scheme !== mode) onChange(mode === 'light' ? lastDayTheme : lastNightTheme); }}>
        <Icon name={mode === 'light' ? 'sun' : 'moon'} />{mode === 'light' ? '日间模式' : '夜间模式'}{scheme === mode && <Icon name="check" />}
      </button>)}
    </div>
    <div className="theme-options" role="group" aria-label={scheme === 'light' ? '日间主题' : '夜间主题'}>
      {(Object.entries(PALETTES) as Array<[ThemeMode, typeof PALETTES[ThemeMode]]>)
        .filter(([, palette]) => palette.scheme === scheme).map(([id, palette]) => <button type="button" key={id}
          className="theme-option" data-theme-option={id} aria-label={palette.label} aria-pressed={value === id} onClick={() => onChange(id)}
          style={{ '--theme-paper': palette.background, '--theme-ink': palette.text, '--theme-muted': palette.muted } as CSSProperties}>
          <span className="theme-option-label">{palette.label}{value === id && <Icon name="check" />}</span>
          <span className="theme-option-name">{palette.name}</span>
        </button>)}
    </div>
    <p className="theme-picker-hint">日夜分别记住选择，一键回到喜欢的配色。</p>
  </div>;
}
