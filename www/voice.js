/* ═══════════════════════════════════════════════════════════════════
   YULTO CARE — voice module
   Read-aloud + voice dictation
   ═══════════════════════════════════════════════════════════════════ */
(function(){
  const hasTTS = 'speechSynthesis' in window;
  const hasSR  = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  let currentUtterance = null;
  let recognition = null;

  function pickVoice(){
    const voices = speechSynthesis.getVoices();
    // Prefer a natural English voice if available
    return voices.find(v => /en-GB|en-US/.test(v.lang) && /Google|Samantha|Daniel/.test(v.name))
        || voices.find(v => v.lang.startsWith('en'))
        || voices[0];
  }
  if(hasTTS){
    speechSynthesis.onvoiceschanged = () => {};
    // Trigger load
    speechSynthesis.getVoices();
  }

  function speak(text, opts){
    if(!hasTTS){ toast('Read-aloud not available on this device'); return; }
    try{
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = pickVoice();
      u.rate = opts?.rate ?? 0.95;
      u.pitch = 1;
      u.volume = 1;
      u.onend = () => { currentUtterance = null; };
      u.onerror = () => { currentUtterance = null; };
      currentUtterance = u;
      speechSynthesis.speak(u);
    }catch(e){ toast('Voice error: '+e.message); }
  }
  function stopSpeaking(){ if(hasTTS) speechSynthesis.cancel(); currentUtterance = null; }

  /* ─── Read a full assessment aloud ─── */
  window.readAssessmentAloud = async function(assessment, patient, wound, forecast){
    if(!assessment){ toast('No assessment to read'); return; }
    const lines = [];
    lines.push('Wound assessment report.');
    lines.push(`Patient ${patient?.name || 'unknown'}.`);
    if(wound) lines.push(`Wound: ${wound.label}, ${(wound.type||'').replace(/_/g,' ')}, at ${wound.location || 'unspecified location'}.`);
    lines.push(`Assessment date: ${new Date(assessment.createdAt).toLocaleDateString()}.`);
    if(assessment.areaCm2) lines.push(`Area: ${assessment.areaCm2} square centimeters.`);
    if(assessment.perimeterCm) lines.push(`Perimeter: ${assessment.perimeterCm} centimeters.`);
    if(assessment.circularity) lines.push(`Circularity: ${(assessment.circularity*100).toFixed(0)} percent.`);
    if(assessment.infection != null) lines.push(`Infection risk: ${(assessment.infection*100).toFixed(0)} percent.`);
    if(assessment.healingIndex != null) lines.push(`Healing index: ${(assessment.healingIndex*100).toFixed(0)} percent.`);
    if(assessment.tissue){
      const parts = Object.entries(assessment.tissue).filter(([k,v])=>v>0).map(([k,v])=>`${v} percent ${k}`);
      if(parts.length) lines.push(`Tissue composition: ${parts.join(', ')}.`);
    }
    if(assessment.pain != null) lines.push(`Pain score: ${assessment.pain} out of 10.`);
    if(assessment.exudate) lines.push(`Exudate: ${assessment.exudate}.`);
    if(assessment.odor) lines.push(`Odor: ${assessment.odor}.`);
    if(assessment.periwound) lines.push(`Periwound skin: ${assessment.periwound}.`);
    if(assessment.underminingCm) lines.push(`Undermining: ${assessment.underminingCm} centimeters.`);
    if(assessment.tunnelingCm) lines.push(`Tunneling: ${assessment.tunnelingCm} centimeters.`);
    if(forecast){
      lines.push(`Expected healing: ${forecast.expectedDays} days.`);
      lines.push(`Range: ${forecast.optimisticDays} to ${forecast.pessimisticDays} days.`);
      lines.push(`Confidence: ${forecast.confidence}.`);
    }
    if(assessment.notes) lines.push(`Notes: ${assessment.notes}`);
    lines.push('End of report.');
    speak(lines.join(' '));
    toast('Reading aloud…');
  };

  /* ─── Read patient summary aloud ─── */
  window.readPatientAloud = async function(patient, wounds){
    const lines = [];
    lines.push(`Patient ${patient.name}.`);
    if(patient.mrn) lines.push(`Medical record number ${patient.mrn}.`);
    if(patient.dob) lines.push(`Date of birth ${patient.dob}.`);
    if(patient.sex) lines.push(`Sex: ${patient.sex}.`);
    const conds = [];
    if(patient.diabetes) conds.push(patient.hba1c ? `diabetes with HBA1C ${patient.hba1c}` : 'diabetes');
    if(patient.pvd) conds.push('peripheral vascular disease');
    if(patient.smoker) conds.push('smoker');
    if(conds.length) lines.push(`Comorbidities: ${conds.join(', ')}.`);
    if(patient.abi) lines.push(`Ankle brachial index: ${patient.abi}.`);
    if(patient.albumin) lines.push(`Albumin: ${patient.albumin}.`);
    if(wounds && wounds.length){
      lines.push(`${wounds.length} wound${wounds.length>1?'s':''} recorded.`);
      for(const w of wounds.slice(0,5)){
        lines.push(`${w.label}, ${w.status}.`);
      }
    }
    speak(lines.join(' '));
  };

  /* ─── Voice dictation for notes ─── */
  window.startDictation = function(targetEl){
    if(!hasSR){ toast('Voice input not available on this device'); return; }
    try{
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognition = new SR();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      let finalText = targetEl.value || '';
      recognition.onresult = (ev) => {
        let interim = '';
        for(let i = ev.resultIndex; i < ev.results.length; i++){
          const t = ev.results[i][0].transcript;
          if(ev.results[i].isFinal){ finalText += (finalText && !finalText.endsWith(' ')?' ':'') + t; }
          else interim += t;
        }
        targetEl.value = finalText + (interim?' '+interim:'');
      };
      recognition.onerror = (e) => { toast('Dictation error: '+e.error); stopDictation(); };
      recognition.onend = () => {};
      recognition.start();
      window._recTarget = targetEl;
      toast('Listening… tap again to stop');
    }catch(e){ toast('Could not start dictation: '+e.message); }
  };
  window.stopDictation = function(){
    if(recognition){ try{ recognition.stop(); }catch(e){} recognition = null; }
    window._recTarget = null;
  };
  window.toggleDictation = function(targetEl){
    if(recognition) stopDictation(); else startDictation(targetEl);
  };

  /* ─── Simple speak utility ─── */
  window.speak = speak;
  window.stopSpeaking = stopSpeaking;
  window.YULTO_VOICE_READY = true;
  console.log('[yulto] voice module ready. TTS:', hasTTS, 'SR:', hasSR);
})();
