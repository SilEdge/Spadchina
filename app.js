(function(){
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
})();
