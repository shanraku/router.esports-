import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { isSupabaseConfigured, supabase } from './lib/supabase.js';

export default function CreatorLeaderboard() {
  const [session, setSession] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    let alive = true;
    supabase.auth.getSession().then(({ data }) => { if (alive) setSession(data.session); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!session?.user?.id) { setLoading(false); return; }
    let alive = true;
    supabase.rpc('get_creator_leaderboard').then(({ data, error: queryError }) => {
      if (!alive) return;
      if (queryError) setError('Creator rankings could not be loaded right now.');
      else setRows(data || []);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [session]);

  return <main className="creator-page creator-rankings-page">
    <section className="creator-hero"><span className="creator-kicker">ROUTER / CREATOR RANKINGS</span><h1>THE WORK<br/><em>EARNS THE RANK.</em></h1><p>Rankings are based on server-verified Creator XP from completed missions. Only public player profiles appear here. No purchased points, sample scores or cash prizes.</p><Link className="button secondary" to="/creator-studio">← BACK TO CREATOR STUDIO</Link></section>
    {!isSupabaseConfigured ? <div className="creator-message">Creator backend is not configured.</div> : !session ? <div className="creator-message">Sign in to view verified creator rankings. <Link to="/login">Sign in ↗</Link></div> : loading ? <p className="creator-status">Loading verified rankings…</p> : error ? <div className="creator-message">{error}</div> : rows.length === 0 ? <div className="creator-rank-empty"><span>R.</span><h2>THE FIRST RANK IS YOURS TO EARN.</h2><p>No creator has earned leaderboard XP yet. Complete a verified mission in Creator Studio to appear here.</p><Link className="button primary" to="/creator-studio">OPEN CREATOR STUDIO ↗</Link></div> : <section className="creator-rank-list"><div className="creator-rank-head"><span>RANK / PLAYER</span><span>VERIFIED XP</span></div>{rows.map((player) => <article className="creator-rank-row" key={player.user_id}><div className="creator-rank-player"><b>{String(player.rank).padStart(2,'0')}</b><div><strong>{player.display_name || player.player_handle}</strong><small>@{player.player_handle}{player.region ? ` · ${player.region}` : ''}</small></div></div><strong className="creator-rank-xp">{Number(player.total_xp).toLocaleString()} XP</strong></article>)}</section>}
    <p className="creator-footer-note">Creator XP is a community progress score only. It is not money, cannot be withdrawn and does not guarantee sponsorships or income.</p>
  </main>;
}
