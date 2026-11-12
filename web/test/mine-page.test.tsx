// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render } from '../src/shared/ui/render-root.ts';
import { MinePage } from '../src/features/account/pages/MinePage.tsx';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import { useAuthStore } from '../src/shared/stores/auth.store.ts';
import { updatePwa } from '../src/core/pwa.ts';

vi.mock('../src/core/pwa.ts', () => ({ updatePwa: vi.fn() }));

import { saveThemePreference } from '../src/shared/theme/theme.ts';

const root = document.createElement('div');
document.body.append(root);
const signOut = vi.fn(async () => undefined);
const runtime = {
  api: { baseUrl: 'https://reader.example.com/app', signOut },
  mediaApi: { preferenceScope: () => 'mine-test' },
} as any;
const user = (role: 'admin' | 'member') => ({ id: 'u', username: 'lin', displayName: '林间', role, createdAt: 0 });
const paint = () => act(() => render(
  <RuntimeContext.Provider value={runtime}>
    <MemoryRouter initialEntries={['/me']}>
      <Routes><Route path="/me" element={<MinePage />} /></Routes>
    </MemoryRouter>
  </RuntimeContext.Provider>,
  root,
));

afterEach(() => {
  act(() => render(null, root));
  useAuthStore.setState({ session: null, verifiedUser: null });
  localStorage.clear();
  signOut.mockClear();
  vi.mocked(updatePwa).mockReset();
});

describe('我的', () => {
  it('pure reading hides media management but keeps administrator recovery controls',()=>{
    useAuthStore.setState({verifiedUser:{...user('admin'),features:{media:false}}});
    paint();
    const links=[...root.querySelectorAll<HTMLAnchorElement>('a')];
    expect(links.some(link=>link.getAttribute('href')?.startsWith('/media/'))).toBe(false);
    expect(links.some(link=>link.getAttribute('href')==='/me/admin/users')).toBe(true);
    expect(links.some(link=>link.getAttribute('href')==='/me/admin/services')).toBe(true);
    expect(root.textContent).not.toContain('观影');
  });
  it('shows who is signed in, which server, and opens every row as a page', () => {
    useAuthStore.setState({ verifiedUser: user('member') });
    paint();
    expect(root.querySelector('.mine-profile')?.textContent).toContain('林间');
    expect(root.querySelector('.mine-profile')?.textContent).toContain('reader.example.com');
    expect(root.querySelector('.mine-profile')?.textContent).toContain('成员');
    const links = [...root.querySelectorAll<HTMLAnchorElement>('a.mine-row')].map(a => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([
      ['书库', '/library'], ['书源', '/sources'], ['时长统计阅读、观影、听书', '/me/stats'],
      ['偏好设置跟随系统', '/me/settings'],
      ['账号与连接', '/me/account'], ['外部阅读器OPDS', '/me/opds'],
    ]);
    // Updating runs in place; signing out still asks first.
    expect([...root.querySelectorAll('button.mine-row')].map(b => b.textContent)).toEqual(['退出登录', '立即更新检查应用版本']);
    // Members see no administration group.
    expect(root.querySelector('[aria-label="管理"]')).toBeNull();
  });

  it('gathers administration under 管理 for administrators, one page per job, and shows the chosen theme', () => {
    saveThemePreference('mine-test', { theme: 'blue', mode: 'dark' });
    useAuthStore.setState({ verifiedUser: user('admin') });
    paint();
    const labels = [...root.querySelectorAll('.mine-row-label')].map(el => el.textContent);
    expect(labels).toContain('媒体库');
    const admin = [...root.querySelectorAll<HTMLAnchorElement>('[aria-label="管理"] a.mine-row')].map(a => [a.querySelector('.mine-row-label')?.textContent, a.getAttribute('href')]);
    expect(admin).toEqual([
      ['用户管理', '/me/admin/users'], ['注册与邀请', '/me/admin/registration'], ['服务配置', '/me/admin/services'],
      ['扫描与刮削', '/media/video/settings/tasks'],
    ]);
    expect(root.textContent).toContain('雾蓝 · 深色');
    expect(root.querySelector('.mine-profile')?.textContent).toContain('管理员');
  });

  it('signs out through the API, after a confirmation', async () => {
    useAuthStore.setState({ verifiedUser: user('member') });
    paint();
    act(() => { root.querySelector<HTMLButtonElement>('.mine-row.is-danger')!.click(); });
    expect(signOut).not.toHaveBeenCalled();
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('dialog button')].find(button => button.textContent === '退出登录')!;
    await act(async () => { confirm.click(); });
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});


it('offers manual updates to members, disables repeated clicks and announces the result', async () => {
  useAuthStore.setState({ verifiedUser: user('member') });
  let finish!: (value: string) => void;
  vi.mocked(updatePwa).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  paint();
  const button = root.querySelector<HTMLButtonElement>('[aria-label="应用更新"] button')!;
  expect(button.textContent).toContain('立即更新');
  const card = button.closest('section')!;
  expect(card.previousElementSibling?.getAttribute('aria-label')).toBe('账号');
  expect(card.closest('.mine-column')).not.toBeNull();
  expect(card.style.order).toBe('5');
  act(() => { button.click(); button.click(); });
  expect(updatePwa).toHaveBeenCalledTimes(1);
  expect(button.disabled).toBe(true);
  expect(button.getAttribute('aria-busy')).toBe('true');
  expect(button.querySelector('[role=status]')?.textContent).toBe('检查更新中…');
  await act(async () => { finish('已是最新版本'); });
  expect(button.disabled).toBe(false);
  expect(button.querySelector('[role=status]')?.textContent).toBe('已是最新版本');
});

it('shows update failure in place and permits retry without signing out', async () => {
  useAuthStore.setState({ verifiedUser: user('member') });
  vi.mocked(updatePwa).mockRejectedValueOnce(new Error('network')).mockResolvedValue('已是最新版本');
  paint();
  const button = root.querySelector<HTMLButtonElement>('[aria-label="应用更新"] button')!;
  await act(async () => { button.click(); });
  expect(button.querySelector('[role=status]')?.textContent).toBe('更新未完成，请重试');
  expect(button.disabled).toBe(false);
  await act(async () => { button.click(); });
  expect(button.textContent).toContain('已是最新版本');
  expect(signOut).not.toHaveBeenCalled();
});
