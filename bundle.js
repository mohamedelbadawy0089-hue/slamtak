// سلامتك - Bundled JS - All utilities in one file

// Auth Guard System - يتحقق من auth-guard.js
if (typeof window.authGuard === 'undefined') {
    console.error('❌ Auth Guard غير مهيأ، جاري التحميل...');
    // تحميل auth-guard.js إذا لم يتم تحميله
    const script = document.createElement('script');
    script.src = 'auth-guard.js';
    script.onload = () => {
        console.log('✅ تم تحميل Auth Guard بنجاح في bundle.js');
    };
    document.head.appendChild(script);
}

// Utility Functions
function togglePassword(id){const input=document.getElementById(id);const btn=event.target;if(input.type==='password'){input.type='text';btn.textContent='إخفاء'}else{input.type='password';btn.textContent='إظهار'}}
function showCustomAlert(message,type='success'){const alert=document.createElement('div');alert.className=`alert alert-${type}`;alert.textContent=message;alert.style.cssText=`position:fixed;top:20px;right:20px;padding:15px 20px;border-radius:8px;z-index:1000;color:#fff;font-weight:bold;box-shadow:0 4px 12px rgba(0,0,0,0.15);background:${type==='success'?'#28a745':'#dc3545'};animation:slideIn .3s ease`;document.body.appendChild(alert);setTimeout(()=>{alert.style.animation='slideOut .3s ease';setTimeout(()=>document.body.removeChild(alert),300)},3000)}
function validateEmail(email){const re=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;return re.test(email)}
function validatePhone(phone){return phone.length===11&&/^\d+$/.test(phone)}
function prefetchLinks(){const links=document.querySelectorAll('a[href*="dashboard"], a[href*="المخازن"]');links.forEach(link=>{link.addEventListener('mouseenter',()=>{const prefetchLink=document.createElement('link');prefetchLink.rel='prefetch';prefetchLink.href=link.href;document.head.appendChild(prefetchLink)})})}
function initLazyLoading(){const images=document.querySelectorAll('img[data-src]');const imageObserver=new IntersectionObserver((entries,observer)=>{entries.forEach(entry=>{if(entry.isIntersecting){const img=entry.target;img.src=img.dataset.src;img.removeAttribute('data-src');observer.unobserve(img)}})});images.forEach(img=>imageObserver.observe(img))}
document.addEventListener('DOMContentLoaded',()=>{prefetchLinks();initLazyLoading()});
