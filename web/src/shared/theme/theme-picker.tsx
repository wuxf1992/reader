import type { CSSProperties } from 'react';
import { resolveAppTheme, resolveTheme, selectTheme, selectedTheme, selectThemeMode, themeOptions, themeTokens, type ThemePreference } from './theme.ts';

/** Both entry points edit one preference; preset colours also select their day/night mode. */
export function ThemePicker({ preference, systemDark, onChange }: { preference: ThemePreference; systemDark: boolean; onChange(preference: ThemePreference): void }) {
  const resolved = resolveAppTheme(preference, systemDark);
  return <>
    <div className="theme-chips" role="group" aria-label="明暗">
      {([{ value: 'light', label: '日间' }, { value: 'dark', label: '夜间' }, { value: 'system', label: '跟随系统' }] as const).map(option =>
        <button type="button" key={option.value} aria-label={option.label} aria-pressed={preference.mode === option.value} onClick={() => onChange(selectThemeMode(preference, option.value))}>{option.label}</button>)}
    </div>
    <div className="theme-swatches" role="group" aria-label="主题配色">
      {themeOptions.map(option => {
        const current = themeTokens(resolveTheme(option.value, resolved.mode));
        return <button type="button" key={option.value} className="theme-swatch" data-reading-theme-option={option.value} aria-label={option.label} aria-pressed={selectedTheme(preference, systemDark) === option.value} onClick={() => onChange(selectTheme(preference, option.value))}>
          <span className="theme-swatch-chip" aria-hidden="true" style={{ backgroundColor: current.bg, color: current.ink, '--chip-line': current.line } as CSSProperties}>Aa</span>
          <span className="theme-swatch-label">{option.label}</span>
        </button>;
      })}
    </div>
    {preference.mode === 'system' && <div className="theme-system-pair">
      {(['light', 'dark'] as const).map(mode => <label key={mode}>{mode === 'light' ? '日间配色' : '夜间配色'}
        <select aria-label={mode === 'light' ? '日间配色' : '夜间配色'} value={preference.system[mode]} onChange={event => onChange({ ...preference, system: { ...preference.system, [mode]: event.target.value } })}>
          {themeOptions.filter(option => resolveTheme(option.value, mode).mode === mode).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>)}
    </div>}
  </>;
}
