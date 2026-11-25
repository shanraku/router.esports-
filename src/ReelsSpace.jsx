import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { isSupabaseConfigured, supabase } from './lib/supabase.js';

const BUCKET = 'router-gameplay-clips';
const MAX_BYTES = 25 * 1024 * 1024;
const ACCEPTED = ['video/mp4', 'video/webm'];

function playerName(profile) {
  return profile?.display_name || profile?.player_handle || 'Player';
}

function inspectVideo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = video.duration;
      URL.revokeObjectURL(url);
      if (!Number.isFinite(duration) || duration <= 0) reject(new Error('Could not read video duration.'));
      else if (duration > 90) reject(new Error('POV clips must be 90 seconds or shorter.'));
      else resolve(duration);
    };
    video.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Please choose a valid MP4 or WebM video.')); };
    video.src = url;
  });
}

export default function ReelsSpace() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [clips, setClips] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [caption, setCaption] = useState('');
  const [gameCode, setGameCode] = useState('free_fire_max');
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState('approved');

  useEffect(() => {
    if (!file) { setPreviewUrl(''); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!isSupabaseConfigured) { setReady(true); return; }
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, []);

  const load = useCallback(async () => {
    if (!session?.user) { setClips([]); setProfiles([]); return; }
    setMessage('');
    const { data, error } = await supabase.from('social_clips')
      .select('id,author_id,storage_path,caption,game_code,duration_seconds,status,created_at')
      .or(`status.eq.approved,author_id.eq.${session.user.id}`)
      .order('created_at', { ascending: false }).limit(40);
    if (error) { setMessage(error.message); return; }
    const rows = data || [];
    const ids = [...new Set(rows.map(row => row.author_id))];
    let people = [];
    if (ids.length) {
      const result = await supabase.from('profiles').select('id,player_handle,display_name').in('id', ids);
      if (result.error) { setMessage(result.error.message); return; }
      people = result.data || [];
    }
    const signedRows = await Promise.all(rows.map(async clip => {
      const result = await supabase.storage.from(BUCKET).createSignedUrl(clip.storage_path, 900);
      return { ...clip, signedUrl: result.data?.signedUrl || null, mediaError: result.error?.message || null };
    }));
    setProfiles(people);
    setClips(signedRows);
  }, [session]);

  useEffect(() => { if (ready && session) load(); }, [ready, session, load]);

  const profileMap = useMemo(() => new Map(profiles.map(person => [person.id, person])), [profiles]);
  const shownClips = clips.filter(clip => filter === 'mine' ? clip.author_id === session?.user?.id : clip.status === 'approved');

  async function uploadClip(event) {
    event.preventDefault();
    if (!session?.user || !file) return;
    setUploading(true); setMessage('');
    let storagePath = null;
    try {
      if (!ACCEPTED.includes(file.type)) throw new Error('Only MP4 and WebM videos are accepted.');
      if (file.size > MAX_BYTES) throw new Error('Video must be 25 MB or smaller.');
      if (!caption.trim()) throw new Error('Add a caption before uploading.');
      const duration = await inspectVideo(file);
      const ext = file.type === 'video/webm' ? 'webm' : 'mp4';
      storagePath = `${session.user.id}/${crypto.randomUUID()}.${ext}`;
      const upload = await supabase.storage.from(BUCKET).upload(storagePath, file, {
        cacheControl: '3600', contentType: file.type, upsert: false
      });
      if (upload.error) throw upload.error;
      const insert = await supabase.from('social_clips').insert({
        author_id: session.user.id, storage_path: storagePath, caption: caption.trim(),
        game_code: gameCode, duration_seconds: Number(duration.toFixed(2)), status: 'pending'
      });
      if (insert.error) {
        await supabase.storage.from(BUCKET).remove([storagePath]);
        storagePath = null;
        throw insert.error;
      }
      setCaption(''); setFile(null); event.target.reset();
      setMessage('Clip uploaded privately and submitted for review. It will enter the public feed only after approval.');
      await load();
    } catch (error) {
      setMessage(error?.message || 'The clip could not be uploaded.');
    } finally { setUploading(false); }
  }

  async function deleteClip(clip) {
    if (!window.confirm('Delete this clip permanently?')) return;
    setUploading(true);
    const fileResult = await supabase.storage.from(BUCKET).remove([clip.storage_path]);
    if (fileResult.error) { setMessage(fileResult.error.message); setUploading(false); return; }
    const rowResult = await supabase.from('social_clips').delete().eq('id', clip.id);
    if (rowResult.error) setMessage(rowResult.error.message);
    else { setMessage('Your clip has been deleted.'); await load(); }
    setUploading(false);
  }

  if (!isSupabaseConfigured) return <main className="reels-page"><section className="reels-hero"><span>ROUTER / POV STUDIO</span><h1>PLAY IT.<br/><em>REPLAY IT.</em></h1><p>Connect the ROUTER community backend to access gameplay clips.</p></section></main>;
  if (!ready) return <main className="reels-page"><p>Loading POV Studio…</p></main>;
  if (!session) return <main className="reels-page"><section className="reels-hero"><span>ROUTER / POV STUDIO</span><h1>YOUR CLUTCH.<br/><em>YOUR STORY.</em></h1><p>Sign in to upload gameplay clips and discover approved community POVs.</p><Link className="button primary" to="/login">SIGN IN TO CONTINUE ↗</Link></section></main>;

  return <main className="reels-page">
    <section className="reels-hero"><span>ROUTER / GAMEPLAY MEDIA</span><h1>YOUR GAME.<br/><em>YOUR POV.</em></h1><p>Share the clutch, the strategy and the moments your squad will remember. Every upload stays private until it passes review.</p></section>
    <section className="reels-upload">
      <div className="reels-section-kicker">01 / UPLOAD YOUR GAMEPLAY</div>
      <form onSubmit={uploadClip}>
        <label className="reels-file-picker"><span>＋</span><strong>{file ? file.name : 'CHOOSE A GAMEPLAY VIDEO'}</strong><small>MP4 or WebM · up to 25 MB · up to 90 seconds</small><input type="file" accept="video/mp4,video/webm" onChange={e => setFile(e.target.files?.[0] || null)}/></label>
        {previewUrl && <video className="reels-upload-preview" src={previewUrl} controls muted playsInline/>}
        <label className="reels-caption-label">CAPTION<textarea value={caption} onChange={e => setCaption(e.target.value)} maxLength={500} placeholder="What happened in this clip? Add the context…" required/></label>
        <div className="reels-upload-footer"><select value={gameCode} onChange={e => setGameCode(e.target.value)} aria-label="Game"><option value="free_fire_max">Free Fire MAX</option><option value="other">Other gaming</option></select><span>{caption.length}/500</span><button className="button primary" disabled={uploading || !file || !caption.trim()}>{uploading ? 'UPLOADING…' : 'SUBMIT FOR REVIEW ↗'}</button></div>
      </form>
      <p className="reels-review-note">Uploads are private by default. Public playback is enabled only after moderator approval. Do not upload copyrighted music, other players’ private content or clips you do not have permission to share.</p>
    </section>
    <section className="reels-feed-section">
      <div className="reels-feed-heading"><div><span>02 / COMMUNITY POV</span><h2>WATCH THE MOMENTS.</h2></div><div className="reels-filters"><button className={filter === 'approved' ? 'active' : ''} onClick={() => setFilter('approved')}>COMMUNITY</button><button className={filter === 'mine' ? 'active' : ''} onClick={() => setFilter('mine')}>MY UPLOADS</button></div></div>
      {shownClips.length ? <div className="reels-grid">{shownClips.map(clip => {
        const author = profileMap.get(clip.author_id);
        const own = clip.author_id === session.user.id;
        return <article className="reel-card" key={clip.id}>
          {clip.signedUrl ? <video src={clip.signedUrl} controls playsInline preload="metadata"/> : <div className="reel-video-unavailable">Private media unavailable</div>}
          <div className="reel-card-body"><div className="reel-card-meta"><strong>{playerName(author)}</strong><span>{clip.game_code.replaceAll('_',' ').toUpperCase()}</span></div><p>{clip.caption}</p><small>{new Date(clip.created_at).toLocaleString()} · {Math.round(clip.duration_seconds)}s</small>
            {clip.status === 'pending' && <span className="reel-pending">PENDING REVIEW</span>}
            {clip.status === 'rejected' && <span className="reel-rejected">NOT APPROVED</span>}
            {own && <button className="reel-delete" disabled={uploading} onClick={() => deleteClip(clip)}>DELETE MY CLIP</button>}
            {clip.mediaError && <small>{clip.mediaError}</small>}
          </div>
        </article>;
      })}</div> : <div className="reels-empty"><span>R.</span><h2>{filter === 'mine' ? 'YOUR CLIPS WILL LIVE HERE.' : 'THE NEXT CLUTCH IS YOURS.'}</h2><p>{filter === 'mine' ? 'Your uploads and review status will appear here.' : 'Approved community gameplay clips will appear here. Upload yours to get started.'}</p></div>}
    </section>
    {message && <p className="reels-message" role="status">{message}</p>}
    <div className="reels-safety">Keep clips respectful and authentic. Never show account credentials, private chats, OTPs or personal information in gameplay recordings.</div>
  </main>;
}
