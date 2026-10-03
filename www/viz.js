/* ═══════════════════════════════════════════════════════════════════
   YULTO CARE — visualization module
   Progression animation, multi-compare, enhancement, depth simulation
   ═══════════════════════════════════════════════════════════════════ */
(function(){

  /* ─── Progression animation ───
     Flips through every photo of a wound in order, ~1.2s per frame. */
  window.playProgression = function(images, containerEl){
    if(!images || images.length < 2){ toast('Need 2+ photos'); return; }
    containerEl.innerHTML = '';
    const img = document.createElement('img');
    img.style.width = '100%';
    img.style.borderRadius = '12px';
    containerEl.appendChild(img);
    const label = document.createElement('div');
    label.style.cssText = 'text-align:center;margin-top:8px;font-size:13px;color:var(--muted)';
    containerEl.appendChild(label);
    let i = 0;
    const tick = () => {
      const rec = images[i];
      img.src = rec.dataUrl || (rec.blob ? URL.createObjectURL(rec.blob) : '');
      label.textContent = `${i+1} / ${images.length} — ${new Date(rec.createdAt).toLocaleDateString()}`;
      i = (i + 1) % images.length;
    };
    tick();
    const timer = setInterval(tick, 1200);
    // Stop after one full loop + a bit
    setTimeout(() => { clearInterval(timer); label.textContent += ' — done'; }, images.length * 1200 + 300);
    window._progressionTimer = timer;
  };
  window.stopProgression = function(){
    if(window._progressionTimer){ clearInterval(window._progressionTimer); window._progressionTimer = null; }
  };

  /* ─── Multi-compare (up to 4 photos) ─── */
  window.buildMultiCompare = function(images){
    if(!images || images.length < 2) return null;
    const picks = [];
    const n = Math.min(4, images.length);
    if(n === 2){ picks.push(images[0], images[images.length-1]); }
    else {
      picks.push(images[0]);
      const step = (images.length - 1) / (n - 1);
      for(let i = 1; i < n-1; i++) picks.push(images[Math.round(i*step)]);
      picks.push(images[images.length-1]);
    }
    return picks;
  };

  /* ─── Photo enhancement ───
     Normalizes brightness and slight contrast. Returns a new blob. */
  window.enhancePhoto = async function(blobOrDataUrl){
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = rej;
      i.src = typeof blobOrDataUrl === 'string' ? blobOrDataUrl : URL.createObjectURL(blobOrDataUrl);
    });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    // Compute mean luminance
    let sum = 0;
    for(let i = 0; i < data.data.length; i += 4){
      sum += 0.299*data.data[i] + 0.587*data.data[i+1] + 0.114*data.data[i+2];
    }
    const mean = sum / (data.data.length / 4);
    const target = 140;
    const gain = Math.max(0.7, Math.min(1.5, target / Math.max(1, mean)));
    for(let i = 0; i < data.data.length; i += 4){
      data.data[i]   = Math.min(255, data.data[i]   * gain);
      data.data[i+1] = Math.min(255, data.data[i+1] * gain);
      data.data[i+2] = Math.min(255, data.data[i+2] * gain);
    }
    ctx.putImageData(data, 0, 0);
    return new Promise(res => c.toBlob(res, 'image/jpeg', 0.9));
  };

  /* ─── Pseudo-3D depth simulation ───
     Uses luminance as a fake height map, converts to shaded relief.
     Not real depth — visually communicates "this area looks deeper". */
  window.renderDepthSimulation = function(canvas, mask, W, H){
    const data = canvas.getContext('2d').getImageData(0,0,W,H).data;
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const ctx = out.getContext('2d');
    const img = ctx.createImageData(W, H);
    // Luminance
    const lum = new Float32Array(W*H);
    for(let i = 0; i < W*H; i++){
      lum[i] = 0.299*data[i*4] + 0.587*data[i*4+1] + 0.114*data[i*4+2];
    }
    // Simple shading: treat inverse luminance as depth, apply directional light
    const lightDir = [-0.5, -0.5];
    for(let y = 1; y < H-1; y++) for(let x = 1; x < W-1; x++){
      const i = y*W + x;
      if(!mask[i]) continue;
      const dzdx = (lum[i+1] - lum[i-1]) / 255;
      const dzdy = (lum[i+W] - lum[i-W]) / 255;
      const shade = Math.max(0, 1 + (dzdx*lightDir[0] + dzdy*lightDir[1]) * 3);
      const v = Math.round(180 * shade + 40);
      img.data[i*4]   = v;
      img.data[i*4+1] = Math.round(v * 0.9);
      img.data[i*4+2] = Math.round(v * 0.8);
      img.data[i*4+3] = 220;
    }
    ctx.putImageData(img, 0, 0);
    return out;
  };

  /* ─── Healing pace (2-week sliding window) ─── */
  window.healingPace = function(assessments){
    if(!assessments || assessments.length < 2) return null;
    const now = Date.now();
    const twoWeeksAgo = now - 14*24*60*60*1000;
    const recent = assessments.filter(a => a.createdAt >= twoWeeksAgo && a.areaCm2);
    if(recent.length < 2) return null;
    const first = recent[0], last = recent[recent.length-1];
    const days = (last.createdAt - first.createdAt) / (24*60*60*1000);
    const delta = first.areaCm2 - last.areaCm2;
    return {
      days: +days.toFixed(1),
      deltaCm2: +delta.toFixed(2),
      cm2PerWeek: +(delta / days * 7).toFixed(2),
      direction: delta > 0.1 ? 'improving' : delta < -0.1 ? 'worsening' : 'stable',
    };
  };

  window.YULTO_VIZ_READY = true;
  console.log('[yulto] viz module ready');
})();
