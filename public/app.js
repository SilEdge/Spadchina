(function(){
var SP=window.SP;
// Mobile navigation: replace the cramped horizontal link strip with an accessible menu.
document.querySelectorAll('header').forEach(function(header,index){
 var navs=header.querySelectorAll(':scope > nav');
 var menu=navs[navs.length-1];
 var row=header.querySelector(':scope > div');
 if(!menu||!row||row.querySelector('.mobile-menu-toggle'))return;
 var toggle=document.createElement('button');
 toggle.type='button';
 toggle.className='mobile-menu-toggle';
 toggle.setAttribute('aria-label','Открыть меню');
 toggle.setAttribute('aria-expanded','false');
 toggle.setAttribute('aria-controls','mobile-navigation-'+index);
 toggle.innerHTML='<span></span><span></span><span></span>';
 menu.id='mobile-navigation-'+index;
 menu.classList.add('mobile-menu-panel');
 menu.setAttribute('aria-label','Основная навигация');
 var login=row.querySelector('button');
 var actions=document.createElement('div');
 actions.className='mobile-header-actions';
 if(login){
  row.insertBefore(actions,login);
  actions.append(toggle,login);
 }else{
  row.append(actions);
  actions.appendChild(toggle);
 }
 var backdrop=document.createElement('button');
 backdrop.type='button';
 backdrop.className='mobile-menu-backdrop';
 backdrop.setAttribute('aria-label','Закрыть меню');
 backdrop.tabIndex=-1;
 function closeMenu(restoreFocus){
  header.classList.remove('mobile-menu-open');
  toggle.setAttribute('aria-expanded','false');
  toggle.setAttribute('aria-label','Открыть меню');
  backdrop.remove();
  if(restoreFocus)toggle.focus();
 }
 toggle.addEventListener('click',function(){
  var open=!header.classList.contains('mobile-menu-open');
  if(open){
   header.classList.add('mobile-menu-open');
   toggle.setAttribute('aria-expanded','true');
   toggle.setAttribute('aria-label','Закрыть меню');
   header.insertAdjacentElement('afterend',backdrop);
   var firstLink=menu.querySelector('a');
   if(firstLink)firstLink.focus({preventScroll:true});
  }else closeMenu(false);
 });
 backdrop.addEventListener('click',function(){closeMenu(false)});
 menu.addEventListener('click',function(event){if(event.target.closest('a'))closeMenu(false)});
 document.addEventListener('keydown',function(event){
  if(event.key==='Escape'&&header.classList.contains('mobile-menu-open'))closeMenu(true);
 });
 window.addEventListener('resize',function(){if(window.innerWidth>=1024)closeMenu(false)});
});
// Map
var el=document.getElementById('atlas-map');
if(el&&window.L){var b=[[51.3,23.15],[56.2,32.75]];
 var m=L.map(el,{zoomControl:false,scrollWheelZoom:false,minZoom:5,maxZoom:17,crs:L.CRS.EPSG3395});
 m.attributionControl.setPrefix(false);
 L.tileLayer('https://core-renderer-tiles.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale=1&lang=ru_RU',{attribution:'© <a href="https://yandex.ru/maps/">Яндекс Карты</a>',maxZoom:17}).addTo(m);
 L.geoJSON(SP.b,{style:{className:'atlas-boundary',weight:2,fillOpacity:0.05}}).addTo(m);
 SP.n.forEach(function(p){var c=SP.c[p.id];if(!c)return;
  L.marker(c,{icon:L.divIcon({className:'atlas-marker',html:'<span></span>',iconSize:[24,24],iconAnchor:[12,12]}),title:p.name}).bindTooltip(p.name,{direction:'top',offset:[0,-12]}).on('click',function(){location.href='place-'+p.id+'.html'}).addTo(m);});
 m.fitBounds(b,{padding:[18,18]});
 var btns=document.querySelectorAll('[aria-label="Приблизить"],[aria-label="Отдалить"],[aria-label="Вся Беларусь"]');
 btns.forEach(function(x){x.onclick=function(){var a=x.getAttribute('aria-label');a==='Приблизить'?m.zoomIn():a==='Отдалить'?m.zoomOut():m.fitBounds(b,{padding:[18,18]});};});
}
// Quiz
var qp=document.getElementById('quiz-q');
var id=(location.pathname.match(/place-([\w-]+)\.html/)||[])[1];
if(qp&&id&&SP.q[id]){var Q=SP.q[id],i=0,score=0,box=qp.nextElementSibling,tpl=box.querySelector('button').className;
 var dots=qp.previousElementSibling?qp.previousElementSibling.querySelectorAll('span'):[];
 var old=box.nextElementSibling;while(old){old.style.display='none';old=old.nextElementSibling;}var info=document.createElement('div');info.style.marginTop='1rem';box.after(info);
 function show(){qp.textContent=Q[i].q;box.innerHTML='';info.innerHTML='';
  dots.forEach(function(s,k){s.style.background=k<=i?'var(--primary)':'';});
  Q[i].a.forEach(function(t,k){var bt=document.createElement('button');bt.className=tpl;bt.textContent=t;bt.onclick=function(){pick(k)};box.appendChild(bt);});}
 function pick(k){var bs=box.querySelectorAll('button');bs.forEach(function(x,j){x.disabled=true;if(j===Q[i].ok){x.style.background='var(--primary)';x.style.color='var(--primary-foreground)';}else if(j===k){x.style.background='var(--destructive)';x.style.color='var(--background)';}});
  if(k===Q[i].ok)score++;
  var last=i===Q.length-1;
  info.innerHTML='<p style="margin-bottom:1rem">'+(k===Q[i].ok?'<b>Верно!</b> ':'<b>Неверно.</b> ')+Q[i].explanation+'</p>';
  var n=document.createElement('button');n.className=tpl;n.textContent=last?'Результат':'Дальше';
  n.onclick=function(){if(last){qp.textContent='Правильных ответов: '+score+' из '+Q.length;box.innerHTML='';info.innerHTML='';var r=document.createElement('button');r.className=tpl;r.textContent='Пройти заново';r.onclick=function(){i=0;score=0;show()};box.appendChild(r);}else{i++;show();}};
  info.appendChild(n);}
 show();}
})();
