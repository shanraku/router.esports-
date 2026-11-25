import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { isSupabaseConfigured, supabase } from './lib/supabase.js';

function shortName(profile) {
  return profile?.display_name || profile?.player_handle || 'Player';
}

export default function SocialSpace() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('feed');
  const [feedMode, setFeedMode] = useState('all');
  const [posts, setPosts] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [following, setFollowing] = useState([]);
  const [body, setBody] = useState('');
  const [gameCode, setGameCode] = useState('free_fire_max');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!isSupabaseConfigured) { setReady(true); return; }
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setReady(true);
    });
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, []);

  const load = useCallback(async () => {
    if (!session?.user) { setPosts([]); setProfiles([]); setFollowing([]); return; }
    setMessage('');
    const [{ data: postRows, error: postError }, { data: followRows, error: followError }, { data: people, error: peopleError }] = await Promise.all([
      supabase.from('social_posts').select('id,author_id,body,game_code,created_at').order('created_at', { ascending: false }).limit(60),
      supabase.from('follows').select('following_id').eq('follower_id', session.user.id),
      supabase.from('profiles').select('id,player_handle,display_name,avatar_path,bio,region').order('created_at', { ascending: false }).limit(80)
    ]);
    if (postError || followError || peopleError) {
      setMessage(postError?.message || followError?.message || peopleError?.message || 'Unable to load community.');
      return;
    }
    const ids = [...new Set([...(postRows || []).map(p => p.author_id), ...(people || []).map(p => p.id)])];
    let authorRows = people || [];
    if (ids.length) {
      const { data: ownOrPublic } = await supabase.from('profiles').select('id,player_handle,display_name,avatar_path,bio,region').in('id', ids);
      if (ownOrPublic) authorRows = ownOrPublic;
    }
    setPosts(postRows || []);
    setProfiles(authorRows);
    setFollowing((followRows || []).map(f => f.following_id));
  }, [session]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  const profileMap = useMemo(() => new Map(profiles.map(p => [p.id, p])), [profiles]);
  const visiblePosts = useMemo(() => feedMode === 'following'
    ? posts.filter(p => following.includes(p.author_id) || p.author_id === session?.user?.id)
    : posts, [posts, following, feedMode, session]);
  const discover = useMemo(() => profiles.filter(p => p.id !== session?.user?.id && !following.includes(p.id)), [profiles, following, session]);

  async function publish(e) {
    e.preventDefault();
    if (!body.trim() || !session?.user) return;
    setBusy(true); setMessage('');
    const { error } = await supabase.from('social_posts').insert({
      author_id: session.user.id,
      body: body.trim(),
      game_code: gameCode || null
    });
    if (error) setMessage(error.message);
    else { setBody(''); setMessage('Your community update is live.'); await load(); }
    setBusy(false);
  }

  async function toggleFollow(profileId) {
    if (!session?.user) return;
    setBusy(true); setMessage('');
    const isFollowing = following.includes(profileId);
    const result = isFollowing
      ? await supabase.from('follows').delete().eq('follower_id', session.user.id).eq('following_id', profileId)
      : await supabase.from('follows').insert({ follower_id: session.user.id, following_id: profileId });
    if (result.error) setMessage(result.error.message);
    else await load();
    setBusy(false);
  }

  if (!isSupabaseConfigured) return <main className="social-page"><div className="social-hero"><span>ROUTER / COMMUNITY</span><h1>FIND YOUR<br/><em>PEOPLE.</em></h1><p>Connect the Supabase project to open the community.</p></div></main>;
  if (!ready) return <main className="social-page"><p>Loading community…</p></main>;
  if (!session) return <main className="social-page"><div className="social-hero"><span>ROUTER / COMMUNITY</span><h1>YOUR GAME.<br/><em>YOUR PEOPLE.</em></h1><p>Sign in to follow players, share updates and discover the gaming community.</p><Link className="button primary" to="/login">Sign in to join ↗</Link></div></main>;

  return <main className="social-page">
    <div className="social-hero"><span>ROUTER / SOCIAL NETWORK</span><h1>THE GAME IS<br/><em>BETTER TOGETHER.</em></h1><p>Find players, share your journey and build your gaming circle. Gameplay media and direct messages are coming in later stages.</p></div>
    <div className="social-tabs" role="tablist" aria-label="Community sections">
      <button className={tab === 'feed' ? 'active' : ''} onClick={() => setTab('feed')}>COMMUNITY FEED</button>
      <button className={tab === 'discover' ? 'active' : ''} onClick={() => setTab('discover')}>DISCOVER PLAYERS</button>
      <Link to="/profile">MY PLAYER PROFILE ↗</Link>
    </div>
    {tab === 'feed' ? <>
      <section className="social-composer">
        <div className="social-composer-mark">R.</div>
        <form onSubmit={publish}>
          <label htmlFor="community-post">SHARE AN UPDATE WITH THE COMMUNITY</label>
          <textarea id="community-post" value={body} onChange={e => setBody(e.target.value)} maxLength={2000} placeholder="Your latest match, a team search, a question, or a moment worth sharing…" required />
          <div className="social-compose-bottom"><select aria-label="Game tag" value={gameCode} onChange={e => setGameCode(e.target.value)}><option value="free_fire_max">Free Fire MAX</option><option value="other">Other gaming</option></select><span>{body.length}/2000</span><button className="button primary" disabled={busy || !body.trim()}>{busy ? 'Posting…' : 'PUBLISH UPDATE ↗'}</button></div>
        </form>
      </section>
      <div className="social-feed-tools"><div><button className={feedMode === 'all' ? 'active' : ''} onClick={() => setFeedMode('all')}>LATEST</button><button className={feedMode === 'following' ? 'active' : ''} onClick={() => setFeedMode('following')}>FOLLOWING</button></div><span>REAL COMMUNITY POSTS · NO SAMPLE CONTENT</span></div>
      <section className="social-feed">
        {visiblePosts.length ? visiblePosts.map(post => {
          const author = profileMap.get(post.author_id);
          return <article className="social-post" key={post.id}>
            <div className="social-post-head"><div className="social-avatar">{shortName(author).slice(0,1).toUpperCase()}</div><div><strong>{shortName(author)}</strong><small>@{author?.player_handle || 'player'} · {new Date(post.created_at).toLocaleString()}</small></div><span>{post.game_code?.replaceAll('_',' ').toUpperCase() || 'COMMUNITY'}</span></div>
            <p>{post.body}</p>
          </article>;
        }) : <div className="social-empty"><span>R.</span><h2>THE FEED STARTS WITH YOU.</h2><p>{feedMode === 'following' ? 'Follow players to build your personal feed, or switch to Latest to see public community updates.' : 'No community updates have been published yet. Share the first update and invite other players to join.'}</p></div>}
      </section>
    </> : <section className="social-discover">
      <div className="social-discover-heading"><div><span>COMMUNITY DIRECTORY</span><h2>MEET THE PLAYERS.</h2></div><small>{discover.length} PLAYERS TO DISCOVER</small></div>
      {discover.length ? <div className="social-player-grid">{discover.map(player => <article className="social-player-card" key={player.id}><div className="social-avatar large">{shortName(player).slice(0,1).toUpperCase()}</div><h3>{shortName(player)}</h3><p>@{player.player_handle}</p><small>{player.region || 'Gaming community'}{player.bio ? ' · ' + player.bio : ''}</small><button className="button secondary" disabled={busy} onClick={() => toggleFollow(player.id)}>＋ FOLLOW PLAYER</button></article>)}</div> : <div className="social-empty"><span>⌁</span><h2>MORE PLAYERS, MORE CONNECTIONS.</h2><p>Public player profiles will appear here as the community grows. Complete your profile to help other players find you.</p><Link to="/profile">Complete your profile ↗</Link></div>}
    </section>}
    {message && <p className="social-status" role="status">{message}</p>}
    <div className="social-safety">Be respectful. Never share passwords, OTPs, payment PINs or private personal details in public posts. Reporting, blocking and media moderation are part of the next safety milestone.</div>
  </main>;
}
