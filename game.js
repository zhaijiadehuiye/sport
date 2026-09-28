const canvas = document.getElementById('court');
const ctx = canvas.getContext('2d');
const playerScoreEl = document.getElementById('playerScore');
const opponentScoreEl = document.getElementById('opponentScore');
const rallyEl = document.getElementById('rallyLabel');
const roundEl = document.getElementById('roundNumber');
const statusEl = document.getElementById('gameStatus');
const energyBar = document.getElementById('energyBar');
const toast = document.getElementById('serveToast');
const hint = document.getElementById('courtHint');

const asset = (src) => { const img = new Image(); img.src = src; return img; };
const art = {
  court: asset('assets/background/court.png'),
  playerIdle: [1,2,3,4].map(n => asset(`assets/processed/player-idle/idle-${n}.png`)),
  playerSwing: [1,2,3,4].map(n => asset(`assets/processed/player-swing/attack-${n}.png`)),
  kits: { mint: [1,2,3,4].map(n => asset(`assets/processed/player-idle/idle-${n}.png`)), coral: [1,2,3,4].map(n => asset(`assets/processed/player-coral/idle-${n}.png`)), sky: [1,2,3,4].map(n => asset(`assets/processed/player-sky/idle-${n}.png`)) },
  opponentIdle: [1,2,3,4].map(n => asset(`assets/processed/opponent-idle/idle-${n}.png`)),
  shuttle: [1,2,3,4].map(n => asset(`assets/processed/shuttle/projectile-${n}.png`))
};
let W=900,H=510,dpr=1,last=0,raf;
let keys={};
let state={player:0,opponent:0,rally:0,round:1,playing:false,over:false,serveTimer:0,playerX:.22,aiX:.78,energy:32,kit:'mint',shuttle:{x:.35,y:.54,vx:.17,vy:-.62,side:'ai'},swing:0,aiSwing:0,clock:0};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function resize(){const r=canvas.getBoundingClientRect();dpr=Math.min(2,window.devicePixelRatio||1);W=r.width;H=r.height;canvas.width=W*dpr;canvas.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0)}
window.addEventListener('resize',resize); resize();
function ready(img){return img.complete&&img.naturalWidth>0}
function updateHud(){playerScoreEl.textContent=String(state.player).padStart(2,'0');opponentScoreEl.textContent=String(state.opponent).padStart(2,'0');roundEl.textContent=String(state.round).padStart(2,'0');rallyEl.textContent=state.over?(state.player>state.opponent?'YOU WIN':'NEXT ROUND'):state.playing?(state.rally?`RALLY ${String(state.rally).padStart(2,'0')}`:'READY?'):'READY?';energyBar.style.width=`${state.energy}%`}
function showToast(t){toast.textContent=t;toast.classList.remove('show');void toast.offsetWidth;toast.classList.add('show')}
function resetGame(){state={...state,player:0,opponent:0,rally:0,round:1,playing:false,over:false,serveTimer:0,playerX:.22,aiX:.78,energy:32,shuttle:{x:.35,y:.54,vx:.17,vy:-.62,side:'ai'},swing:0,aiSwing:0};statusEl.textContent='准备开球';hint.style.opacity='.92';updateHud();draw()}
function startGame(){if(state.over)resetGame();state.playing=true;state.serveTimer=1.1;statusEl.textContent='比赛进行中';showToast('你的发球');updateHud()}
function score(who){if(who==='player')state.player++;else state.opponent++;state.round++;state.rally=0;state.energy=32;state.shuttle={x:who==='player'?.72:.28,y:.53,vx:who==='player'?.18:-.18,vy:-.56,side:who==='player'?'player':'ai'};showToast(who==='player'?'POINT!':'OPPONENT POINT');if(state.player>=21||state.opponent>=21){state.over=true;state.playing=false;statusEl.textContent=state.player>state.opponent?'你赢了！':'再来一局';hint.style.opacity='.5'}updateHud()}
function swing(){if(!state.playing||state.over||state.serveTimer>0)return;state.swing=.42;const s=state.shuttle;if(s.side==='ai'&&s.x<.5&&Math.abs(s.x-state.playerX)<.18&&s.y>.24&&s.y<.75){const quality=1-Math.abs(s.x-state.playerX)/.18;s.side='player';s.vx=.34+.18*quality;s.vy=-(.55+.3*quality);state.rally++;state.energy=clamp(state.energy+13,0,100);showToast(quality>.72?'PERFECT!':'NICE HIT');updateHud()}}
function update(dt){state.clock+=dt;if(!state.playing)return;if(state.serveTimer>0){state.serveTimer-=dt;if(state.serveTimer<=0){state.shuttle={x:.34,y:.53,vx:.18,vy:-.64,side:'ai'};showToast('回球！')}return}state.swing=Math.max(0,state.swing-dt);state.aiSwing=Math.max(0,state.aiSwing-dt);state.playerX=clamp(state.playerX+(keys.ArrowRight||keys.d?dt*.7:0)-(keys.ArrowLeft||keys.a?dt*.7:0),.08,.43);const target=state.shuttle.side==='ai'?state.shuttle.x:.78;state.aiX=state.aiX+(clamp(target,.58,.92)-state.aiX)*dt*2.7;const s=state.shuttle;s.vy+=1.1*dt;s.x+=s.vx*dt;s.y+=s.vy*dt;if(s.side==='player'&&s.x>.63&&s.y<.58&&state.aiSwing<=0){state.aiSwing=.42;s.side='ai';s.vx=-(.29+Math.random()*.14);s.vy=-(.55+Math.random()*.3);state.rally++;state.energy=clamp(state.energy+8,0,100);updateHud()}if(s.y>.82)score(s.x<.5?'opponent':'player');if(s.x<.04||s.x>.96)score(s.x<.5?'opponent':'player')}
function drawBackground(){if(!ready(art.court))return;const iw=art.court.naturalWidth,ih=art.court.naturalHeight,scale=Math.max(W/iw,H/ih),dw=iw*scale,dh=ih*scale;ctx.drawImage(art.court,(W-dw)/2,(H-dh)/2,dw,dh)}
function frameFor(list,rate=7){return list[Math.floor(state.clock*rate)%list.length]}
function drawActor(list,x,base,scale=1.02,flip=false){const img=frameFor(list,6);if(!ready(img))return;const w=256*scale,h=256*scale;ctx.save();ctx.translate(x*W,base);ctx.scale(flip?-1:1,1);ctx.globalAlpha=.2;ctx.filter='blur(10px)';ctx.fillStyle='#214344';ctx.beginPath();ctx.ellipse(0,3,w*.22,8,0,0,Math.PI*2);ctx.fill();ctx.filter='none';ctx.globalAlpha=1;ctx.drawImage(img,-w/2,-h,w,h);ctx.restore()}
function drawShuttle(){const img=frameFor(art.shuttle,8);if(!ready(img))return;const s=state.shuttle,size=Math.min(72,W*.075);ctx.save();ctx.translate(s.x*W,H*(.63+s.y*.22));ctx.rotate(Math.atan2(s.vy,s.vx)-Math.PI/2);ctx.globalAlpha=.9;ctx.drawImage(img,-size/2,-size/2,size,size);ctx.restore()}
function draw(){ctx.clearRect(0,0,W,H);drawBackground();drawActor(state.swing>0?art.playerSwing:art.kits[state.kit],state.playerX,H*.9,state.swing>0?1.08:1.02,false);drawActor(art.opponentIdle,state.aiX,H*.9,1.02,true);drawShuttle()}
function loop(t){const dt=Math.min(.035,(t-last)/1000||0);last=t;update(dt);draw();raf=requestAnimationFrame(loop)}
window.addEventListener('keydown',e=>{keys[e.key]=true;if(e.code==='Space'){e.preventDefault();swing()}if(e.key==='Enter'&&!state.playing)startGame()});window.addEventListener('keyup',e=>keys[e.key]=false);
document.getElementById('playBtn').addEventListener('click',()=>{document.getElementById('game').scrollIntoView({behavior:'smooth'});startGame()});document.getElementById('restartBtn').addEventListener('click',resetGame);document.querySelectorAll('.swatch').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.swatch').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');state.kit=b.dataset.kit||'mint'}));document.querySelectorAll('.locked').forEach(b=>b.addEventListener('click',()=>showToast('即将开放')));document.getElementById('soundBtn').addEventListener('click',e=>{e.currentTarget.textContent=e.currentTarget.textContent==='◖)))'?'◖··':'◖)))'});resetGame();raf=requestAnimationFrame(loop);
