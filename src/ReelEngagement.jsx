import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './lib/supabase.js';

const REASONS = [
  ['harassment', 'Harassment'],
  ['hate_or_abuse', 'Hate or abuse'],
  ['cheating_or_exploits', 'Cheating or exploits'],
  ['copyright', 'Copyright'],
  ['privacy_or_personal_data', 'Privacy or personal data'],
  ['spam', 'Spam'],
  ['other', 'Other']
];

function playerName(profile) {
  return profile?.display_name || profile?.player_handle || 'Player';
}

export function ReelEngagement({ clip, session, author }) {
  const [stats, setStats] = useState({ view_count: 0, like_count: 0, comment_count: 0 });
  const [liked, setLiked] = useState(false);
  const [comments, setComments] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [draft, setDraft] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState('other');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (clip.status !== 'approved') return;
    const [statResult, likeResult, commentResult] = await Promise.all([
      supabase.rpc('get_social_clip_stats', { p_clip_id: clip.id }),
      supabase.from('social_clip_likes').select('id').eq('clip_id', clip.id).eq('user_id', session.user.id).maybeSingle(),
      supabase.from('social_clip_comments').select('id,author_id,body,created_at')
        .eq('clip_id', clip.id).eq('status', 'visible').order('created_at', { ascending: true }).limit(100)
    ]);
    if (statResult.error) setNotice(statResult.error.message);
    else if (statResult.data?.[0]) setStats(statResult.data[0]);
    if (likeResult.error) setNotice(likeResult.error.message);
    else setLiked(Boolean(likeResult.data));
    if (commentResult.error) setNotice(commentResult.error.message);
    else {
      const rows = commentResult.data || [];
      setComments(rows);
      const ids = [...new Set(rows.map(row => row.author_id))];
      if (ids.length) {
        const people = await supabase.from('profiles').select('id,display_name,player_handle').in('id', ids);
        if (!people.error) setProfiles(Object.fromEntries((people.data || []).map(p => [p.id, p])));
      }
    }
  }, [clip.id, clip.status, session.user.id]);

  useEffect(() => { load(); }, [load]);

  async function toggleLike() {
    setBusy(true); setNotice('');
    const { data, error } = await supabase.rpc('toggle_social_clip_like', { p_clip_id: clip.id });
    if (error) setNotice(error.message);
    else {
      setLiked(Boolean(data?.liked));
      setStats(current => ({ ...current, like_count: Number(data?.like_count ?? current.like_count) }));
    }
    setBusy(false);
  }

  async function addComment(event) {
    event.preventDefault();
    if (!draft.trim()) return;
    setBusy(true); setNotice('');
    const { error } = await supabase.from('social_clip_comments').insert({
      clip_id: clip.id, author_id: session.user.id, body: draft.trim()
    });
    if (error) setNotice(error.message);
    else { setDraft(''); await load(); }
    setBusy(false);
  }

  async function submitReport(event) {
    event.preventDefault();
    setBusy(true); setNotice('');
    const { error } = await supabase.from('social_clip_reports').insert({
      clip_id: clip.id, reporter_id: session.user.id, reason, details: details.trim() || null
    });
    if (error) setNotice(error.code === '23505' ? 'You have already reported this clip.' : error.message);
    else { setReportOpen(false); setDetails(''); setNotice('Report submitted for moderator review.'); }
    setBusy(false);
  }

  if (clip.status !== 'approved') return null;
  return <div className="reel-engagement">
    <div className="reel-engagement-stats">
      <span>◉ {Number(stats.view_count || 0).toLocaleString()} views</span>
      <span>♥ {Number(stats.like_count || 0).toLocaleString()} likes</span>
      <span>▤ {Number(stats.comment_count || 0).toLocaleString()} comments</span>
    </div>
    <div className="reel-engagement-actions">
      <button className={liked ? 'active' : ''} disabled={busy} onClick={toggleLike}>{liked ? '♥ LIKED' : '♡ LIKE'}</button>
      <button onClick={() => document.getElementById('reel-comments-' + clip.id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}>COMMENT</button>
      {clip.author_id !== session.user.id && <button onClick={() => setReportOpen(open => !open)}>REPORT</button>}
    </div>
    <div className="reel-comments" id={'reel-comments-' + clip.id}>
      {comments.map(comment => <div className="reel-comment" key={comment.id}>
        <strong>{playerName(profiles[comment.author_id])}</strong>
        <span>{comment.body}</span>
        <small>{new Date(comment.created_at).toLocaleString()}</small>
      </div>)}
      <form onSubmit={addComment} className="reel-comment-form">
        <input aria-label="Write a comment" value={draft} onChange={event => setDraft(event.target.value)} maxLength={1000} placeholder="Add a respectful comment…" />
        <button disabled={busy || !draft.trim()}>SEND</button>
      </form>
    </div>
    {reportOpen && <form className="reel-report-form" onSubmit={submitReport}>
      <label>REPORT REASON<select value={reason} onChange={event => setReason(event.target.value)}>{REASONS.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>DETAILS (OPTIONAL)<textarea value={details} onChange={event => setDetails(event.target.value)} maxLength={1000} placeholder="Share context that can help moderators review this clip." /></label>
      <button disabled={busy}>SUBMIT REPORT</button>
    </form>}
    {notice && <p className="reel-interaction-notice" role="status">{notice}</p>}
  </div>;
}

export function ReelModerationQueue({ session }) {
  const [clips, setClips] = useState([]);
  const [reports, setReports] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [notes, setNotes] = useState({});
  const [busyId, setBusyId] = useState('');
  const [notice, setNotice] = useState('');
  const isModerator = ['admin', 'moderator'].includes(session?.user?.app_metadata?.role);

  const load = useCallback(async () => {
    if (!isModerator) return;
    const [clipResult, reportResult] = await Promise.all([
      supabase.from('social_clips').select('id,author_id,storage_path,caption,game_code,status,created_at')
        .in('status', ['pending', 'rejected', 'hidden']).order('created_at', { ascending: true }).limit(100),
      supabase.from('social_clip_reports').select('id,clip_id,reporter_id,reason,details,status,created_at')
        .in('status', ['pending', 'in_review']).order('created_at', { ascending: true }).limit(100)
    ]);
    if (clipResult.error || reportResult.error) {
      setNotice(clipResult.error?.message || reportResult.error?.message || 'Unable to load moderation queue.');
      return;
    }
    const clipRows = clipResult.data || [];
    const reportRows = reportResult.data || [];
    const previewRows = await Promise.all(clipRows.map(async clip => {
      const result = await supabase.storage.from('router-gameplay-clips')
        .createSignedUrl(clip.storage_path, 300);
      return {
        ...clip,
        previewUrl: result.data?.signedUrl || null,
        previewError: result.error?.message || null
      };
    }));
    setClips(previewRows);
    setReports(reportRows);
    const ids = [...new Set([...clipRows.map(c => c.author_id), ...reportRows.map(r => r.reporter_id)])];
    if (ids.length) {
      const people = await supabase.from('profiles').select('id,display_name,player_handle').in('id', ids);
      if (!people.error) setProfiles(Object.fromEntries((people.data || []).map(p => [p.id, p])));
    }
  }, [isModerator]);

  useEffect(() => { load(); }, [load]);

  async function moderate(type, id, action) {
    const reason = (notes[id] || '').trim();
    if (reason.length < 3) { setNotice('Add a review reason (at least 3 characters) before taking action.'); return; }
    setBusyId(id); setNotice('');
    const { error } = await supabase.rpc('moderate_social_clip', {
      p_target_type: type, p_target_id: id, p_action: action, p_reason: reason
    });
    if (error) setNotice(error.message);
    else { setNotice('Moderation action saved with an audit record.'); await load(); }
    setBusyId('');
  }

  if (!isModerator) return null;
  return <section className="reel-moderation">
    <div className="reels-section-kicker">03 / MODERATOR CONTROL ROOM</div>
    <div className="reel-moderation-head"><h2>REVIEW QUEUE</h2><button onClick={load}>REFRESH QUEUE</button></div>
    {notice && <p className="reels-message" role="status">{notice}</p>}
    <h3>CLIPS AWAITING REVIEW</h3>
    {clips.length ? clips.map(clip => <article className="reel-review-row" key={clip.id}>
      <div>
        <strong>{clip.caption}</strong>
        <small>{playerName(profiles[clip.author_id])} · {clip.status} · {new Date(clip.created_at).toLocaleString()}</small>
        {clip.previewUrl
          ? <video className="reel-review-preview" src={clip.previewUrl} controls playsInline preload="metadata"/>
          : <small role="status">{clip.previewError || 'Private preview unavailable.'}</small>}
      </div>
      <textarea aria-label="Moderator reason" value={notes[clip.id] || ''} onChange={event => setNotes(current => ({ ...current, [clip.id]: event.target.value }))} placeholder="Review reason (required)" maxLength={1000}/>
      <div className="reel-review-actions">
        {clip.status !== 'pending' && <button disabled={busyId === clip.id} onClick={() => moderate('clip', clip.id, 'restore_clip')}>RESTORE / APPROVE</button>}
        {clip.status === 'pending' && <button disabled={busyId === clip.id} onClick={() => moderate('clip', clip.id, 'approve_clip')}>APPROVE</button>}
        <button disabled={busyId === clip.id} onClick={() => moderate('clip', clip.id, 'reject_clip')}>REJECT</button>
        <button disabled={busyId === clip.id} onClick={() => moderate('clip', clip.id, 'remove_clip')}>REMOVE</button>
      </div>
    </article>) : <p className="reel-queue-empty">No clips currently need review.</p>}
    <h3>PLAYER REPORTS</h3>
    {reports.length ? reports.map(report => <article className="reel-review-row" key={report.id}>
      <div><strong>{report.reason.replaceAll('_', ' ')}</strong><small>{report.details || 'No extra details'} · reported by {playerName(profiles[report.reporter_id])}</small></div>
      <textarea aria-label="Moderator resolution note" value={notes[report.id] || ''} onChange={event => setNotes(current => ({ ...current, [report.id]: event.target.value }))} placeholder="Resolution reason (required)" maxLength={1000}/>
      <div className="reel-review-actions">
        <button disabled={busyId === report.id} onClick={() => moderate('report', report.id, 'resolve_report')}>RESOLVE</button>
        <button disabled={busyId === report.id} onClick={() => moderate('report', report.id, 'dismiss_report')}>DISMISS</button>
      </div>
    </article>) : <p className="reel-queue-empty">No open player reports.</p>}
  </section>;
}
