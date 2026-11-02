// Font loader for CDN-hosted Arabic fonts
(function() {
  'use strict';

  // تحميل خط Cairo من Google Fonts
  const link = document.createElement('link');
  link.href = 'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap';
  link.rel = 'stylesheet';
  document.head.appendChild(link);

})();
