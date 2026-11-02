import {useEffect,useRef,useState} from 'react';
import './toasts.css';

export type ToastNotice={id:string;kind:'info'|'success'|'error';message:string;topic?:string};
const duration=6000;
function Toast({notice,onDismiss}:{notice:ToastNotice;onDismiss:(id:string)=>void}){
  const remaining=useRef(duration);
  const [progress,setProgress]=useState(100);
  const [hovered,setHovered]=useState(false);
  const [focused,setFocused]=useState(false);
  useEffect(()=>{
    if(notice.kind==='error'||hovered||focused)return;
    let last=performance.now();
    const timer=window.setInterval(()=>{
      const now=performance.now();remaining.current=Math.max(0,remaining.current-(now-last));last=now;
      setProgress(remaining.current/duration*100);
      if(remaining.current===0)onDismiss(notice.id);
    },50);
    return()=>window.clearInterval(timer);
  },[notice.id,notice.kind,hovered,focused,onDismiss]);
  return <div className="toast" data-kind={notice.kind} data-paused={hovered||focused} onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onFocusCapture={()=>setFocused(true)} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget))setFocused(false)}}>
    <p role={notice.kind==='error'?'alert':'status'}>{notice.message}</p>
    <button className="quiet" aria-label="Dismiss notification" onClick={()=>onDismiss(notice.id)}>×</button>
    {notice.kind!=='error'&&<div className="toast-progress" role="progressbar" aria-label="Time remaining" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><span style={{width:progress+'%'}}/></div>}
  </div>;
}
export function Toasts({notices,onDismiss}:{notices:ToastNotice[];onDismiss:(id:string)=>void}){
  return <section className="toasts" aria-label="Notifications">{notices.map(notice=><Toast key={notice.id} notice={notice} onDismiss={onDismiss}/>)}</section>;
}
