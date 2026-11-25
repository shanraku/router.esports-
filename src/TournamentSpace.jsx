import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { isSupabaseConfigured, supabase } from './lib/supabase.js';

const GAME_OPTIONS = [{ value: 'free_fire_max', label: 'Free Fire MAX' }];
const emptyForm = {
  title: '', game_code: 'free_fire_max', format: 'team', description: '',
  rules: '', region: 'India', timezone: 'Asia/Kolkata',
  registration_opens_at: '', registration_closes_at: '', starts_at: ''
};

function dateLabel(value, timezone) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium', timeStyle: 'short', timeZone: timezone || 'UTC'
    }).format(new Date(value));
  } catch { return new Date(value).toLocaleString(); }
}

function StatusPill({ children }) {
  return <span className={`tournament-status tournament-status-${String(children).toLowerCase()}`}>{children}</span>;
}

export default function TournamentHub() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [events, setEvents] = useState([]);
  const [registrations, setRegistrations] = useState([]);
  const [teams, setTeams] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [teamChoice, setTeamChoice] = useState({});

  const load = useCallback(async (user = session?.user) => {
    if (!supabase) return;
    const { data: eventRows, error: eventError } = await supabase
      .from('tournaments')
      .select('id,title,game_code,format,description,rules,region,timezone,registration_opens_at,registration_closes_at,starts_at,status,created_at,created_by')
      .order('starts_at', { ascending: true });
    if (eventError) throw eventError;
    setEvents(eventRows || []);
    if (!user) { setRegistrations([]); setTeams([]); return; }
    const [registrationResult, teamResult] = await Promise.all([
      supabase.from('tournament_registrations')
        .select('id,tournament_id,player_id,team_id,status,registered_at')
        .eq('registered_by', user.id)
        .order('registered_at', { ascending: false }),
      supabase.from('teams')
        .select('id,team_name,game_code')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false })
    ]);
    if (registrationResult.error) throw registrationResult.error;
    if (teamResult.error) throw teamResult.error;
    setRegistrations(registrationResult.data || []);
    setTeams(teamResult.data || []);
  }, [session?.user?.id]);

  useEffect(() => {
    if (!supabase) { setReady(true); return; }
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) setMessage(error.message);
      const next = data?.session || null;
      setSession(next);
      setReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!ready || !supabase) return;
    load(session?.user).catch(error => setMessage(error.message || 'Could not load tournaments.'));
  }, [ready, session?.user?.id, load]);

  function changeForm(event) {
    setForm(current => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function createDraft(event) {
    event.preventDefault();
    if (!session?.user) { setMessage('Sign in before creating a tournament draft.'); return; }
    setBusy(true); setMessage('');
    try {
      const payload = {
        title: form.title.trim(), game_code: form.game_code, format: form.format,
        description: form.description.trim(), rules: form.rules.trim(),
        region: form.region.trim(), timezone: form.timezone.trim(),
        registration_opens_at: new Date(form.registration_opens_at).toISOString(),
        registration_closes_at: new Date(form.registration_closes_at).toISOString(),
        starts_at: new Date(form.starts_at).toISOString(),
        created_by: session.user.id, status: 'draft', visibility: 'public'
      };
      const { error } = await supabase.from('tournaments').insert(payload);
      if (error) throw error;
      setForm(emptyForm);
      setMessage('Tournament draft saved. It is private to you until an authorised admin publishes it.');
      await load(session.user);
    } catch (error) { setMessage(error.message || 'Could not save the draft.'); }
    finally { setBusy(false); }
  }

  async function register(eventItem) {
    if (!session?.user) { setMessage('Sign in to register for a tournament.'); return; }
    setBusy(true); setMessage('');
    try {
      const payload = eventItem.format === 'solo'
        ? { tournament_id: eventItem.id, player_id: session.user.id, team_id: null, registered_by: session.user.id, status: 'registered' }
        : { tournament_id: eventItem.id, player_id: null, team_id: teamChoice[eventItem.id], registered_by: session.user.id, status: 'registered' };
      if (eventItem.format === 'team' && !payload.team_id) throw new Error('Choose one of your teams first.');
      const { error } = await supabase.from('tournament_registrations').insert(payload);
      if (error) throw error;
      setMessage('Registration submitted successfully.');
      await load(session.user);
    } catch (error) { setMessage(error.message || 'Registration could not be completed. Check your game profile and team eligibility.'); }
    finally { setBusy(false); }
  }

  async function cancelRegistration(registrationId) {
    setBusy(true); setMessage('');
    try {
      const { error } = await supabase.from('tournament_registrations')
        .update({ status: 'cancelled' }).eq('id', registrationId);
      if (error) throw error;
      setMessage('Registration cancelled.');
      await load(session.user);
    } catch (error) { setMessage(error.message || 'Could not cancel registration.'); }
    finally { setBusy(false); }
  }

  if (!isSupabaseConfigured) return <main className="subpage"><div className="eyebrow"><i/> ROUTER.ESPORTS / TOURNAMENTS</div><h1>THE ARENA<br/><span>IS LOADING.</span></h1><div className="backend-banner"><b>!</b><p><strong>Backend configuration required</strong><br/>Tournament listings and registrations are not available until the Supabase public client configuration is present.</p></div></main>;

  const now = Date.now();
  const published = events.filter(item => item.status === 'published');
  const drafts = events.filter(item => item.status === 'draft' && item.created_by === session?.user?.id);
  const myActive = registrations.filter(item => item.status === 'registered');

  return <main className="tournament-page">
    <div className="eyebrow"><i/> ROUTER.ESPORTS / COMPETITION HUB</div>
    <div className="tournament-heading">
      <div><h1>FIND YOUR<br/><span>NEXT BATTLE.</span></h1><p>Real events. Clear rules. Verified publishing. Start with your game and compete on fair terms.</p></div>
      <div className="tournament-heading-mark">R<span>.</span></div>
    </div>
    <div className="tournament-trust"><span>01 / OPEN EVENTS <b>{published.length}</b></span><span>02 / YOUR ENTRIES <b>{myActive.length}</b></span><span>03 / YOUR DRAFTS <b>{drafts.length}</b></span></div>

    <section className="tournament-section">
      <div className="tournament-section-head"><div><small>01 / COMPETE</small><h2>OPEN TOURNAMENTS</h2></div><span>LIVE DATA ONLY</span></div>
      {!ready ? <div className="tournament-empty">Loading tournament listings…</div> : published.length === 0
        ? <div className="tournament-empty"><b>NO PUBLISHED EVENTS YET.</b><p>When an authorised organiser publishes a real event, it will appear here. We do not display sample tournaments or invented prize pools.</p></div>
        : <div className="tournament-grid">{published.map(item => {
          const open = new Date(item.registration_opens_at).getTime() <= now && new Date(item.registration_closes_at).getTime() > now;
          const existing = registrations.find(reg => reg.tournament_id === item.id && reg.status === 'registered');
          const matchingTeams = teams.filter(team => team.game_code === item.game_code);
          return <article className="tournament-card" key={item.id}>
            <div className="tournament-card-top"><span>{item.region}</span><StatusPill>{open ? 'Registration open' : 'Published'}</StatusPill></div>
            <h3>{item.title}</h3><p>{item.description || 'Official community competition. Read the rules before joining.'}</p>
            <div className="tournament-meta"><div><small>GAME</small><b>{GAME_OPTIONS.find(g=>g.value===item.game_code)?.label || item.game_code}</b></div><div><small>FORMAT</small><b>{item.format.toUpperCase()}</b></div><div><small>STARTS</small><b>{dateLabel(item.starts_at,item.timezone)}</b></div><div><small>REGISTRATION CLOSES</small><b>{dateLabel(item.registration_closes_at,item.timezone)}</b></div></div>
            <details className="tournament-rules"><summary>Read tournament rules</summary><p>{item.rules}</p></details>
            {existing ? <div className="tournament-entry"><StatusPill>Registered</StatusPill><button className="button secondary" disabled={busy} onClick={()=>cancelRegistration(existing.id)}>Cancel entry</button></div>
              : open ? <div className="tournament-entry">{item.format === 'team' && <select value={teamChoice[item.id] || ''} onChange={e=>setTeamChoice(v=>({...v,[item.id]:e.target.value}))}><option value="">Choose your team</option>{matchingTeams.map(team=><option key={team.id} value={team.id}>{team.team_name}</option>)}</select>}<button className="button primary" disabled={busy || (item.format==='team' && matchingTeams.length===0)} onClick={()=>register(item)}>{item.format==='solo'?'Register solo':'Register team'}</button>{item.format==='team' && matchingTeams.length===0 && <small>Create a team for this game before registering.</small>}</div>
              : <div className="tournament-closed">Registration is not currently open.</div>}
          </article>;
        })}</div>}
    </section>

    <section className="tournament-section tournament-organiser">
      <div className="tournament-section-head"><div><small>02 / ORGANISERS</small><h2>CREATE A TOURNAMENT DRAFT</h2></div><span>ADMIN PUBLISHING REQUIRED</span></div>
      {!session ? <div className="tournament-empty"><b>ORGANISER ACCESS</b><p>Sign in to prepare a tournament draft. Drafts are not public and cannot be self-published.</p><Link className="button primary" to="/login">Sign in ↗</Link></div> : <form className="tournament-form" onSubmit={createDraft}>
        <label>Tournament title<input name="title" value={form.title} onChange={changeForm} minLength="4" maxLength="100" required placeholder="Enter official event name"/></label>
        <label>Game<select name="game_code" value={form.game_code} onChange={changeForm}>{GAME_OPTIONS.map(game=><option key={game.value} value={game.value}>{game.label}</option>)}</select></label>
        <label>Competition format<select name="format" value={form.format} onChange={changeForm}><option value="solo">Solo</option><option value="team">Team</option></select></label>
        <label>Region<input name="region" value={form.region} onChange={changeForm} maxLength="80" required/></label>
        <label>Timezone<input name="timezone" value={form.timezone} onChange={changeForm} maxLength="80" required placeholder="Asia/Kolkata"/></label>
        <label>Registration opens<input type="datetime-local" name="registration_opens_at" value={form.registration_opens_at} onChange={changeForm} required/></label>
        <label>Registration closes<input type="datetime-local" name="registration_closes_at" value={form.registration_closes_at} onChange={changeForm} required/></label>
        <label>Event starts<input type="datetime-local" name="starts_at" value={form.starts_at} onChange={changeForm} required/></label>
        <label className="tournament-form-wide">Event description<textarea name="description" value={form.description} onChange={changeForm} maxLength="2000" placeholder="Eligibility, event overview and key information"/></label>
        <label className="tournament-form-wide">Tournament rules<textarea name="rules" value={form.rules} onChange={changeForm} minLength="10" maxLength="10000" required placeholder="Explain eligibility, match format, fair-play rules, reporting and result review"/></label>
        <div className="tournament-form-actions"><button className="button primary" disabled={busy}>{busy?'Saving…':'Save tournament draft'}</button><small>Drafts are not visible to players. Only the trusted publishing workflow can make an event public.</small></div>
      </form>}
      {drafts.length>0 && <div className="tournament-drafts"><h3>YOUR SAVED DRAFTS</h3>{drafts.map(item=><div key={item.id}><b>{item.title}</b><StatusPill>Draft</StatusPill><span>{dateLabel(item.starts_at,item.timezone)}</span></div>)}</div>}
    </section>

    {message && <p className="tournament-message" role="status">{message}</p>}
    <div className="backend-banner"><b>!</b><p><strong>Publishing and capacity controls remain protected.</strong><br/>Tournament publishing, capacity enforcement, organiser verification, match fixtures and results will be enabled only after trusted admin workflows are completed and tested. No paid entry or prize payment is active.</p></div>
  </main>;
}
