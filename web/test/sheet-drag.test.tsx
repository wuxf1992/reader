// @vitest-environment jsdom
import { act } from 'react';
import { render } from '../src/shared/ui/render-root.ts';
import { afterEach, expect, it, vi } from 'vitest';
import { Sheet } from '../src/ui/sheet.tsx';
const root = document.createElement('div'); document.body.append(root);
afterEach(() => { act(() => render(null, root)); vi.unstubAllGlobals(); });
function paint(busy = false, wide = false) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('min-width') && wide, addEventListener() {}, removeEventListener() {} }));
  const close = vi.fn();
  act(() => render(<Sheet title="设置" busy={busy} onClose={close}><input aria-label="测试输入" /></Sheet>, root));
  const dialog = root.querySelector('dialog')!;
  dialog.getBoundingClientRect = () => ({ height: 400 } as DOMRect);
  const pointer = (target: Element, type: string, y: number) => act(() => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { pointerId: 1, isPrimary: true, pointerType: 'touch', button: 0, clientY: y, clientX: 20 });
    target.dispatchEvent(event);
  });
  return { dialog, close, pointer, header: dialog.querySelector('header')! };
}
it('closes a mobile sheet when its title is pulled down, without requiring X or the backdrop', () => {
  const { dialog, close, pointer, header } = paint();
  pointer(header, 'pointerdown', 100); pointer(dialog, 'pointermove', 230);
  expect(dialog.style.getPropertyValue('--sheet-drag-y')).toBe('130px');
  pointer(dialog, 'pointerup', 230); expect(close).toHaveBeenCalledOnce();
});
it('keeps short pulls and cancelled gestures open and clears their preview', () => {
  const { dialog, close, pointer, header } = paint();
  pointer(header, 'pointerdown', 100); pointer(dialog, 'pointermove', 120); pointer(dialog, 'pointerup', 120);
  expect(close).not.toHaveBeenCalled(); expect(dialog.hasAttribute('data-dragging')).toBe(false);
  pointer(header, 'pointerdown', 100); pointer(dialog, 'pointermove', 240); pointer(dialog, 'pointercancel', 240);
  expect(close).not.toHaveBeenCalled(); expect(dialog.style.getPropertyValue('--sheet-drag-y')).toBe('');
});
it.each([{ busy: true, wide: false }, { busy: false, wide: true }])('does not dismiss busy or desktop sheets: %o', ({ busy, wide }) => {
  const { dialog, close, pointer, header } = paint(busy, wide);
  pointer(header, 'pointerdown', 100); pointer(dialog, 'pointermove', 240); pointer(dialog, 'pointerup', 240);
  expect(close).not.toHaveBeenCalled(); expect(dialog.hasAttribute('data-dragging')).toBe(false);
});
it('leaves scrolling and form controls to the panel body', () => {
  const { dialog, close, pointer } = paint();
  pointer(dialog.querySelector('input')!, 'pointerdown', 100); pointer(dialog, 'pointermove', 240); pointer(dialog, 'pointerup', 240);
  expect(close).not.toHaveBeenCalled(); expect(dialog.hasAttribute('data-dragging')).toBe(false);
});

it('dismisses only the top sheet when a nested sheet is dragged', () => {
  const { pointer } = paint();
  const parentClose = vi.fn(), childClose = vi.fn();
  act(() => render(<Sheet title="父面板" onClose={parentClose}><Sheet title="子面板" onClose={childClose}>内容</Sheet></Sheet>, root));
  const child = root.querySelector('dialog dialog')!;
  child.getBoundingClientRect = () => ({ height: 400 } as DOMRect);
  pointer(child.querySelector('header')!, 'pointerdown', 100); pointer(child, 'pointermove', 240); pointer(child, 'pointerup', 240);
  expect(childClose).toHaveBeenCalledOnce(); expect(parentClose).not.toHaveBeenCalled();
});

function touch(target: Element, type: string, x: number, y: number) {
 const event=new Event(type,{bubbles:true,cancelable:true});Object.assign(event,{touches:[{clientX:x,clientY:y}]});target.dispatchEvent(event);return event;
}
function scrollArea(element: HTMLElement, top: number) {
 element.style.overflowY='auto';Object.defineProperties(element,{scrollHeight:{configurable:true,value:500},clientHeight:{configurable:true,value:200}});element.scrollTop=top;
}
it('contains touch and wheel gestures when a sheet has no scrollable content',()=>{
 const {dialog}=paint(),input=dialog.querySelector('input')!;
 touch(input,'touchstart',50,100);expect(touch(input,'touchmove',50,30).defaultPrevented).toBe(true);
 const wheel=new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:200});input.dispatchEvent(wheel);expect(wheel.defaultPrevented).toBe(true);
});
it.each([0,300])('contains an outward scroll at sheet edge %s and allows scrolling inward',top=>{
 const {dialog}=paint(),body=dialog.querySelector<HTMLElement>('.sheet-body')!,input=dialog.querySelector('input')!;scrollArea(body,top);
 const outward=new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:top===0?-100:100});input.dispatchEvent(outward);expect(outward.defaultPrevented).toBe(true);
 const inward=new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:top===0?100:-100});input.dispatchEvent(inward);expect(inward.defaultPrevented).toBe(false);
 touch(input,'touchstart',50,100);expect(touch(input,'touchmove',50,top===0?160:40).defaultPrevented).toBe(true);
});
it('preserves nested scrolling and horizontal slider movement',()=>{
 const {dialog}=paint(),body=dialog.querySelector<HTMLElement>('.sheet-body')!,input=dialog.querySelector('input')!;input.type='range';
 touch(input,'touchstart',20,100);expect(touch(input,'touchmove',100,102).defaultPrevented).toBe(false);
 const textarea=document.createElement('textarea');body.append(textarea);scrollArea(textarea,100);
 touch(textarea,'touchstart',50,100);expect(touch(textarea,'touchmove',50,50).defaultPrevented).toBe(false);
 const zoom=new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:100,ctrlKey:true});input.dispatchEvent(zoom);expect(zoom.defaultPrevented).toBe(false);
});
it('removes scroll interception when a sheet unmounts',()=>{
 const {dialog}=paint();act(()=>render(null,root));const event=new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:100});dialog.dispatchEvent(event);expect(event.defaultPrevented).toBe(false);
});

it('does not cancel tap jitter or change a horizontal drag into a scroll blocker',()=>{
 const {dialog}=paint(),input=dialog.querySelector('input')!;
 touch(input,'touchstart',50,100);expect(touch(input,'touchmove',51,102).defaultPrevented).toBe(false);
 touch(input,'touchstart',50,100);expect(touch(input,'touchmove',100,102).defaultPrevented).toBe(false);
 expect(touch(input,'touchmove',100,110).defaultPrevented).toBe(false);
});
