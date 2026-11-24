import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { isSupabaseConfigured, supabase } from './lib/supabase.js';

function usePlayerSession() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!supabase) { setReady(true); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => subscription.unsubscribe();
  }, []);
  return { session, ready };
}

function SetupNotice() {
  return <div className="backend-banner"><b>!</b><p><strong>Supabase connection needs configuration</strong><br/>Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the deployment environment. Never add a service-role key to frontend code.</p></div>;
}

function SignInRequired() {
  return <section className="empty-panel"><div className="empty-symbol">R<span>.</span></div><div><div className="status-label"><i/> PLAYER ACCESS</div><h2>Sign in to continue</h2><p>Your profile and team data are private to your account. Sign in or create a player account to continue.</p><Link className="button primary" to="/login">Player sign in ↗</Link></div></section>;
}

export function PlayerAuth() {
  const { session, ready } = usePlayerSession();
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  if (!isSupabaseConfigured) return <main className="subpage"><SetupNotice/></main>;
  async function submit(event) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const result = mode === 'signup'
        ? await supabase.auth.signUp({ email: email.trim(), password })
        : await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) throw result.error;
      setMessage(mode === 'signup'
        ? 'Account request submitted. Check your email if confirmation is required, then sign in.'
        : 'Signed in successfully. You can now open your player profile and teams.');
    } catch (error) { setMessage(error.message || 'Unable to complete account request.'); }
    finally { setBusy(false); }
  }
  async function signOut() { await supabase.auth.signOut(); setMessage('You have signed out.'); }
  return <main className="subpage"><div className="eyebrow"><i/> ROUTER.ESPORTS / PLAYER ACCESS</div><h1>PLAYER<br/><span>ACCESS.</span></h1>
    {!ready ? <p className="page-intro">Checking account session…</p> : session ? <section className="empty-panel"><div className="empty-symbol">R<span>.</span></div><div><div className="status-label"><i/> SIGNED IN</div><h2>Welcome back</h2><p>{session.user.email}</p><div className="actions"><Link className="button primary" to="/profile">Open profile ↗</Link><button className="button secondary" onClick={signOut}>Sign out</button></div></div></section> :
    <form className="profile-form-card" onSubmit={submit}><div className="section-kicker">SECURE PLAYER ACCOUNT</div><h2>{mode === 'signin' ? 'WELCOME BACK.' : 'CREATE YOUR ACCOUNT.'}</h2><div className="team-fields"><label>Email address<input type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></label><label>Password<input type="password" required minLength="8" autoComplete={mode==='signin'?'current-password':'new-password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 8 characters"/></label></div><button className="button primary" disabled={busy}>{busy?'Please wait…':mode==='signin'?'Sign in':'Create account'}</button><button type="button" className="button secondary" onClick={()=>{setMode(mode==='signin'?'signup':'signin');setMessage('');}}>{mode==='signin'?'Create a new player account':'I already have an account'}</button>{message&&<p className="team-footnote" role="status">{message}</p>}<p className="team-footnote">Use your own email. Never share your password or OTP. Email confirmation follows the Supabase project’s Auth settings.</p></form>}
  </main>;
}

export function ConnectedPlayerProfile() {
  const { session, ready } = usePlayerSession();
  const [profile,setProfile] = useState(null);
  const [games,setGames] = useState([]);
  const [handle,setHandle] = useState('');
  const [displayName,setDisplayName] = useState('');
  const [bio,setBio] = useState('');
  const [region,setRegion] = useState('India');
  const [gameCode,setGameCode] = useState('free_fire_max');
  const [gameUid,setGameUid] = useState('');
  const [inGameName,setInGameName] = useState('');
  const [message,setMessage] = useState('');
  const [busy,setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!session?.user) return;
    const [{data:p,error:pe},{data:g,error:ge}] = await Promise.all([
      supabase.from('profiles').select('id,player_handle,display_name,bio,region,is_public,created_at').eq('id',session.user.id).maybeSingle(),
      supabase.from('profile_games').select('id,game_code,game_uid,in_game_name,verification_status').eq('profile_id',session.user.id)
    ]);
    if (pe || ge) { setMessage(pe?.message || ge?.message || 'Unable to load profile.'); return; }
    setProfile(p); setGames(g || []);
    if(p){setHandle(p.player_handle);setDisplayName(p.display_name);setBio(p.bio || '');setRegion(p.region || 'India');}
  },[session]);
  useEffect(()=>{load();},[load]);
  if (!isSupabaseConfigured) return <main className="profile-page"><SetupNotice/></main>;
  if (!ready) return <main className="profile-page"><p>Loading account…</p></main>;
  if (!session) return <main className="profile-page"><SignInRequired/></main>;
  async function saveProfile(e) {
    e.preventDefault(); setBusy(true); setMessage('');
    const row={id:session.user.id,player_handle:handle.trim(),display_name:displayName.trim(),bio:bio.trim()||null,region:region.trim()||null};
    const {data,error}=await supabase.from('profiles').upsert(row,{onConflict:'id'}).select('id,player_handle,display_name,bio,region,is_public,created_at').single();
    if(error) setMessage(error.message); else {setProfile(data);setMessage('Player profile saved successfully.');}
    setBusy(false);
  }
  async function addGame(e) {
    e.preventDefault(); setBusy(true); setMessage('');
    const {error}=await supabase.from('profile_games').insert({profile_id:session.user.id,game_code:gameCode,game_uid:gameUid.trim(),in_game_name:inGameName.trim()||null});
    if(error) setMessage(error.message); else {setGameUid('');setInGameName('');setMessage('Game profile added. Verification status remains unverified until reviewed.');await load();}
    setBusy(false);
  }
  async function removeGame(id) {
    const {error}=await supabase.from('profile_games').delete().eq('id',id);
    setMessage(error?.message || 'Game profile removed.'); if(!error) await load();
  }
  return <main className="profile-page"><div className="eyebrow"><i/> PLAYER SPACE / PROFILE</div><div className="profile-heading"><div><h1>PLAYER<br/><span>PROFILE.</span></h1><p>Your competitive identity, team details and player information in one place.</p></div><div className="profile-avatar">R<span>.</span></div></div>
    <div className="backend-banner"><b>✓</b><p><strong>Connected to your player account</strong><br/>Changes save to the ROUTER.ESPORTS database. Game IDs remain unverified until an authorised review.</p></div>
    <section className="profile-layout"><article className="profile-card"><div className="section-kicker">PLAYER IDENTITY</div><div className="profile-card-mark">R<span>.</span></div><h2>{profile?.display_name || displayName || 'NEW PLAYER'}</h2><p className="muted">@{profile?.player_handle || handle || 'player-handle'}</p><div className="profile-tags"><span>PLAYER</span><span>{profile?'PROFILE SAVED':'SETUP REQUIRED'}</span></div><div className="profile-meta"><div><small>GAME PROFILES</small><strong>{games.length}</strong></div><div><small>REGION</small><strong>{profile?.region || region}</strong></div><div><small>ACCOUNT</small><strong>Verified login</strong></div></div></article>
    <article className="profile-form-card"><div className="section-kicker">PROFILE DETAILS</div><h2>MAKE IT YOURS.</h2><form onSubmit={saveProfile}><div className="form-grid"><label>Player handle<input required minLength="3" maxLength="24" pattern="[A-Za-z0-9_]+" value={handle} onChange={e=>setHandle(e.target.value)} placeholder="UniquePlayerID"/></label><label>Display name<input required maxLength="60" value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="Your player name"/></label><label>Region<input maxLength="80" value={region} onChange={e=>setRegion(e.target.value)} placeholder="India"/></label><label className="wide-field">About you<textarea maxLength="500" value={bio} onChange={e=>setBio(e.target.value)} placeholder="Tell the community about your play style"/></label></div><button className="button primary" disabled={busy}>{busy?'Saving…':'Save player profile'}</button></form>
      <div className="section-kicker" style={{marginTop:28}}>GAME IDENTITIES</div><div className="team-empty compact">{games.length?games.map(g=><div className="game-row" key={g.id}><strong>{g.game_code.replaceAll('_',' ').toUpperCase()}</strong><span>{g.in_game_name || 'Player' } · UID {g.game_uid}</span><span className="status-label">{g.verification_status.toUpperCase()}</span>{g.verification_status!=='verified'&&<button className="button secondary" onClick={()=>removeGame(g.id)}>Remove</button>}</div>):<p>No game ID linked yet.</p>}</div>
      <form onSubmit={addGame}><div className="team-fields"><label>Game<select value={gameCode} onChange={e=>setGameCode(e.target.value)}><option value="free_fire_max">Free Fire MAX</option><option value="free_fire">Free Fire (if available in your region)</option></select></label><label>In-game UID<input required minLength="2" maxLength="100" value={gameUid} onChange={e=>setGameUid(e.target.value)} placeholder="Your game UID"/></label><label>In-game name<input maxLength="60" value={inGameName} onChange={e=>setInGameName(e.target.value)} placeholder="Optional"/></label></div><button className="button secondary" disabled={busy}>Add game profile</button></form>
      {message&&<p className="team-footnote" role="status">{message}</p>}
    </article></section></main>;
}

export function ConnectedTeams() {
  const { session, ready } = usePlayerSession();
  const [profile,setProfile]=useState(null);
  const [myTeams,setMyTeams]=useState([]);
  const [roster,setRoster]=useState([]);
  const [publicTeams,setPublicTeams]=useState([]);
  const [requests,setRequests]=useState([]);
  const [invitations,setInvitations]=useState([]);
  const [incomingRequests,setIncomingRequests]=useState([]);
  const [teamName,setTeamName]=useState('');
  const [gameCode,setGameCode]=useState('free_fire_max');
  const [description,setDescription]=useState('');
  const [requestMessage,setRequestMessage]=useState('');
  const [selectedTeam,setSelectedTeam]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const load=useCallback(async()=>{
    if(!session?.user)return;
    const [{data:p},{data:owned},{data:discover},{data:req},{data:invites}] = await Promise.all([
      supabase.from('profiles').select('id,player_handle,display_name').eq('id',session.user.id).maybeSingle(),
      supabase.from('teams').select('id,team_name,game_code,description,created_at').eq('owner_id',session.user.id).order('created_at',{ascending:false}),
      supabase.from('teams').select('id,team_name,game_code,description,owner_id').eq('is_public',true).order('team_name').limit(50),
      supabase.from('team_join_requests').select('id,team_id,requester_id,message,status,created_at').eq('requester_id',session.user.id).order('created_at',{ascending:false}),
      supabase.from('team_invitations').select('id,team_id,inviter_id,status,expires_at,created_at').eq('invitee_id',session.user.id).order('created_at',{ascending:false})
    ]);
    setProfile(p);setMyTeams(owned||[]);setPublicTeams((discover||[]).filter(t=>t.owner_id!==session.user.id));setRequests(req||[]);setInvitations(invites||[]);
    const ids=(owned||[]).map(t=>t.id);
    if(ids.length){const {data:incoming}=await supabase.from('team_join_requests').select('id,team_id,requester_id,message,status,created_at').in('team_id',ids).eq('status','pending').order('created_at',{ascending:false});setIncomingRequests(incoming||[]);}else setIncomingRequests([]);
    if(ids.length){
      const {data:members}=await supabase.from('team_members').select('team_id,user_id,member_role,joined_at').in('team_id',ids);
      const userIds=[...new Set((members||[]).map(m=>m.user_id))];
      const {data:players}=userIds.length?await supabase.from('profiles').select('id,player_handle,display_name').in('id',userIds):{data:[]};
      const lookup=new Map((players||[]).map(x=>[x.id,x]));
      setRoster((members||[]).map(m=>({...m,player:lookup.get(m.user_id)})));
    }else setRoster([]);
  },[session]);
  useEffect(()=>{load();},[load]);
  if(!isSupabaseConfigured)return <main className="team-page"><SetupNotice/></main>;
  if(!ready)return <main className="team-page"><p>Loading account…</p></main>;
  if(!session)return <main className="team-page"><SignInRequired/></main>;
  async function createTeam(e){
    e.preventDefault();setBusy(true);setMessage('');
    const {data,error}=await supabase.rpc('create_team_with_leader',{p_team_name:teamName.trim(),p_game_code:gameCode,p_description:description.trim()||null,p_is_public:true});
    if(error)setMessage(error.message);else{setTeamName('');setDescription('');setMessage('Team created. You are its first leader.');await load();}
    setBusy(false);
  }
  async function joinTeam(e){
    e.preventDefault();if(!selectedTeam)return;setBusy(true);setMessage('');
    const {error}=await supabase.from('team_join_requests').insert({team_id:selectedTeam,requester_id:session.user.id,message:requestMessage.trim()||null});
    setMessage(error?.message || 'Join request submitted. The team leader can review it.');if(!error){setRequestMessage('');await load();}setBusy(false);
  }
  async function respondToInvitation(id,decision){setBusy(true);setMessage('');const {data,error}=await supabase.rpc('respond_to_team_invitation',{p_invitation_id:id,p_decision:decision});setMessage(error?.message || `Invitation ${data}.`);if(!error)await load();setBusy(false);}
  async function reviewJoinRequest(id,decision){setBusy(true);setMessage('');const {data,error}=await supabase.rpc('review_team_join_request',{p_request_id:id,p_decision:decision});setMessage(error?.message || `Join request ${data}.`);if(!error)await load();setBusy(false);}
  async function acceptApprovedRequest(id){setBusy(true);setMessage('');const {data,error}=await supabase.rpc('accept_approved_team_join_request',{p_request_id:id});setMessage(error?.message || `Join request ${data}; welcome to the team.`);if(!error)await load();setBusy(false);}
  return <main className="team-page"><div className="eyebrow"><i/> PLAYER SPACE / TEAM MANAGEMENT</div><div className="team-heading"><div><h1>BUILD YOUR<br/><span>SQUAD.</span></h1><p>Create your team identity, organise your roster and discover community squads.</p></div><div className="team-emblem">R<span>.</span></div></div>
    <div className="backend-banner"><b>✓</b><p><strong>Live database connected</strong><br/>Your team details, invitations and join requests use authenticated Supabase workflows. Membership changes are checked by database policies.</p></div>
    <section className="team-overview"><article><small>YOUR TEAMS</small><strong>{myTeams.length}</strong><span>Owned teams</span></article><article><small>ROSTER</small><strong>{roster.length}</strong><span>Loaded members</span></article><article><small>JOIN REQUESTS</small><strong>{requests.filter(r=>r.status==='pending').length}</strong><span>Your pending requests</span></article><article><small>DISCOVER</small><strong>{publicTeams.length}</strong><span>Public teams listed</span></article></section>
    <section className="team-content"><article className="team-panel create-team-panel"><div className="team-panel-head"><div><small>01 / GET STARTED</small><h2>CREATE YOUR TEAM</h2></div><span>NEW</span></div>{!profile?<p className="team-muted">Create your player profile before creating a team. <Link to="/profile">Open profile ↗</Link></p>:<form onSubmit={createTeam}><div className="team-fields"><label>Team name<input required minLength="3" maxLength="40" value={teamName} onChange={e=>setTeamName(e.target.value)} placeholder="Your squad name"/></label><label>Game<select value={gameCode} onChange={e=>setGameCode(e.target.value)}><option value="free_fire_max">Free Fire MAX</option><option value="free_fire">Free Fire (if available in your region)</option></select></label><label>Team description<textarea maxLength="500" value={description} onChange={e=>setDescription(e.target.value)} placeholder="Tell players what your team is about"/></label></div><button className="button primary" disabled={busy}>{busy?'Creating…':'Create team'}</button></form>}</article>
    <article className="team-panel roster-panel"><div className="team-panel-head"><div><small>02 / YOUR LINE-UP</small><h2>TEAM ROSTER</h2></div><span>{roster.length} MEMBERS</span></div>{roster.length?roster.map(m=><div className="game-row" key={m.team_id+m.user_id}><strong>{m.player?.display_name||'Player'}</strong><span>@{m.player?.player_handle||'player'} · {m.member_role}</span></div>):<div className="team-empty"><div className="team-empty-icon">⌁</div><strong>No team roster available</strong><p>Create a team to establish its first leader roster entry.</p></div>}<div className="roster-rules"><strong>ROSTER RULES</strong><ul><li>One designated team leader</li><li>One active team membership per player</li><li>Only authorised leaders manage membership</li></ul></div></article>
    <article className="team-panel"><div className="team-panel-head"><div><small>03 / FIND A SQUAD</small><h2>DISCOVER TEAMS</h2></div><span>{publicTeams.length}</span></div>{publicTeams.length?<form onSubmit={joinTeam}><div className="team-fields"><label>Public team<select required value={selectedTeam} onChange={e=>setSelectedTeam(e.target.value)}><option value="">Choose a team</option>{publicTeams.map(t=><option key={t.id} value={t.id}>{t.team_name} · {t.game_code}</option>)}</select></label><label>Message (optional)<textarea maxLength="500" value={requestMessage} onChange={e=>setRequestMessage(e.target.value)} placeholder="Introduce yourself"/></label></div><button className="button secondary" disabled={busy||!selectedTeam}>Request to join</button></form>:<div className="team-empty compact"><strong>No public teams listed yet</strong><p>Public teams will appear here when players create them.</p></div>}</article>
    <article className="team-panel"><div className="team-panel-head"><div><small>04 / INVITATIONS</small><h2>TEAM INVITATIONS</h2></div><span>{invitations.filter(i=>i.status==='pending').length} PENDING</span></div>{invitations.length?invitations.map(i=><div className="game-row" key={i.id}><strong>{i.status.toUpperCase()}</strong><span>Expires {new Date(i.expires_at).toLocaleDateString()}</span>{i.status==='pending'&&<div className="actions"><button className="button primary" disabled={busy} onClick={()=>respondToInvitation(i.id,'accepted')}>Accept</button><button className="button secondary" disabled={busy} onClick={()=>respondToInvitation(i.id,'declined')}>Decline</button></div>}</div>):<div className="team-empty compact"><strong>No invitations yet</strong><p>Team invitations sent to your account will appear here.</p></div>}</article>
    <article className="team-panel"><div className="team-panel-head"><div><small>05 / LEADER ACTIONS</small><h2>JOIN REQUESTS TO YOUR TEAMS</h2></div><span>{incomingRequests.length} PENDING</span></div>{incomingRequests.length?incomingRequests.map(r=><div className="game-row" key={r.id}><strong>{r.requester_id.slice(0,8).toUpperCase()}</strong><span>{r.message||'No introduction message'} · {new Date(r.created_at).toLocaleDateString()}</span><div className="actions"><button className="button primary" disabled={busy} onClick={()=>reviewJoinRequest(r.id,'approved')}>Approve</button><button className="button secondary" disabled={busy} onClick={()=>reviewJoinRequest(r.id,'rejected')}>Reject</button></div></div>):<div className="team-empty compact"><strong>No pending requests</strong><p>New requests for teams you own will appear here.</p></div>}</article>
    <article className="team-panel"><div className="team-panel-head"><div><small>06 / YOUR ACTIVITY</small><h2>MY JOIN REQUESTS</h2></div><span>{requests.length}</span></div>{requests.length?requests.map(r=><div className="game-row" key={r.id}><strong>{r.status.toUpperCase()}</strong><span>{r.message||'No message'} · {new Date(r.created_at).toLocaleDateString()}</span>{r.status==='approved'&&<button className="button primary" disabled={busy} onClick={()=>acceptApprovedRequest(r.id)}>Accept team place</button>}</div>):<div className="team-empty compact"><strong>No join requests yet</strong><p>Requests you submit will appear here.</p></div>}</article></section>
    {message&&<p className="team-footnote" role="status">{message}</p>}<Link className="button secondary" to="/dashboard">← Back to dashboard</Link></main>;
}
