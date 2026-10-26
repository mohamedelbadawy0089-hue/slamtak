/* 
   Sidebar Navigation System - Salamtak
   Provides a persistent navigation experience across all account types.
*/

(function() {
    'use strict';

    const sidebarHTML = `
        <div id="slamtakSidebar" class="slamtak-sidebar">
            <div class="sidebar-header">
                <div class="sidebar-logo">💊</div>
                <span class="sidebar-title">سلامتك</span>
                <button id="closeSidebar" class="sidebar-toggle-btn">×</button>
            </div>
            
            <nav class="sidebar-nav">
                <a href="dashboard.html" class="nav-item" id="navDashboard">
                    <span class="nav-icon">📊</span>
                    <span class="nav-text">لوحة التحكم</span>
                </a>
                <a href="products.html" class="nav-item" id="navProducts">
                    <span class="nav-icon">📦</span>
                    <span class="nav-text">المنتجات</span>
                </a>
                <a href="pharmacies.html" class="nav-item" id="navMyPharmacies">
                    <span class="nav-icon">🏥</span>
                    <span class="nav-text">الصيدليات المدخلة</span>
                </a>
                                <a href="orders.html" class="nav-item" id="navOrders">
                    <span class="nav-icon">📋</span>
                    <span class="nav-text">الأوردرات</span>
                </a>
                <a href="delivery.html" class="nav-item" id="navDelivery">
                    <span class="nav-icon">🚚</span>
                    <span class="nav-text">التوصيل</span>
                </a>
                <a href="general-directory.html" class="nav-item" id="navGeneralDirectory">
                    <span class="nav-icon">📖</span>
                    <span class="nav-text">الدليل العام (صيدليات)</span>
                </a>
                <a href="analytics.html" class="nav-item" id="navAnalytics">
                    <span class="nav-icon">📈</span>
                    <span class="nav-text">الإحصائيات</span>
                </a>
            </nav>
            
            <div class="sidebar-footer">
                <div class="user-profile-summary">
                    <div class="user-avatar">👤</div>
                    <div class="user-details">
                        <div class="user-name" id="sidebarUserName">...</div>
                        <div class="user-role" id="sidebarUserRole">...</div>
                    </div>
                </div>
                <button onclick="logout()" class="sidebar-logout-btn">🚪 خروج</button>
            </div>
        </div>
        <button id="openSidebar" class="sidebar-open-trigger">☰</button>
        <div id="sidebarOverlay" class="sidebar-overlay"></div>
    `;

    function initSidebar() {
        // Inject HTML
        document.body.insertAdjacentHTML('beforeend', sidebarHTML);
        
        // Load CSS
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'sidebar.css';
        document.head.appendChild(link);

        const sidebar = document.getElementById('slamtakSidebar');
        const overlay = document.getElementById('sidebarOverlay');
        const closeBtn = document.getElementById('closeSidebar');
        const openBtn = document.getElementById('openSidebar');

        // Toggle Logic
        openBtn.addEventListener('click', () => {
            sidebar.classList.add('open');
            overlay.classList.add('visible');
        });

        const closeSidebar = () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('visible');
        };

        closeBtn.addEventListener('click', closeSidebar);
        overlay.addEventListener('click', closeSidebar);

        // Active State Detection
        const currentPath = window.location.pathname.split('/').pop() || 'index.html';
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            if (item.getAttribute('href') === currentPath) {
                item.classList.add('active');
            }
        });

        // User Data
        const user = JSON.parse(sessionStorage.getItem('currentUser')) || 
                     JSON.parse(sessionStorage.getItem('sb-auth-token'))?.user;
        
        if (user) {
            document.getElementById('sidebarUserName').textContent = user.user_metadata?.warehouse_name || user.email?.split('@')[0] || 'مستخدم';
            document.getElementById('sidebarUserRole').textContent = user.user_metadata?.role || 'مسؤول';
        }
    }

    window.logout = function() {
        sessionStorage.clear();
        localStorage.removeItem('sb-auth-token');
        window.location.replace('login.html');
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSidebar);
    } else {
        initSidebar();
    }

})();
