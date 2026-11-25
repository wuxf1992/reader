import { useState } from 'react';
import { saveThemePreference, type ThemePreference } from './theme.ts';
import { ThemePicker } from './theme-picker.tsx';
import { useThemeState } from './use-theme.ts';

export function ThemeSettings({ scope }: { scope: string }) {
  const { preference, systemDark } = useThemeState(scope);
  const [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  function save(next: ThemePreference) {
    setError('');
    setSaved(false);
    try {
      saveThemePreference(scope, next);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '主题保存失败');
    }
  }
  return (
    <section className="theme-settings">
      <p className="theme-settings-note">
        书架、设置和阅读页共用主题。选择日间或夜间配色，也可以跟随系统，分别记住日夜配色。
      </p>
      <ThemePicker preference={preference} systemDark={systemDark} onChange={save} />
      {saved && <p role="status">主题已保存</p>}
      {error && (
        <p className="media-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
