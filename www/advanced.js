/* ═══════════════════════════════════════════════════════════════════
   YULTO CARE — advanced tissue & analysis module
   Heatmaps, zone analysis, erythema map, biofilm score
   ═══════════════════════════════════════════════════════════════════ */
(function(){

  const TISSUE_COLORS = {
    granulation: [225, 29, 72, 140],   // red
    slough:      [234, 179, 8, 140],   // yellow
    necrosis:    [31, 41, 55, 160],    // black
    epithelial:  [249, 168, 212, 140], // pink
    other:       [203, 213, 225, 80],  // light gray
  };

  function classifyPixel(r, g, b){
    const lum = 0.299*r + 0.587*g + 0.114*b;
    if(lum < 55) return 'necrosis';
    if(r > 140 && g > 120 && b < 130 && Math.abs(r-g) < 50) return 'slough';
    if(r > 140 && g < r*0.75 && b < r*0.75) return 'granulation';
    if(r > 170 && g > 120 && b > 120) return 'epithelial';
    return 'other';
  }

  /* ─── Tissue heatmap overlay ───
     Returns a PNG blob with the wound area color-coded by tissue type. */
  window.buildTissueHeatmap = async function(canvas, mask, W, H){
    const data = canvas.getContext('2d').getImageData(0,0,W,H).data;
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const ctx = out.getContext('2d');
    const img = ctx.createImageData(W, H);
    for(let i = 0; i < W*H; i++){
      if(!mask[i]) continue;
      const r = data[i*4], g = data[i*4+1], b = data[i*4+2];
      const cls = classifyPixel(r,g,b);
      const c = TISSUE_COLORS[cls];
      img.data[i*4]   = c[0];
      img.data[i*4+1] = c[1];
      img.data[i*4+2] = c[2];
      img.data[i*4+3] = c[3];
    }
    ctx.putImageData(img, 0, 0);
    return new Promise(res => out.toBlob(res, 'image/png'));
  };

  /* ─── Zone analysis: center vs edge ───
     Erodes the mask to find the "center" region, and takes the ring
     between original and eroded mask as the "edge". */
  function erode(mask, W, H, iterations){
    let cur = mask;
    for(let k = 0; k < iterations; k++){
      const next = new Uint8Array(W*H);
      for(let y = 1; y < H-1; y++) for(let x = 1; x < W-1; x++){
        const i = y*W + x;
        if(cur[i] && cur[i-1] && cur[i+1] && cur[i-W] && cur[i+W]) next[i] = 1;
      }
      cur = next;
    }
    return cur;
  }

  window.computeZones = function(canvas, mask, W, H){
    const data = canvas.getContext('2d').getImageData(0,0,W,H).data;
    const erosionDepth = Math.max(3, Math.round(Math.sqrt(mask.reduce((a,b)=>a+b,0)) * 0.15));
    const center = erode(mask, W, H, erosionDepth);
    const centerCounts = {granulation:0, slough:0, necrosis:0, epithelial:0, other:0};
    const edgeCounts   = {granulation:0, slough:0, necrosis:0, epithelial:0, other:0};
    let centerTotal = 0, edgeTotal = 0;
    for(let i = 0; i < W*H; i++){
      if(!mask[i]) continue;
      const r = data[i*4], g = data[i*4+1], b = data[i*4+2];
      const cls = classifyPixel(r,g,b);
      if(center[i]){ centerCounts[cls]++; centerTotal++; }
      else          { edgeCounts[cls]++;   edgeTotal++;   }
    }
    const pct = (counts, total) => {
      const o = {};
      for(const k in counts) o[k] = +((counts[k] / (total||1)) * 100).toFixed(1);
      return o;
    };
    return {
      center: pct(centerCounts, centerTotal),
      edge:   pct(edgeCounts, edgeTotal),
      healingFromEdges: (edgeCounts.epithelial + edgeCounts.granulation) > (centerCounts.epithelial + centerCounts.granulation),
    };
  };

  /* ─── Erythema (redness) map ───
     Scans the periwound area (near the bbox, outside the wound) for
     red-pixel density. Returns a heatmap PNG + numeric score. */
  window.computeErythemaMap = function(canvas, mask, W, H){
    const data = canvas.getContext('2d').getImageData(0,0,W,H).data;
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const ctx = out.getContext('2d');
    const img = ctx.createImageData(W, H);
    let redPixels = 0, periwoundPixels = 0;
    for(let i = 0; i < W*H; i++){
      if(mask[i]) continue; // only look outside the wound
      const r = data[i*4], g = data[i*4+1], b = data[i*4+2];
      const redness = (r - (g+b)/2);
      if(redness > 20){
        redPixels++;
        img.data[i*4]   = 255;
        img.data[i*4+1] = 60;
        img.data[i*4+2] = 60;
        img.data[i*4+3] = Math.min(200, Math.round(redness * 2.5));
      }
      periwoundPixels++;
    }
    ctx.putImageData(img, 0, 0);
    const score = periwoundPixels ? redPixels / periwoundPixels : 0;
    return new Promise(res => {
      out.toBlob(blob => res({ blob, score: +score.toFixed(3), pixelCount: redPixels }), 'image/png');
    });
  };

  /* ─── Biofilm suspicion score ───
     Heuristic: high slough + high moisture + low granulation + high infection. */
  window.computeBiofilmScore = function(assessment){
    if(!assessment) return 0;
    const slough = (assessment.tissue?.slough || 0) / 100;
    const gran   = (assessment.tissue?.granulation || 0) / 100;
    const moist  = assessment.exudate === 'high' ? 1 : assessment.exudate === 'moderate' ? 0.6 : 0.3;
    const inf    = assessment.infection || 0;
    const score  = (slough * 0.5) + (moist * 0.2) + (inf * 0.2) + ((1 - gran) * 0.1);
    return +Math.min(1, score).toFixed(2);
  };

  /* ─── Tissue transition detection ───
     Compares the latest two assessments' tissue composition. */
  window.detectTissueTransition = function(assessments){
    if(!assessments || assessments.length < 2) return null;
    const a = assessments[assessments.length-2];
    const b = assessments[assessments.length-1];
    if(!a.tissue || !b.tissue) return null;
    const out = {};
    for(const k of ['granulation','slough','necrosis','epithelial']){
      const delta = (b.tissue[k] || 0) - (a.tissue[k] || 0);
      if(Math.abs(delta) >= 3){
        out[k] = { delta: +delta.toFixed(1), direction: delta > 0 ? 'up' : 'down' };
      }
    }
    // Human summary
    const parts = [];
    if(out.granulation?.direction === 'up') parts.push('granulation improving');
    if(out.granulation?.direction === 'down') parts.push('granulation decreasing');
    if(out.slough?.direction === 'down') parts.push('slough reducing');
    if(out.slough?.direction === 'up') parts.push('slough increasing');
    if(out.necrosis?.direction === 'up') parts.push('necrosis appearing');
    if(out.necrosis?.direction === 'down') parts.push('necrosis clearing');
    if(out.epithelial?.direction === 'up') parts.push('epithelialization advancing');
    return { changes: out, summary: parts.join(', ') || 'stable tissue composition' };
  };

  /* ─── Granulation/Slough ratio ─── */
  window.granulationSloughRatio = function(assessment){
    if(!assessment?.tissue) return null;
    const g = assessment.tissue.granulation || 0;
    const s = assessment.tissue.slough || 0;
    if(s === 0) return g > 0 ? Infinity : null;
    return +(g/s).toFixed(2);
  };

  window.YULTO_ADVANCED_READY = true;
  console.log('[yulto] advanced tissue module ready');
})();
