import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { isSupabaseConfigured, supabase } from './lib/supabase.js';

const DAY = 24 * 60 * 60 * 1000;
const since = (days) => new Date(Date.now() - days * DAY).toISOString();
const countQuery = (table, column, userId, days) => {
  let query = supabase.from(table).select('id', { count: 'exact', head: true }).eq(column, userId);
  if (days) query = query.gte('created_at', since(days));
  return query;
};

export default function CreatorStudio() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ followers: 0, approved: 0, clips30: 0, clips7: 0, posts7: 0, pending: 0, viewsAll: 0, watchMinutesAll: 0, views30: 0, watchMinutes30: 0 });
  const [error, setError] = useState('');
  const [rewards, setRewards] = useState(null);
  const [rewardsVersion, setRewardsVersion] = useState(0);
  const [claiming, setClaiming] = useState('');
  const [claimMessage, setClaimMessage] = useState('');

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (alive) { setSession(data.session); setLoading(false); }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return;
    let alive = true;
    async function loadStats() {
      setLoading(true); setError('');
      const id = session.user.id;
      const results = await Promise.all([
        countQuery('follows', 'following_id', id),
        countQuery('social_clips', 'author_id', id).eq('status', 'approved'),
        countQuery('social_clips', 'author_id', id, 30).eq('status', 'approved'),
        countQuery('social_clips', 'author_id', id, 7).eq('status', 'approved'),
        countQuery('social_posts', 'author_id', id, 7),
        countQuery('social_clips', 'author_id', id).eq('status', 'pending'),
        supabase.rpc('get_creator_clip_analytics')
      ]);
      const failed = results.find(result => result.error);
      if (!alive) return;
      if (failed) setError(failed.error.message);
      else {
        const analytics = results[6].data || [];
        setStats({
          followers: results[0].count || 0, approved: results[1].count || 0,
          clips30: results[2].count || 0, clips7: results[3].count || 0,
          posts7: results[4].count || 0, pending: results[5].count || 0,
          viewsAll: analytics.reduce((sum, row) => sum + Number(row.valid_views || 0), 0),
          watchMinutesAll: Math.floor(analytics.reduce((sum, row) => sum + Number(row.valid_watch_seconds || 0), 0) / 60),
          views30: analytics.reduce((sum, row) => sum + Number(row.views_30d || 0), 0),
          watchMinutes30: Math.floor(analytics.reduce((sum, row) => sum + Number(row.watch_seconds_30d || 0), 0) / 60)
        });
      }
      setLoading(false);
    }
    loadStats();
    return () => { alive = false; };
  }, [session]);

  useEffect(() => {
    if (!session?.user?.id) return;
    let alive = true;
    supabase.rpc('get_creator_rewards_dashboard').then(({ data, error: rewardsError }) => {
      if (!alive) return;
      if (rewardsError) setClaimMessage('Rewards are temporarily unavailable. Please try again later.');
      else setRewards(data);
    });
    return () => { alive = false; };
  }, [session, rewardsVersion]);

  async function claimMission(code) {
    setClaiming(code); setClaimMessage('');
    const { data, error: claimError } = await supabase.rpc('claim_creator_mission', { p_mission_code: code });
    if (claimError) setClaimMessage('Mission claim could not be completed. Please retry.');
    else if (data?.success) setClaimMessage(`Mission verified — ${data.xp_awarded} XP added. Your total is ${data.total_xp} XP.`);
    else if (data?.reason === 'not_complete') setClaimMessage('This mission is not complete yet. Progress was checked again by the server.');
    else if (data?.reason === 'already_claimed') setClaimMessage('This mission reward has already been claimed for this period.');
    else setClaimMessage('No reward was issued. Please refresh and try again.');
    setClaiming(''); setRewardsVersion(value => value + 1);
  }

  const accountDays = useMemo(() => {
    const created = session?.user?.created_at;
    return created ? Math.max(0, Math.floor((Date.now() - new Date(created).getTime()) / DAY)) : 0;
  }, [session]);
  const fallbackMissions = [
    { label: 'Your first five POVs', detail: 'Publish five original clips that pass community review.', value: stats.approved, target: 5, tag: 'FOUNDATION' },
    { label: 'Build your squad', detail: 'Grow a genuine community of 50 followers.', value: stats.followers, target: 50, tag: 'COMMUNITY' },
    { label: 'Creator consistency', detail: 'Get three original clips approved this week.', value: stats.clips7, target: 3, tag: 'WEEKLY' },
    { label: 'Join the conversation', detail: 'Share one useful gaming update with the community this week.', value: stats.posts7, target: 1, tag: 'COMMUNITY' }
  ];
  const missions = rewards?.missions || fallbackMissions.map((mission, index) => ({ code: ['first_five_povs','build_your_squad','weekly_three_clips','community_post_week'][index], title: mission.label, description: mission.detail, progress: mission.value, target_count: mission.target, xp_reward: 0, can_claim: false, claimed: false, period_type: 'preview' }));
  const risingReady = stats.followers >= 50 && stats.approved >= 5 && accountDays >= 30;

  if (!isSupabaseConfigured) return <main className="creator-page"><section className="creator-hero"><span className="creator-kicker">ROUTER / CREATOR PROGRAM</span><h1>MAKE YOUR<br/><em>GAMEPLAY COUNT.</em></h1><p>Connect the ROUTER community backend to unlock your Creator Studio.</p></section></main>;
  if (loading && !session) return <main className="creator-page"><p>Loading Creator Studio…</p></main>;
  if (!session) return <main className="creator-page"><section className="creator-hero"><span className="creator-kicker">ROUTER / CREATOR PROGRAM</span><h1>MAKE YOUR<br/><em>GAMEPLAY COUNT.</em></h1><p>Track your creator journey, complete community missions and build toward future monetization.</p><Link className="button primary" to="/login">SIGN IN TO OPEN STUDIO ↗</Link></section></main>;

  return <main className="creator-page">
    <section className="creator-hero"><span className="creator-kicker">ROUTER / CREATOR PROGRAM · BETA</span><h1>MAKE YOUR<br/><em>GAMEPLAY COUNT.</em></h1><p>Your creator journey starts with original gameplay, useful community contributions and real people who enjoy your content. Build consistently—your progress is tracked from ROUTER data.</p></section>
    {error && <div className="creator-message">We could not load all creator statistics: {error}</div>}
    <section className="creator-reward-overview">
      <article className="creator-xp-card"><small>VERIFIED CREATOR XP</small><strong>{rewards?.total_xp ?? '—'} <span>XP</span></strong><p>XP is awarded only after the server rechecks completed missions. Points have no cash value.</p></article>
      <article className="creator-xp-card creator-badge-summary"><small>BADGES EARNED</small><strong>{rewards?.badges?.filter(badge => badge.earned).length ?? '—'} <span>/ {rewards?.badges?.length ?? '—'}</span></strong><p>Badges unlock from verified creator milestones.</p><Link className="button secondary" to="/creator-leaderboard">VIEW CREATOR RANKINGS ↗</Link></article>
    </section>
    <section className="creator-level-row">
      <article className="creator-level-card"><small>YOUR CURRENT CREATOR LEVEL</small><strong>{risingReady ? 'RISING CANDIDATE' : 'STARTER CREATOR'}</strong><p>{risingReady ? 'Your follower, approved-clip and account-age milestones are complete. Genuine reach verification is still required.' : 'Complete the starter missions below to build your creator foundation.'}</p></article>
      <article className="creator-level-card"><small>YOUR NEXT MILESTONE</small><strong>{Math.min(stats.approved, 5)}/5 POVs</strong><p>{stats.pending} clip(s) waiting for review. Pending clips do not count as approved creator progress.</p><Link className="button secondary" to="/reels">OPEN GAMEPLAY POV ↗</Link></article>
    </section>
    <section className="creator-metrics">
      <article className="creator-metric"><small>Followers</small><strong>{stats.followers}</strong></article>
      <article className="creator-metric"><small>Approved POVs</small><strong>{stats.approved}</strong></article>
      <article className="creator-metric"><small>Approved · 30 days</small><strong>{stats.clips30}</strong></article>
      <article className="creator-metric"><small>Account age</small><strong>{accountDays}d</strong></article>
      <article className="creator-metric"><small>Valid views · 30 days</small><strong>{stats.views30}</strong></article>
      <article className="creator-metric"><small>Watch minutes · 30 days</small><strong>{stats.watchMinutes30}</strong></article>
      <article className="creator-metric"><small>All-time valid views</small><strong>{stats.viewsAll}</strong></article>
      <article className="creator-metric"><small>All-time watch minutes</small><strong>{stats.watchMinutesAll}</strong></article>
    </section>
    <div className="creator-section-head"><div><span className="creator-section-kicker">01 / YOUR MISSIONS</span><h2>SMALL STEPS. REAL PROGRESS.</h2></div><p>Mission progress uses approved clips, actual followers and your community posts. No paid entry and no deposit required.</p></div>
    {claimMessage && <div className="creator-message" role="status">{claimMessage}</div>}
    <section className="creator-missions">{missions.map((mission) => {
      const progress = Number(mission.progress || 0); const target = Number(mission.target_count || 1);
      const pct = Math.min(100, Math.round((progress / target) * 100));
      return <article className="creator-mission" key={mission.code}><div className="creator-mission-top"><span>{String(mission.period_type || 'MISSION').toUpperCase()}</span><span>{mission.claimed ? 'REWARD CLAIMED' : mission.can_claim ? 'READY TO CLAIM' : pct >= 100 ? 'VERIFYING' : 'IN PROGRESS'}</span></div><h3>{mission.title}</h3><p>{mission.description}</p><div className="creator-progress"><i style={{ width: pct + '%' }}/></div><div className="creator-progress-label"><span>{progress} / {target}</span><span>{pct}% · {mission.xp_reward} XP</span></div>{mission.can_claim && <button className="button primary creator-claim-button" disabled={claiming === mission.code} onClick={() => claimMission(mission.code)}>{claiming === mission.code ? 'VERIFYING…' : `CLAIM ${mission.xp_reward} XP`}</button>}{mission.claimed && <small className="creator-claimed-note">Already claimed for this period</small>}</article>;
    })}</section>
    <div className="creator-section-head"><div><span className="creator-section-kicker">01 / YOUR BADGES</span><h2>PROGRESS YOU CAN PROVE.</h2></div><p>Badges unlock automatically when your account meets verified milestones.</p></div>
    <section className="creator-badge-grid">{(rewards?.badges || []).map(badge => <article className={`creator-badge ${badge.earned ? 'earned' : ''}`} key={badge.code}><span>{badge.icon}</span><div><strong>{badge.title}</strong><p>{badge.description}</p><small>{badge.earned ? 'UNLOCKED' : 'LOCKED'}</small></div></article>)}</section>
    <div className="creator-section-head"><div><span className="creator-section-kicker">02 / RISING CREATOR</span><h2>YOUR FIRST EARNING MILESTONE.</h2></div></div>
    <section className="creator-gate"><h3>Rising Creator — proposed eligibility</h3><ul><li>{stats.followers >= 50 ? '✓' : '○'} 50 genuine followers ({stats.followers}/50)</li><li>{stats.approved >= 5 ? '✓' : '○'} 5 approved original gameplay clips ({stats.approved}/5)</li><li>{accountDays >= 30 ? '✓' : '○'} Account at least 30 days old ({accountDays}/30 days)</li><li>{stats.views30 >= 5000 || stats.watchMinutes30 >= 2000 ? '✓' : '○'} 5,000 genuine views OR 2,000 valid watch minutes in the last 30 days ({stats.views30} views / {stats.watchMinutes30} minutes)</li><li>○ Good account health with no serious copyright or community violations</li></ul><div className="pending-note">Views count only after a signed-in viewer watches at least 30 seconds of an approved public clip. A viewer can count once per clip per UTC day. These basic anti-abuse checks do not eliminate all fraud; final eligibility requires review. Completing milestones does not guarantee approval or income.</div></section>
    <div className="creator-section-head"><div><span className="creator-section-kicker">03 / EARNINGS & PAYOUTS</span><h2>BUILT ON REAL REVENUE.</h2></div></div>
    <section className="creator-gate"><h3>Monetization is not active yet</h3><p>Future earning sources may include ad revenue share, viewer support, brand sponsorships and funded creator campaigns. A proposed 80/20 creator/platform split is still a planning target—not a live promise or payable balance.</p><p>Cash payouts will only launch after verified revenue funding, fraud checks, applicable identity/tax compliance and secure payout infrastructure are ready.</p></section>
    <p className="creator-footer-note">Original content only. Fake views, purchased followers, copied clips and copyright violations will not qualify. ROUTER never asks creators to pay a registration or activation fee to earn.</p>
  </main>;
}
