function openModal(tab){
  document.getElementById('authOverlay').classList.add('open');
  switchTab(tab);
  document.body.style.overflow='hidden';
}
function closeModal(){
  document.getElementById('authOverlay').classList.remove('open');
  document.body.style.overflow='';
}
function overlayClick(e){
  if(e.target===document.getElementById('authOverlay')) closeModal();
}
function switchTab(tab){
  document.getElementById('t-login').classList.toggle('active',tab==='login');
  document.getElementById('t-signup').classList.toggle('active',tab==='signup');
  document.getElementById('f-login').classList.toggle('hidden',tab!=='login');
  document.getElementById('f-signup').classList.toggle('hidden',tab!=='signup');
}
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeModal(); });