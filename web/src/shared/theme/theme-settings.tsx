import { useState } from 'react';
import { saveThemePreference, type ThemePreference } from './theme.ts';
import { ThemePicker } from './theme-picker.tsx';
import { useThemeState } from './use-theme.ts';
import { useSettingsStore } from '../stores/settings.store.ts';
import type { AppSettings } from '../../store/settings.ts';

export function ThemeSettings({ scope, onReaderSettings }: { scope: string; onReaderSettings?: (patch: Partial<AppSettings>) => void }) {
  const { preference, systemDark } = useThemeState(scope);
  const liquidGlass = useSettingsStore(state => state.settings.liquidGlass);
  const [error, setError] = useState(''), [saved, setSaved] = useState(false);
  function save(next: ThemePreference) {
    setError(''); setSaved(false);
    try { saveThemePreference(scope, next); setSaved(true); } catch (cause) { setError(cause instanceof Error ? cause.message : '主题保存失败'); }
  }
  return <section className="theme-settings">
    <p className="theme-settings-note">书架、设置和阅读页共用主题。选择日间或夜间配色，也可以跟随系统，分别记住日夜配色。</p>
    <ThemePicker preference={preference} systemDark={systemDark} onChange={save} />
    {onReaderSettings && <div className="theme-settings-card">
      <button type="button" className="theme-follow" aria-label="液态玻璃" aria-pressed={liquidGlass}
        onClick={() => { onReaderSettings({ liquidGlass: !liquidGlass }); setSaved(true); setError(''); }}>
        <span className="theme-follow-text"><strong>液态玻璃</strong><small>控制栏和面板呈现半透明玻璃效果</small></span>
        <span className="theme-switch" aria-hidden="true" />
      </button>
    </div>}
    {saved && <p role="status">主题已保存</p>}{error && <p className="media-error" role="alert">{error}</p>}
  </section>;
}
