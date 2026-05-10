// Shared icons + small UI atoms
const Icon = {
  logo: (p={}) => (
    <svg width={p.size||20} height={p.size||20} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2"/>
      <circle cx="12" cy="12" r="3" fill="currentColor"/>
    </svg>
  ),
  mic: (p={}) => (
    <svg width={p.size||22} height={p.size||22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="12" rx="3"/>
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>
    </svg>
  ),
  micOff: (p={}) => (
    <svg width={p.size||22} height={p.size||22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="3" x2="21" y2="21"/>
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6"/>
      <path d="M17 16.95A7 7 0 0 1 5 12v-2"/>
      <line x1="12" y1="19" x2="12" y2="22"/>
    </svg>
  ),
  upload: (p={}) => (
    <svg width={p.size||22} height={p.size||22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
    </svg>
  ),
  doc: (p={}) => (
    <svg width={p.size||22} height={p.size||22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="8" y1="13" x2="14" y2="13"/>
      <line x1="8" y1="17" x2="13" y2="17"/>
    </svg>
  ),
  check: (p={}) => (
    <svg width={p.size||22} height={p.size||22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  arrow: (p={}) => (
    <svg width={p.size||18} height={p.size||18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12"/>
      <polyline points="12 5 19 12 12 19"/>
    </svg>
  ),
  back: (p={}) => (
    <svg width={p.size||18} height={p.size||18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12"/>
      <polyline points="12 19 5 12 12 5"/>
    </svg>
  ),
  clock: (p={}) => (
    <svg width={p.size||16} height={p.size||16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  ),
  cal: (p={}) => (
    <svg width={p.size||16} height={p.size||16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  ),
  spark: (p={}) => (
    <svg width={p.size||18} height={p.size||18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.9 5.5L19 10l-5.1 1.5L12 17l-1.9-5.5L5 10l5.1-1.5z"/>
    </svg>
  ),
  pause: (p={}) => (
    <svg width={p.size||18} height={p.size||18} viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.5"/><rect x="14" y="5" width="4" height="14" rx="1.5"/></svg>
  ),
  play: (p={}) => (
    <svg width={p.size||18} height={p.size||18} viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>
  ),
  repeat: (p={}) => (
    <svg width={p.size||18} height={p.size||18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
    </svg>
  ),
  question: (p={}) => (
    <svg width={p.size||18} height={p.size||18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  download: (p={}) => (
    <svg width={p.size||18} height={p.size||18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
    </svg>
  ),
  x: (p={}) => (
    <svg width={p.size||18} height={p.size||18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
  ),
  bell: (p={}) => (
    <svg width={p.size||18} height={p.size||18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
  ),
  search: (p={}) => (
    <svg width={p.size||18} height={p.size||18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
  ),
  wave: () => (
    <span className="wave"><span/><span/><span/><span/><span/><span/><span/><span/><span/></span>
  ),
};

function TopBar({ onHome }) {
  return (
    <header className="topbar">
      <button className="brand" onClick={onHome} style={{cursor:'pointer'}}>
        <div className="brand-mark"></div>
        <div style={{textAlign:'left'}}>
          <div className="brand-name">Podtask</div>
          <div className="brand-sub">סטודיו סטודנט</div>
        </div>
      </button>
      <div className="nav-actions">
        <button className="nav-pill row gap-2" style={{display:'inline-flex'}}>
          <Icon.search size={14}/> חיפוש
          <span style={{color:'var(--muted)', fontWeight:500, marginInlineStart:6, fontSize:11}}>⌘K</span>
        </button>
        <button className="nav-pill" style={{padding:'9px 12px'}}><Icon.bell size={16}/></button>
        <div className="avatar">מ</div>
      </div>
    </header>
  );
}

function Steps({ current, items }) {
  return (
    <div className="steps">
      {items.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : '';
        return (
          <React.Fragment key={i}>
            {i>0 && <div className="step-line" style={{background: i<=current ? 'linear-gradient(90deg, #7DD3FC, #FDA4AF)' : ''}}/>}
            <div className={`step ${state}`}>
              <div className="step-num">{i < current ? <Icon.check size={14}/> : i+1}</div>
              <div className="step-label">{label}</div>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// Background blobs decoration
function Blobs({ variant='default' }) {
  return (
    <div aria-hidden="true" style={{position:'fixed', inset:0, pointerEvents:'none', zIndex:0, overflow:'hidden'}}>
      <div style={{position:'absolute', width:520, height:520, borderRadius:'50%', top:-120, right:-120, background:'radial-gradient(circle, rgba(125,211,252,0.32), transparent 70%)', filter:'blur(20px)'}}/>
      <div style={{position:'absolute', width:480, height:480, borderRadius:'50%', bottom:-160, left:-100, background:'radial-gradient(circle, rgba(253,164,175,0.28), transparent 70%)', filter:'blur(20px)'}}/>
      {variant==='studio' && (
        <div style={{position:'absolute', width:600, height:600, borderRadius:'50%', top:'40%', left:'45%', transform:'translate(-50%,-50%)', background:'radial-gradient(circle, rgba(186,230,253,0.25), transparent 70%)', filter:'blur(30px)'}}/>
      )}
    </div>
  );
}

Object.assign(window, { Icon, TopBar, Steps, Blobs });
