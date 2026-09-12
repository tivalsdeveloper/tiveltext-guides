const API='https://uuuqpbdvdtaoqyqwkcyf.supabase.co/functions/v1/audience';
const dialog=document.querySelector('#email-dialog');
const form=document.querySelector('#email-form');
const email=document.querySelector('#email');
const message=document.querySelector('#form-message');
const submit=document.querySelector('#submit-email');
const selectedGuide=document.querySelector('#selected-guide');
const formView=document.querySelector('#form-view');
const successView=document.querySelector('#success-view');
const backup=document.querySelector('#backup-download');
let currentGuide=null;

document.querySelectorAll('.download-trigger').forEach(button=>button.addEventListener('click',()=>{
  currentGuide=button.closest('.guide-card');
  selectedGuide.textContent=currentGuide.dataset.title;
  backup.href=currentGuide.dataset.file;
  formView.hidden=false;successView.hidden=true;message.textContent='';message.className='';
  dialog.showModal();setTimeout(()=>email.focus(),80);
}));

document.querySelector('.close').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close()});
document.querySelector('#choose-another').addEventListener('click',()=>dialog.close());

form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(!currentGuide)return;
  submit.disabled=true;submit.firstChild.textContent='Sending… ';
  message.textContent='';
  try{
    const response=await fetch(API,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'subscribe',email:email.value.trim(),guide:currentGuide.dataset.guide})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'We could not send the email. Please try again.');
    formView.hidden=true;successView.hidden=false;
  }catch(error){message.textContent=error.message==='Failed to fetch'?'Connection failed. Check your internet and try again.':error.message}
  finally{submit.disabled=false;submit.firstChild.textContent='Send my download '}
});

(async()=>{
  try{
    let visitorId=localStorage.getItem('tiveltext_visitor_id');
    if(!visitorId){visitorId=crypto.randomUUID();localStorage.setItem('tiveltext_visitor_id',visitorId)}
    const response=await fetch(API,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'visit',visitorId,path:location.pathname,referrer:document.referrer})});
    if(response.ok){const data=await response.json();if(data.visitorId)localStorage.setItem('tiveltext_visitor_id',data.visitorId)}
  }catch{}
})();
