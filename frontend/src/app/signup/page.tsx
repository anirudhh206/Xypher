"use client";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

const TIERS = [
  { n:"1", name:"Sovereign",  range:"UHF > 3.0",  rate:"3–4%",   color:"var(--cyan)",    bar:"linear-gradient(90deg,var(--cyan),var(--cyan2))" },
  { n:"2", name:"Assured",    range:"UHF > 2.0",  rate:"5–6%",   color:"#10b981",        bar:"linear-gradient(90deg,#10b981,#059669)" },
  { n:"3", name:"Verified",   range:"UHF > 1.5",  rate:"7–9%",   color:"#6366f1",        bar:"linear-gradient(90deg,#6366f1,#4f46e5)" },
  { n:"4", name:"Building",   range:"UHF > 1.2",  rate:"10–12%", color:"var(--warning)", bar:"linear-gradient(90deg,var(--warning),#ea580c)" },
  { n:"5", name:"Restricted", range:"UHF < 1.2",  rate:"—",      color:"var(--danger)",  bar:"linear-gradient(90deg,var(--danger),var(--crimson))" },
];

function SignupInner() {
  const router = useRouter();
  const params = useSearchParams();
  const defaultRole = params.get("role") === "lender" ? "lender" : "borrower";
  const [tab, setTab]           = useState<"signup"|"signin">("signup");
  const [role, setRole]         = useState<"borrower"|"lender">(defaultRole);
  const [connecting, setConn]   = useState(false);
  const [connName, setConnName] = useState("");

  function connect(name: string) {
    setConnName(name);
    setConn(true);
    setTimeout(() => router.push("/dashboard"), 2000);
  }

  const WalletBtn = ({ name, icon, primary }: { name:string; icon:string; primary?:boolean }) => (
    <button type="button" onClick={()=>connect(name)} style={{display:"flex",alignItems:"center",gap:"14px",padding:"13px 16px",background:"var(--card)",border:`1px solid ${primary?"rgba(8,145,178,0.32)":"rgba(8,145,178,0.12)"}`,cursor:"pointer",transition:"all .3s",width:"100%",textAlign:"left"}}
      onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.borderColor="rgba(8,145,178,0.55)";(e.currentTarget as HTMLElement).style.background="rgba(8,145,178,0.04)"}}
      onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.borderColor=primary?"rgba(8,145,178,0.32)":"rgba(8,145,178,0.12)";(e.currentTarget as HTMLElement).style.background="var(--card)"}}
    >
      <div style={{width:"34px",height:"34px",background:"rgba(8,145,178,0.08)",border:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"17px",flexShrink:0}}>{icon}</div>
      <div style={{flex:1}}>
        <div style={{fontSize:"13px",fontWeight:600,color:"var(--slate)"}}>{name}</div>
        <div style={{fontSize:"10px",color:"var(--muted)",fontFamily:"Space Mono,monospace"}}>
          {name==="Phantom"?"phantom.app · Most popular Solana wallet":name==="Solflare"?"solflare.com · Native Solana wallet":"backpack.app · xNFT wallet"}
        </div>
      </div>
      <span style={{color:"var(--cyan)",fontSize:"14px"}}>→</span>
    </button>
  );

  const Divider = ({ text }:{text:string}) => (
    <div style={{display:"flex",alignItems:"center",gap:"14px",margin:"20px 0"}}>
      <div style={{flex:1,height:"1px",background:"rgba(0,0,0,0.1)"}} />
      <span style={{fontSize:"10px",color:"var(--muted)",letterSpacing:"0.2em",textTransform:"uppercase",fontFamily:"Space Mono,monospace"}}>{text}</span>
      <div style={{flex:1,height:"1px",background:"rgba(0,0,0,0.1)"}} />
    </div>
  );

  const Field = ({ label, type, placeholder }:{label:string;type:string;placeholder:string}) => (
    <div style={{marginBottom:"17px"}}>
      <label style={{fontSize:"9px",fontWeight:700,letterSpacing:"0.22em",textTransform:"uppercase",color:"var(--muted)",display:"block",marginBottom:"7px",fontFamily:"Space Mono,monospace"}}>{label}</label>
      <input type={type} placeholder={placeholder} className="guard-input" />
    </div>
  );

  return (
    <>
      <div style={{minHeight:"100vh",display:"grid",gridTemplateColumns:"1fr 1fr",background:"var(--void)"}}>

        {/* LEFT — credential showcase */}
        <div style={{background:"var(--deep)",borderRight:"1px solid rgba(8,145,178,0.12)",display:"flex",flexDirection:"column",justifyContent:"space-between",padding:"48px 52px",position:"relative",overflow:"hidden"}}>
          <div style={{position:"absolute",inset:0,background:"radial-gradient(ellipse 80% 60% at 15% 75%,rgba(99,102,241,0.1) 0%,transparent 70%)",pointerEvents:"none"}} />
          <div style={{position:"absolute",bottom:"-70px",right:"-70px",width:"320px",height:"320px",border:"1px solid rgba(8,145,178,0.07)",transform:"rotate(15deg)",opacity:.35,pointerEvents:"none"}} />

          <Link href="/" style={{display:"flex",alignItems:"center",gap:"12px",textDecoration:"none",position:"relative",zIndex:1}}>
            <div className="guard-emblem" />
            <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"19px",fontWeight:600,letterSpacing:"0.22em",color:"var(--slate)",textTransform:"uppercase"}}>
              Confidential<span style={{color:"var(--cyan)"}}>Guard</span>
            </span>
          </Link>

          <div style={{position:"relative",zIndex:1}}>
            <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"50px",fontWeight:300,lineHeight:1,letterSpacing:"-0.02em",marginBottom:"18px"}}>
              Your Credit.<br /><em style={{fontStyle:"italic",color:"var(--cyan)"}}>Private.</em><br />Verified.
            </h2>
            <p style={{fontSize:"12px",color:"var(--slate2)",lineHeight:1.9,fontWeight:300,maxWidth:"340px"}}>
              The TEE reads your positions across Aave, Morpho, and Compound — then computes a Unified Health Factor that determines your credit tier. Zero data leaves the enclave.
            </p>

            {/* Tier table */}
            <div style={{marginTop:"40px",border:"1px solid rgba(8,145,178,0.12)"}}>
              {TIERS.map((t,i)=>(
                <div key={t.n} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 18px",borderBottom:i<4?"1px solid rgba(8,145,178,0.08)":"none",transition:"background .3s",position:"relative"}}
                  onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background="rgba(8,145,178,0.04)"}
                  onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background="transparent"}
                >
                  <div style={{position:"absolute",left:0,top:0,bottom:0,width:"2px",background:t.bar}} />
                  <div style={{paddingLeft:"12px"}}>
                    <div style={{fontSize:"12px",fontWeight:600,color:t.color}}>Tier {t.n} — {t.name}</div>
                    <div style={{fontSize:"10px",color:"var(--muted)",marginTop:"1px",fontFamily:"Space Mono,monospace"}}>{t.range}</div>
                  </div>
                  <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"24px",fontWeight:500,color:"var(--cyan)"}}>{t.rate}</div>
                </div>
              ))}
            </div>

            {/* TEE status */}
            <div style={{marginTop:"20px",padding:"12px 16px",background:"rgba(8,145,178,0.05)",border:"1px solid var(--border)",display:"flex",alignItems:"center",gap:"12px"}}>
              <div style={{width:"8px",height:"8px",borderRadius:"50%",background:"var(--success)",flexShrink:0}} className="pulse-cyan" />
              <div>
                <div style={{fontSize:"10px",fontWeight:700,letterSpacing:"0.2em",textTransform:"uppercase",color:"var(--success)",fontFamily:"Space Mono,monospace"}}>TEE Online</div>
                <div style={{fontSize:"10px",color:"var(--muted)"}}>Chainlink CRE · Attestation ready</div>
              </div>
            </div>
          </div>

          <div style={{fontSize:"10px",color:"var(--muted)",letterSpacing:"0.2em",position:"relative",zIndex:1,fontFamily:"Space Mono,monospace"}}>◆ CHAINLINK TEE · SOLANA ◆</div>
        </div>

        {/* RIGHT — form */}
        <div style={{display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",padding:"60px 52px",position:"relative",background:"var(--void)"}}>

          {/* Connecting state */}
          {connecting && (
            <div style={{textAlign:"center",padding:"48px 0"}}>
              <div style={{width:"56px",height:"56px",border:"2px solid rgba(8,145,178,0.2)",borderTopColor:"var(--cyan)",borderRadius:"50%",animation:"spin .8s linear infinite",margin:"0 auto 22px"}} />
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"24px",color:"var(--cyan)",marginBottom:"8px"}}>Connecting {connName}…</div>
              <div style={{fontSize:"12px",color:"var(--muted)",fontWeight:300}}>Loading your on-chain positions</div>
              <div style={{marginTop:"12px",fontSize:"11px",color:"var(--muted)",fontFamily:"Space Mono,monospace"}}>TEE aggregation in progress…</div>
            </div>
          )}

          {!connecting && (
            <div style={{width:"100%",maxWidth:"420px"}}>
              <div className="eyebrow">
                <div className="eyebrow-line" />
                <span className="eyebrow-text">{tab==="signup"?"Create Account":"Welcome Back"}</span>
              </div>

              {/* Tab switch */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",border:"1px solid rgba(8,145,178,0.14)",marginBottom:"32px",background:"var(--deep)"}}>
                {(["signup","signin"] as const).map(t=>(
                  <button type="button" key={t} onClick={()=>setTab(t)} style={{padding:"12px",fontSize:"10px",fontWeight:700,letterSpacing:"0.2em",textTransform:"uppercase",border:"none",background:tab===t?"var(--cyan)":"transparent",color:tab===t?"#ffffff":"var(--muted)",cursor:"pointer",transition:"all .3s"}}>
                    {t==="signup"?"Sign Up":"Sign In"}
                  </button>
                ))}
              </div>

              {/* SIGN UP */}
              {tab==="signup" && (
                <>
                  <p style={{fontSize:"12px",color:"var(--slate2)",marginBottom:"22px",fontWeight:300}}>Select your role, connect your Solana wallet. Your credit attestation loads automatically from the TEE.</p>

                  {/* Role select */}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px",marginBottom:"26px"}}>
                    {(["borrower","lender"] as const).map(ro=>(
                      <div key={ro} onClick={()=>setRole(ro)} style={{padding:"16px 14px",background:role===ro?"rgba(8,145,178,0.06)":"var(--card)",border:`1px solid ${role===ro?"rgba(8,145,178,0.5)":"rgba(8,145,178,0.12)"}`,textAlign:"center",cursor:"pointer",transition:"all .3s"}}>
                        <div style={{fontSize:"22px",marginBottom:"8px"}}>{ro==="borrower"?"🏦":"📊"}</div>
                        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"18px",fontWeight:500,marginBottom:"3px"}}>{ro==="borrower"?"Borrower":"Lender"}</div>
                        <div style={{fontSize:"10px",color:"var(--muted)",fontWeight:300}}>{ro==="borrower"?"Seek undercollateralized credit":"Deploy capital with TEE guarantees"}</div>
                      </div>
                    ))}
                  </div>

                  <span style={{fontSize:"9px",fontWeight:700,letterSpacing:"0.25em",textTransform:"uppercase",color:"var(--muted)",display:"block",marginBottom:"10px",fontFamily:"Space Mono,monospace"}}>Connect Wallet</span>
                  <div style={{display:"flex",flexDirection:"column",gap:"9px",marginBottom:"22px"}}>
                    <WalletBtn name="Phantom"  icon="👻" primary />
                    <WalletBtn name="Solflare" icon="🌟" />
                    <WalletBtn name="Backpack" icon="🎒" />
                  </div>

                  <Divider text="or register with email" />
                  <Field label="Institution Name"  type="text"  placeholder="Goldman Sachs Digital Assets" />
                  <Field label="Email Address"     type="email" placeholder="treasury@institution.com" />
                  {role==="borrower" && <Field label="Primary Chain" type="text" placeholder="Ethereum / Base / Arbitrum" />}

                  <button type="button" onClick={()=>connect("Email")} className="btn-cyan" style={{width:"100%",justifyContent:"center",marginTop:"8px",clipPath:"polygon(10px 0%,100% 0%,calc(100% - 10px) 100%,0% 100%)"}}>
                    Create Account →
                  </button>
                  <p style={{textAlign:"center",marginTop:"18px",fontSize:"12px",color:"var(--muted)"}}>
                    Already have an account? <a href="#" onClick={e=>{e.preventDefault();setTab("signin")}} style={{color:"var(--cyan)",textDecoration:"none",fontWeight:500}}>Sign in here</a>
                  </p>
                </>
              )}

              {/* SIGN IN */}
              {tab==="signin" && (
                <>
                  <p style={{fontSize:"12px",color:"var(--slate2)",marginBottom:"22px",fontWeight:300}}>Connect your wallet to authenticate. Your attestation and dashboard load automatically.</p>

                  <span style={{fontSize:"9px",fontWeight:700,letterSpacing:"0.25em",textTransform:"uppercase",color:"var(--muted)",display:"block",marginBottom:"10px",fontFamily:"Space Mono,monospace"}}>Connect Wallet to Sign In</span>
                  <div style={{display:"flex",flexDirection:"column",gap:"9px",marginBottom:"22px"}}>
                    <WalletBtn name="Phantom"  icon="👻" primary />
                    <WalletBtn name="Solflare" icon="🌟" />
                    <WalletBtn name="Backpack" icon="🎒" />
                  </div>

                  <Divider text="or sign in with email" />
                  <Field label="Email Address" type="email"    placeholder="treasury@institution.com" />
                  <Field label="Password"      type="password" placeholder="••••••••" />

                  <button type="button" onClick={()=>connect("Email")} className="btn-cyan" style={{width:"100%",justifyContent:"center",marginTop:"8px",clipPath:"polygon(10px 0%,100% 0%,calc(100% - 10px) 100%,0% 100%)"}}>
                    Sign In →
                  </button>
                  <p style={{textAlign:"center",marginTop:"18px",fontSize:"12px",color:"var(--muted)"}}>
                    No account? <a href="#" onClick={e=>{e.preventDefault();setTab("signup")}} style={{color:"var(--cyan)",textDecoration:"none",fontWeight:500}}>Create one free</a>
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function Signup() {
  return (
    <Suspense>
      <SignupInner />
    </Suspense>
  );
}
