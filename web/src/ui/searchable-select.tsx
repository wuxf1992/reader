import {useEffect,useLayoutEffect,useMemo,useRef,useState} from './vendor/preact.ts';
import type {JSX} from './vendor/preact.ts';
import {ChevronDown,Check,Search} from 'lucide-preact';

export interface SearchableSelectOption { value:string; label:string }
export function SearchableSelect({label,value,options,disabled,onChange}:{label:string;value:string;options:SearchableSelectOption[];disabled?:boolean;onChange:(value:string)=>void}):JSX.Element {
  const [open,setOpen]=useState(false),[query,setQuery]=useState('');
  const ref=useRef<HTMLDivElement>(null),menu=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!open)return;const close=(event:MouseEvent)=>{if(!ref.current?.contains(event.target as Node))setOpen(false)};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[open]);
  useLayoutEffect(()=>{
    if(!open||!menu.current)return;
    const panel=menu.current;
    const position=()=>{
      const trigger=ref.current?.querySelector('.searchable-select-trigger');if(!trigger)return;
      const rect=trigger.getBoundingClientRect(),viewport=window.visualViewport;
      const left=viewport?.offsetLeft??0,top=viewport?.offsetTop??0,width=viewport?.width??innerWidth,height=viewport?.height??innerHeight;
      const below=top+height-rect.bottom-18,above=rect.top-top-18;
      const upwards=below<180&&above>below,space=Math.max(96,upwards?above:below);
      panel.style.width=Math.min(Math.max(rect.width,240),width-24)+'px';
      panel.style.maxHeight=Math.min(320,space,height-24)+'px';
      panel.style.left=Math.max(left+12,Math.min(rect.left,left+width-panel.offsetWidth-12))+'px';
      panel.style.top=Math.max(top+12,Math.min(upwards?rect.top-panel.offsetHeight-6:rect.bottom+6,top+height-panel.offsetHeight-12))+'px';
    };
    position();panel.querySelector('input')?.focus({preventScroll:true});
    window.addEventListener('resize',position);window.addEventListener('scroll',position,true);
    window.visualViewport?.addEventListener('resize',position);window.visualViewport?.addEventListener('scroll',position);
    return()=>{
      window.removeEventListener('resize',position);window.removeEventListener('scroll',position,true);
      window.visualViewport?.removeEventListener('resize',position);window.visualViewport?.removeEventListener('scroll',position);
    };
  },[open]);
  const selected=options.find(option=>option.value===value), filtered=useMemo(()=>{const text=query.trim().toLocaleLowerCase();return text?options.filter(option=>option.label.toLocaleLowerCase().includes(text)):options},[options,query]);
  return <div className="searchable-select" ref={ref}>
    <span className="searchable-select-label">{label}</span>
    <select aria-label={label} className="searchable-select-native" value={value} disabled={disabled} onChange={event=>onChange(event.currentTarget.value)}>{!options.some(option=>option.value==='')&&<option value="" disabled>请选择一个来源</option>}{options.map(option=><option value={option.value}>{option.label}</option>)}</select>
    <button type="button" className="searchable-select-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={()=>{setOpen(!open);setQuery('')}}>
      <span>{selected?.label??label}</span><ChevronDown size={16} aria-hidden="true"/>
    </button>
    {open&&<div ref={menu} className="searchable-select-menu" role="listbox" aria-label={label}>
      <label className="searchable-select-search"><Search size={14} aria-hidden="true"/><input type="search" value={query} placeholder="搜索选项" aria-label={`搜索${label}`} onInput={event=>setQuery(event.currentTarget.value)}/></label>
      <div className="searchable-select-options">{filtered.length?filtered.map(option=><button type="button" role="option" aria-selected={option.value===value} key={option.value} onClick={()=>{onChange(option.value);setOpen(false)}}><span>{option.label}</span>{option.value===value&&<Check size={15} aria-hidden="true"/>}</button>):<p>没有匹配选项</p>}</div>
    </div>}
  </div>;
}
