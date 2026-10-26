/**
 * HotPot — Global Multimedia Radar & Observatory
 * Core Application Controller (v2.6)
 */

document.addEventListener('DOMContentLoaded', () => {

    // ── Application State ───────────────────────────────────────────
    const state = {
        platform: 'bilibili',
        category: 'all',
        timeRange: 'all',
        searchQuery: '',
        metricMode: 'single', // 实时视频 / 官方话题 / 历史采集记录
        sortBy:'views',
        view: 'feed',         // 'feed' | 'globe'
        currentTopic: null,   // active topic in drilldown

        // Single Video Feed Data
        allVideos: [],
        displayedVideos: [],
        activeVideo: null,

        // Topic Feed Data
        topicsList: [],

        // Geo Radar Data
        geoHotspots: [],
        geoMetadata: null,

        // User Session
        user: null,

        // Infinite Scroll
        page: 1,
        pageSize: 30,
        remotePage: 1,
        remoteHasMore: false,
        nextCursor: '',
        requestSequence: 0,
        feedAbort: null,
        isLoading: false,
        hasMore: true
    };

    // ── DOM References ──────────────────────────────────────────────
    const dom = {
        // Navigation & Platforms
        navBtns: document.querySelectorAll('.nav-btn'),
        platformTitle: document.getElementById('platform-title'),
        platformStatusBadge: document.getElementById('platform-status-badge'),
        sidebarProxyDot: document.getElementById('sidebar-proxy-dot'),

        // Search & Metric Toggle
        searchInput: document.getElementById('search-input'),
        searchBtn: document.getElementById('search-btn'),
        searchClearBtn: document.getElementById('search-clear-btn'),
        btnMetricSingle: document.getElementById('btn-metric-single'),
        btnMetricTopic: document.getElementById('btn-metric-topic'),
        btnMetricCollected: document.getElementById('btn-metric-collected'),

        // Views & Layout
        viewSwitchBtns: document.querySelectorAll('.view-switch-btn'),
        refreshBtn: document.getElementById('refresh-btn'),
        categoryFiltersContainer: document.getElementById('category-filters-container'),
        filterChips: document.querySelectorAll('.filter-chip'),
        timeChips: document.querySelectorAll('.time-chip'),
        gridScrollArea: document.getElementById('grid-scroll-area'),
        cardsGrid: document.getElementById('cards-grid'),
        topicsGrid: document.getElementById('topics-grid'),

        // Topic Drilldown View
        topicDrilldownView: document.getElementById('topic-drilldown-view'),
        btnBackToTopics: document.getElementById('btn-back-to-topics'),
        drilldownTopicTag: document.getElementById('drilldown-topic-tag'),
        drilldownTopicTitle: document.getElementById('drilldown-topic-title'),
        drilldownTopicMeta: document.getElementById('drilldown-topic-meta'),
        drilldownCardsGrid: document.getElementById('drilldown-cards-grid'),

        // Globe Radar
        globeView: document.getElementById('globe-view'),
        globeStage: document.getElementById('globe-stage'),
        globeEmpty: document.getElementById('globe-empty'),
        hotspotList: document.getElementById('hotspot-list'),
        geoCityCount: document.getElementById('geo-city-count'),
        geoVideoCount: document.getElementById('geo-video-count'),
        geoCoverage: document.getElementById('geo-coverage'),

        // States
        loader: document.getElementById('loader'),
        emptyState: document.getElementById('empty-state'),
        infiniteLoader: document.getElementById('infinite-loader'),
        endHint: document.getElementById('end-hint'),
        endHintText: document.getElementById('end-hint-text'),

        // Detail Drawer
        detailDrawer: document.getElementById('detail-drawer'),
        closeDrawerBtn: document.getElementById('close-drawer-btn'),
        drawerPlayerWrapper: document.getElementById('video-player-wrapper'),
        drawerDanmakuScreen: document.getElementById('drawer-danmaku-screen'),
        drawerDanmakuToggle: document.getElementById('drawer-danmaku-toggle'),
        drawerDanmakuInput: document.getElementById('drawer-danmaku-input'),
        drawerDanmakuSend: document.getElementById('drawer-danmaku-send'),
        drawerPlatformBadge: document.getElementById('drawer-platform-badge'),
        drawerOpenOriginBtn: document.getElementById('drawer-open-origin-btn'),
        drawerVideoTitle: document.getElementById('drawer-video-title'),
        drawerAuthorAvatar: document.getElementById('drawer-author-avatar'),
        drawerAuthorName: document.getElementById('drawer-author-name'),
        btnCopyLink: document.getElementById('btn-copy-link'),
        btnParseStream: document.getElementById('btn-parse-stream'),
        btnDownloadVideo: document.getElementById('btn-download-video'),
        streamUrlBox: document.getElementById('stream-url-box'),
        streamUrlInput: document.getElementById('stream-url-input'),
        btnCopyStream: document.getElementById('btn-copy-stream'),
        aiCategoryBadge: document.getElementById('ai-category-badge'),
        aiHighlightsList: document.getElementById('ai-highlights-list'),
        aiRecommendationText: document.getElementById('ai-recommendation-text'),

        // Popup Player Modal
        playerModal: document.getElementById('player-modal'),
        closePlayerModalBtn: document.getElementById('close-player-modal-btn'),
        modalPlatformBadge: document.getElementById('modal-platform-badge'),
        modalVideoTitle: document.getElementById('modal-video-title'),
        modalOpenOriginBtn: document.getElementById('modal-open-origin-btn'),
        modalVideoWrapper: document.getElementById('modal-video-wrapper'),
        modalDanmakuScreen: document.getElementById('modal-danmaku-screen'),
        modalDanmakuToggle: document.getElementById('modal-danmaku-toggle'),
        modalDanmakuInput: document.getElementById('modal-danmaku-input'),
        modalDanmakuSend: document.getElementById('modal-danmaku-send'),
        modalDanmakuCount: document.getElementById('modal-danmaku-count'),
        modalVideoAuthor: document.getElementById('modal-video-author'),
        modalVideoPlayCount: document.getElementById('modal-video-play-count'),
        modalCopyLinkBtn: document.getElementById('modal-copy-link-btn'),
        modalSniffBtn: document.getElementById('modal-sniff-btn'),
        modalDownloadBtn: document.getElementById('modal-download-btn'),

        // Galaxy Downloader Workbench DOM
        mediatoolsView: document.getElementById('mediatools-view'),
        btnNavMediatools: document.getElementById('btn-nav-mediatools'),
        mtInputUrl: document.getElementById('mt-input-url'),
        mtPasteBtn: document.getElementById('mt-paste-btn'),
        mtClearBtn: document.getElementById('mt-clear-btn'),
        mtExtractBtn: document.getElementById('mt-extract-btn'),
        mtLoadingState: document.getElementById('mt-loading-state'),
        mtLoadingStep: document.getElementById('mt-loading-step'),
        mtErrorBox: document.getElementById('mt-error-box'),
        mtErrorMsg: document.getElementById('mt-error-msg'),
        mtResultsContainer: document.getElementById('mt-results-container'),
        mtPanelVideo: document.getElementById('mt-panel-video'),
        mtResPlatform: document.getElementById('mt-res-platform'),
        mtResTitle: document.getElementById('mt-res-title'),
        mtResAuthor: document.getElementById('mt-res-author'),
        mtResDuration: document.getElementById('mt-res-duration'),
        mtResOriginLink: document.getElementById('mt-res-origin-link'),
        mtBtnCloseResult: document.getElementById('mt-btn-close-result'),
        mtNativeVideo: document.getElementById('mt-native-video'),
        mtPagesWrapper: document.getElementById('mt-pages-wrapper'),
        mtPagesCount: document.getElementById('mt-pages-count'),
        mtPagesList: document.getElementById('mt-pages-list'),
        mtBtnDownloadMp4: document.getElementById('mt-btn-download-mp4'),
        mtBtnDownloadMp3: document.getElementById('mt-btn-download-mp3'),
        mtBtnCopyStream: document.getElementById('mt-btn-copy-stream'),
        mtPanelImage: document.getElementById('mt-panel-image'),
        mtImgTitle: document.getElementById('mt-img-title'),
        mtImgCount: document.getElementById('mt-img-count'),
        mtBtnDownloadAllZip: document.getElementById('mt-btn-download-all-zip'),
        mtBtnDownloadBgm: document.getElementById('mt-btn-download-bgm'),
        mtImageGallery: document.getElementById('mt-image-gallery'),
        mtPanelAudio: document.getElementById('mt-panel-audio'),
        mtAudioTitle: document.getElementById('mt-audio-title'),
        mtNativeAudio: document.getElementById('mt-native-audio'),
        mtBtnDownloadAudioFile: document.getElementById('mt-btn-download-audio-file'),
        mtHistoryCount: document.getElementById('mt-history-count'),
        mtBtnClearHistory: document.getElementById('mt-btn-clear-history'),
        mtHistoryList: document.getElementById('mt-history-list'),
        mtTodayTotalCount: document.getElementById('mt-today-total-count'),
        mtTodayPlatforms: document.getElementById('mt-today-platforms'),
        mtLightboxModal: document.getElementById('mt-lightbox-modal'),
        mtLightboxClose: document.getElementById('mt-lightbox-close'),
        mtLightboxImg: document.getElementById('mt-lightbox-img'),
        mtLightboxTitle: document.getElementById('mt-lightbox-title'),
        mtLightboxDownload: document.getElementById('mt-lightbox-download'),


        // User Center Dropdown & Modals
        userCenterWrapper: document.getElementById('user-center-wrapper'),
        userCenterDropdown: document.getElementById('user-center-dropdown'),
        dropdownUserAvatar: document.getElementById('dropdown-user-avatar'),
        dropdownNickname: document.getElementById('dropdown-nickname'),
        dropdownRoleBadge: document.getElementById('dropdown-role-badge'),
        dropdownQuotaBadge: document.getElementById('dropdown-quota-badge'),
        dropdownQuotaCount: document.getElementById('dropdown-quota-count'),
        menuBtnProfile: document.getElementById('menu-btn-profile'),
        menuBtnBenefits: document.getElementById('menu-btn-benefits'),
        menuBtnHistory: document.getElementById('menu-btn-history'),
        menuBtnSettings: document.getElementById('menu-btn-settings'),
        menuBtnSwitchRole: document.getElementById('menu-btn-switch-role'),
        menuBtnLogout: document.getElementById('menu-btn-logout'),

        // Profile Modal
        profileModal: document.getElementById('profile-modal'),
        closeProfileModalBtn: document.getElementById('close-profile-modal-btn'),
        profileUserAvatar: document.getElementById('profile-user-avatar'),
        profileNickname: document.getElementById('profile-nickname'),
        profileRoleBadge: document.getElementById('profile-role-badge'),
        profileUsername: document.getElementById('profile-username'),
        profileRegDate: document.getElementById('profile-reg-date'),
        profileQuotaDisplay: document.getElementById('profile-quota-display'),
        profileQuotaBar: document.getElementById('profile-quota-bar'),
        btnProfileToBenefits: document.getElementById('btn-profile-to-benefits'),

        // Benefits Modal
        benefitsModal: document.getElementById('benefits-modal'),
        closeBenefitsModalBtn: document.getElementById('close-benefits-modal-btn'),

        // Settings Tabs & Language Grid
        settingsTabBtns: document.querySelectorAll('.settings-tab-btn'),
        setContentLanguage: document.getElementById('set-content-language'),
        setContentProxy: document.getElementById('set-content-proxy'),
        langCards: document.querySelectorAll('.lang-card'),

        // Downloader Dual Tabs & Transcript / AI
        mtTabBtns: document.querySelectorAll('.mt-tab-btn'),
        mtPanelTranscript: document.getElementById('mt-panel-transcript'),
        mtPanelAi: document.getElementById('mt-panel-ai'),
        mtTranscriptCount: document.getElementById('mt-transcript-count'),
        mtBtnCopyTranscript: document.getElementById('mt-btn-copy-transcript'),
        mtBtnExportTxt: document.getElementById('mt-btn-export-txt'),
        mtBtnExportSrt: document.getElementById('mt-btn-export-srt'),
        mtTranscriptTimeline: document.getElementById('mt-transcript-timeline'),
        mtAiCategory: document.getElementById('mt-ai-category'),
        mtAiAudience: document.getElementById('mt-ai-audience'),
        mtAiTrigger: document.getElementById('mt-ai-trigger'),
        mtAiHooks: document.getElementById('mt-ai-hooks'),
        mtAiStoryboard: document.getElementById('mt-ai-storyboard'),
        mtAiRecommendations: document.getElementById('mt-ai-recommendations'),

        // User Identity & Header Bar
        userIdentityCard: document.getElementById('user-identity-card'),
        userLoggedInBox: document.getElementById('user-logged-in-box'),
        userAvatar: document.getElementById('user-avatar'),
        userNickname: document.getElementById('user-nickname'),
        userRoleBadge: document.getElementById('user-role-badge'),
        userLoginTrigger: document.getElementById('user-login-trigger'),
        openLoginBtn: document.getElementById('open-login-btn'),

        // Settings Modal & Preferences
        settingsBtn: document.getElementById('settings-btn'),
        settingsModal: document.getElementById('settings-modal'),
        closeModalBtn: document.getElementById('close-modal-btn'),
        btnSaveSettings: document.getElementById('btn-save-settings'),
        settingProxy: document.getElementById('setting-proxy'),
        proxyStatus: document.getElementById('proxy-status'),
        proxyPills: document.querySelectorAll('.proxy-pill-btn, .proxy-pill'),

        // Auth & Role Switching Modal
        authModal: document.getElementById('auth-modal'),
        closeAuthModalBtn: document.getElementById('close-auth-modal-btn'),
        authTabs: document.querySelectorAll('.auth-tab, .auth-tab-btn'),
        loginForm: document.getElementById('login-form'),
        loginUsername: document.getElementById('login-username'),
        loginPassword: document.getElementById('login-password'),
        loginMsgBox: document.getElementById('login-msg-box'),
        registerForm: document.getElementById('register-form'),
        regUsername: document.getElementById('reg-username'),
        regNickname: document.getElementById('reg-nickname'),
        regPassword: document.getElementById('reg-password'),
        regMsgBox: document.getElementById('reg-msg-box'),
        authLogoutBtn: document.getElementById('auth-logout-btn'),

        // Toast Container
        toastContainer: document.getElementById('toast-container')
    };

    const PLATFORM_CONFIG = {
        bilibili:    { name: '哔哩哔哩', color: '#fb7299', glow: 'rgba(251,114,153,0.3)', badge: '官方榜单 / 高播放检索' },
        douyin:      { name: '抖音热点', color: '#22d3ee', glow: 'rgba(34,211,238,0.3)', badge: '热点视频榜 + 公开精选 · 播放未公开' },
        youtube:     { name: 'YouTube', color: '#ff0033', glow: 'rgba(255,0,51,0.3)', badge: 'innertube 公开检索 · 实际观看计数' },
        tiktok:      { name: 'TikTok', color: '#00f2fe', glow: 'rgba(0,242,254,0.3)', badge: '公开发现 · 详情页实际播放计数' },
        twitter:     { name: 'Twitter / X', color: '#38bdf8', glow: 'rgba(56,189,248,0.3)', badge: '公开账号视频 · 官方匿名播放统计' },
        xiaohongshu: { name: '小红书', color: '#ff2442', glow: 'rgba(255,36,66,0.3)', badge: '免登录公开推荐 · 未公开播放不入榜' },
        kuaishou:    { name: '快手热门', color: '#ff5000', glow: 'rgba(255,80,0,0.3)', badge: '官网精彩短视频 · 实际播放量' }
    };

    // ── High Performance Danmaku Engine (Authentic Multi-platform Parser) ──
    class DanmakuEngine {
        constructor() {
            this.active = true;
            this.timers = [];
            this.currentDanmakus = [];
            this.danmakuIndex = 0;
        }

        async start(containerEl, video, countBadgeEl) {
            this.stop();
            if (!containerEl) return;
            containerEl.innerHTML = '';
            this.currentDanmakus = [];
            this.danmakuIndex = 0;

            const targetId = video?.id || '';
            const targetPlatform = video?.platform || state.platform || '';

            try {
                const res = await fetch(`/api/danmaku?bvid=${encodeURIComponent(targetId)}&id=${encodeURIComponent(targetId)}&platform=${encodeURIComponent(targetPlatform)}`);
                const data = await res.json();
                if (data.success && Array.isArray(data.list) && data.list.length > 0) {
                    this.currentDanmakus = data.list;
                    if (countBadgeEl) {
                        countBadgeEl.textContent = `已载入 ${data.list.length} 条全网真实弹幕`;
                    }
                    if (dom.modalDanmakuCount) {
                        dom.modalDanmakuCount.textContent = `已载入 ${data.list.length} 条真实弹幕`;
                    }
                } else {
                    if (countBadgeEl) {
                        countBadgeEl.textContent = '暂无实时弹幕 · 支持下方发送互动';
                    }
                    if (dom.modalDanmakuCount) {
                        dom.modalDanmakuCount.textContent = '暂无实时弹幕 · 支持发送';
                    }
                }
            } catch (e) {
                console.warn('[Danmaku Engine] Fetch error:', e);
                if (countBadgeEl) countBadgeEl.textContent = '暂无实时弹幕 · 支持下方发送互动';
            }

            if (this.currentDanmakus.length > 0) {
                // Continuous streaming of authentic danmaku
                const intervalId = setInterval(() => {
                    if (!this.active || document.hidden || this.currentDanmakus.length === 0) return;
                    const item = this.currentDanmakus[this.danmakuIndex % this.currentDanmakus.length];
                    this.danmakuIndex++;
                    this.emit(containerEl, item.text, false, item.color);
                }, 1400);
                this.timers.push(intervalId);

                // Pre-emit immediate floating real danmakus
                // 预发射定时器也纳入this.timers，弹窗关闭(stop)时一并清理。
                this.timers.push(setTimeout(() => this.emit(containerEl, this.currentDanmakus[0]?.text, false, this.currentDanmakus[0]?.color), 150));
                if (this.currentDanmakus.length > 1) {
                    this.timers.push(setTimeout(() => this.emit(containerEl, this.currentDanmakus[1]?.text, false, this.currentDanmakus[1]?.color), 600));
                }
            }
        }

        emit(containerEl, text, isUser = false, customColor = null) {
            if (!containerEl || !text) return;
            const el = document.createElement('div');
            el.className = `danmaku-item ${isUser ? 'is-user' : ''}`;
            el.textContent = text;

            if (customColor && !isUser) {
                el.style.color = customColor;
                el.style.textShadow = `0 0 8px ${customColor}80, 0 1px 3px rgba(0,0,0,0.9)`;
            }

            const topPercent = Math.floor(Math.random() * 65) + 10;
            el.style.top = `${topPercent}%`;

            const duration = Math.floor(Math.random() * 3) + (isUser ? 6 : 7);
            el.style.animationDuration = `${duration}s`;

            if (!isUser && !customColor) {
                const styles = ['hot', 'cool', 'glow', ''];
                const chosen = styles[Math.floor(Math.random() * styles.length)];
                if (chosen) el.classList.add(chosen);
            }

            containerEl.appendChild(el);
            setTimeout(() => {
                if (el.parentNode === containerEl) {
                    containerEl.removeChild(el);
                }
            }, duration * 1000 + 500);
        }

        toggle(containerEl, btnEl) {
            this.active = !this.active;
            if (btnEl) {
                btnEl.classList.toggle('active', this.active);
                btnEl.innerHTML = `<i class="fa-solid fa-comment-dots"></i> <span>弹幕 ${this.active ? '开' : '关'}</span>`;
            }
            if (containerEl) {
                containerEl.style.display = this.active ? 'block' : 'none';
            }
        }

        stop() {
            this.timers.forEach(t => clearInterval(t));
            this.timers = [];
        }
    }

    const danmakuEngine = new DanmakuEngine();

    const scriptLoads=new Map();
    function loadOptionalScript(src) {
        if(!scriptLoads.has(src)) scriptLoads.set(src,new Promise((resolve,reject)=>{
            const script=document.createElement('script'); script.src=src;
            script.onload=()=>{if(src.includes('globe.gl') && typeof window.Globe!=='function')script.onerror();else resolve();};
            script.onerror=()=>{
                scriptLoads.delete(src);
                script.remove();
                if(src.includes('globe.gl')) {
                    const fallback=document.createElement('script');
                    fallback.src='https://unpkg.com/globe.gl@2.46.1/dist/globe.gl.min.js';
                    fallback.onload=()=>{if(typeof window.Globe==='function')resolve();else fallback.onerror();};
                    fallback.onerror=()=>{
                        scriptLoads.delete(src);
                        fallback.remove();
                        reject(new Error('组件加载失败，请重试'));
                    };
                    document.head.appendChild(fallback);
                } else {
                    reject(new Error('组件加载失败，请重试'));
                }
            };
            document.head.appendChild(script);
        }));
        return scriptLoads.get(src);
    }

    // ── 3D Globe Radar Controller (Optimized WebGL, Static View, 4-Tier Colors) ─
    class GlobeRadarController {
        constructor() {
            this.globe = null;
            this.isInitialized = false;
            this.resizeHandler = null;
            this.cityCatalog=[];
            this.hotspots=[];
            this.countries=[];
            this.countryNames=new Intl.DisplayNames(['zh-CN'],{type:'region'});
            this.initializing=false;
        }

        async init(containerEl) {
            if (!containerEl || this.isInitialized || this.initializing) return;
            this.initializing=true;
            const overlay=document.getElementById('globe-empty');
            overlay?.classList.remove('hidden');

            try {
                if(!window.Globe) await loadOptionalScript('/vendor/globe.gl.min.js');
                this.globe = new Globe(containerEl,{animateIn:false})
                    .globeImageUrl('/vendor/earth-blue-marble.jpg')
                    .bumpImageUrl('/vendor/earth-topology.png')
                    .backgroundImageUrl('/vendor/night-sky.png')
                    .backgroundColor('rgba(3, 5, 9, 0)')
                    .showAtmosphere(true)
                    .atmosphereColor('#38bdf8')
                    .atmosphereAltitude(0.20)
                    .pointLat('lat')
                    .pointLng('lng')
                    .pointColor(d => d.color || (d.tier === 'high' ? '#ff2442' : (d.tier === 'medium' ? '#f59e0b' : (d.tier === 'normal' ? '#10b981' : '#06b6d4'))))
                    .pointAltitude(d => d.tier === 'high' ? 0.35 : (d.tier === 'medium' ? 0.22 : (d.tier === 'normal' ? 0.12 : 0.06)))
                    .pointRadius(d => d.radius || 0.35)
                    .pointResolution(12)
                    .pointsTransitionDuration(0)
                    .pointLabel(d => `
                        <div style="background: rgba(14,18,28,0.96); border: 1px solid ${d.color || '#38bdf8'}; border-radius: 8px; padding: 8px 12px; color: #fff; font-family: Outfit, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,0.6);">
                            <div style="font-weight: 700; font-size: 13px; color: ${d.color || '#38bdf8'};">${escapeHtml(d.city)} · ${escapeHtml(d.country)}</div>
                            <div style="font-size: 11px; color: #94a3b8; margin-top: 3px;">关联作品: ${d.countDisplay || d.count + '条'}</div>
                            <div style="font-size: 10.5px; color: #4ade80;">当前样本中的地名关联，非作者所在地</div>
                        </div>
                    `)
                    .onPointClick((point) => {
                        this.focusCity(point.lat, point.lng);
                    })
                    .htmlLat('lat').htmlLng('lng').htmlAltitude(0.000005)
                    .htmlElement(d=>{
                        const button=document.createElement('button'); button.className=d.kind==='country'?'geo-country-label':'geo-city-label'+(d.count?' has-samples':'');
                        button.textContent=d.city+(d.count?' · '+d.count:'');
                        button.dataset.lat=d.lat; button.dataset.lng=d.lng;
                        button.title=d.kind==='country'?'国家/地区地理参考 · '+d.city:d.count?d.city+'：'+d.count+'条真实样本关联':'地理参考城市，不代表有视频';
                        button.addEventListener('click',()=>this.focusCity(d.lat,d.lng));
                        return button;
                    })
                    // CSS2DRenderer会重写display；用visibility才能真正遮住背面标签。
                    .htmlElementVisibilityModifier((element,visible)=>{
                        if(visible && element.classList.contains('geo-country-label')) {
                            const pov=this.globe.pointOfView(),rad=Math.PI/180,a=Number(element.dataset.lat)*rad,b=pov.lat*rad;
                            visible=Math.sin(a)*Math.sin(b)+Math.cos(a)*Math.cos(b)*Math.cos((Number(element.dataset.lng)-pov.lng)*rad)>0.45;
                        }
                        element.style.visibility=visible?'visible':'hidden';element.setAttribute('aria-hidden',String(!visible));
                    })
                    .polygonAltitude(0.003)
                    .polygonCapColor(d=>this.countryColor(d))
                    .polygonSideColor(()=> 'rgba(0,0,0,0)')
                    .polygonStrokeColor(()=> 'rgba(205,221,242,0.25)')
                    .polygonLabel(d=>escapeHtml(this.countryName(d)))
                    .polygonsTransitionDuration(0)
                    .onZoom(()=>this.updateLabels());

                // Set camera altitude (Center on China / East Asia initially)
                this.globe.pointOfView({ lat: 31.2, lng: 115.5, altitude: 2.1 });

                // Disable auto rotation per user directive
                const controls = this.globe.controls();
                if (controls) {
                    controls.autoRotate = false;
                    controls.enableDamping = true;
                    controls.dampingFactor = 0.08;
                    // The old camera near plane stopped the map at regional detail.
                    const camera=this.globe.camera(),radius=this.globe.getGlobeRadius();
                    camera.near=0.05;
                    camera.updateProjectionMatrix();
                    controls.minDistance=radius*1.00002;
                    controls.zoomSpeed=0.8;
                }

                // Debounced Resize Observer
                this.resizeHandler = () => {
                    if (this.globe && containerEl.clientWidth > 0 && containerEl.clientHeight > 0) {
                        this.globe.width(containerEl.clientWidth);
                        this.globe.height(containerEl.clientHeight);
                    }
                };
                window.addEventListener('resize', this.resizeHandler);
                this.resizeObserver=new ResizeObserver(this.resizeHandler);
                this.resizeObserver.observe(containerEl);

                this.isInitialized = true;
                window.__testGlobe = this.globe;
                this.resizeHandler();
                this.updatePoints(this.hotspots);
                this.loadCountries();
                this.setBasemap(document.getElementById('geo-basemap')?.value || 'satellite_hd');
                if (state.view !== 'globe') this.globe.pauseAnimation();
            } catch (err) {
                this.resizeObserver?.disconnect();
                if(this.resizeHandler)window.removeEventListener('resize',this.resizeHandler);
                this.globe?._destructor?.();this.globe=null;containerEl.replaceChildren();
                console.error('[Globe] Initialization failed:', err);
                showToast('地球组件未能初始化，右侧仍可查看实际城市统计：'+err.message,'error');
            } finally {
                this.initializing=false;
                overlay?.classList.add('hidden');
            }
        }

        updatePoints(hotspots) {
            this.hotspots=hotspots || [];
            if (!this.globe) return;
            this.globe.pointsData(this.hotspots);
            this.updateLabels(true);
        }

        updateLabels(force=false) {
            if(!this.globe)return;
            const altitude=Math.max(0.00002,this.globe.pointOfView().altitude);
            const band=Math.floor(Math.log2(altitude));
            if(force || this.detailBand!==band) {
                this.detailBand=band;
                // A tiny near plane at global scale causes severe country/surface z-fighting.
                // Tighten it only near the ground; preserve the normal depth precision in overview.
                const camera=this.globe.camera();
                camera.near=Math.max(0.001,Math.min(0.05,altitude*this.globe.getGlobeRadius()*0.1));
                camera.updateProjectionMatrix();
                this.globe.pointRadius(d=>(d.radius || 0.35)*Math.min(1,Math.max(0.0002,altitude*0.4)))
                    .pointAltitude(d=>(d.tier==='high'?0.35:d.tier==='medium'?0.22:d.tier==='normal'?0.12:0.06)*Math.min(1,altitude*0.6));
            }
            // Coarse country geometry must not float over close-up road tiles.
            const countryVisible=altitude>=0.12 && document.getElementById('geo-countries')?.checked!==false;
            if(force || this.countryVisible!==countryVisible) {
                this.countryVisible=countryVisible;
                this.globe.polygonsData(countryVisible?this.countries:[]);
            }
            const distance=altitude>1.5?5:altitude<0.12?0.5:2;
            const labelKey=distance+':'+(altitude<0.005);
            if(!force && this.labelDistance===labelKey)return;
            this.labelDistance=labelKey;
            const byCity=new Map(this.hotspots.map(d=>[d.city,d]));
            const countryLabels=altitude<0.12 || document.getElementById('geo-countries')?.checked===false?[]:this.countries.filter(d=>Number(d.properties.LABELRANK)<= (distance===5?3:5)).map(d=>({kind:'country',city:this.countryName(d),lat:Number(d.properties.LABEL_Y),lng:Number(d.properties.LABEL_X)})).filter(d=>Number.isFinite(d.lat) && Number.isFinite(d.lng));
            const rows=[...this.hotspots,...(altitude<0.005?[]:this.cityCatalog.filter(d=>!byCity.has(d.city))),...countryLabels];
            const kept=[];
            for(const row of rows) if(!kept.some(d=>Math.abs(d.lat-row.lat)<distance && Math.abs(d.lng-row.lng)<distance && d.kind===row.kind))kept.push(row);
            this.globe.htmlElementsData(kept);
        }

        countryColor(feature) {
            const colors=['163,196,239','180,213,178','231,194,158','198,182,228','161,213,211','227,175,191','211,211,157','159,194,208','205,183,159','175,190,225','194,215,194','226,189,211','204,201,231'];
            return 'rgba('+colors[Math.max(0,Number(feature.properties.MAPCOLOR13)-1)%colors.length]+',0.16)';
        }

        countryName(feature) {
            const code=feature.properties.ISO_A2;
            return /^[A-Z]{2}$/.test(code)?this.countryNames.of(code):(feature.properties.NAME_ZH || feature.properties.ADMIN);
        }

        async loadCountries() {
            try {
                const response=await fetch('/vendor/countries.geojson',{signal:AbortSignal.timeout(10000)});
                if(!response.ok)throw new Error('国家边界数据不可读取');
                const data=await response.json();
                this.countries=(data.features || []).filter(d=>d.geometry && d.properties);
                this.updateCountries();
            } catch(error) { showToast('国家分色图层不可用，保留城市热点：'+error.message,'info'); }
        }

        updateCountries() {
            if(!this.globe)return;
            this.updateLabels(true);
        }

        async setBasemap(mode) {
            if(!this.globe)return;
            const status=document.getElementById('geo-map-status'), attribution=document.getElementById('geo-attribution');
            if(!status) return;
            const sequence=this.mapSequence=(this.mapSequence || 0)+1;
            const source=mode==='satellite_hd'?{name:'遥感影像',url:(x,y,z)=>`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,credit:'<a href="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer" target="_blank" rel="noopener">影像：Esri及数据提供方 · 来源与使用条款</a>'}
                :mode==='streets'?{name:'街道地图',url:(x,y,z)=>`https://tile.openstreetmap.org/${z}/${x}/${y}.png`,credit:'<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>'}:null;
            this.globe.globeTileEngineUrl(null);
            attribution?.classList.add('hidden');
            if(!source){this.limitLocalZoom();status.textContent='本地静态卫星概览 · 不依赖外部瓦片 · 细节请手动切换街道或遥感';return;}
            status.textContent='正在检测'+source.name+'… 连接期间保留本地底图';
            const fail=()=>{
                if(sequence!==this.mapSequence)return;
                this.mapSequence++;
                this.globe.globeTileEngineUrl(null);
                this.limitLocalZoom();
                document.getElementById('geo-basemap').value='satellite';
                attribution?.classList.add('hidden');
                status.textContent=source.name+'瓦片连接失败，已回退本地卫星概览；可重新选择重试';
            };
            const probe=async url=>{
                try {
                    const response=await fetch(url,{mode:'cors',signal:AbortSignal.timeout(5000)});
                    if(!response.ok || !/^image\//i.test(response.headers.get('content-type') || '')){await response.body?.cancel();return false;}
                    return (await response.blob()).size>0;
                } catch {return false;}
            };
            const pov=this.globe.pointOfView(),z=Math.min(19,Math.max(0,Math.ceil(Math.log2(8/Math.max(0.00002,pov.altitude))))),n=2**z;
            const lat=Math.max(-85.051128,Math.min(85.051128,pov.lat))*Math.PI/180;
            const x=Math.max(0,Math.min(n-1,Math.floor((pov.lng+180)/360*n))),y=Math.max(0,Math.min(n-1,Math.floor((1-Math.asinh(Math.tan(lat))/Math.PI)/2*n)));
            if(!await probe(source.url(x,y,z))){fail();return;}
            if(sequence!==this.mapSequence)return;
            this.globe.controls().minDistance=this.globe.getGlobeRadius()*1.00002;
            if(attribution){attribution.innerHTML=source.credit;attribution.classList.remove('hidden');}
            let checkedLevel=z;
            this.globe.globeTileEngineMaxLevel(19).globeTileEngineUrl((tx,ty,tz)=>{
                const url=source.url(tx,ty,tz);
                // Check one tile already requested by the viewport, not a prefetch of unseen areas.
                if(tz!==checkedLevel){checkedLevel=tz;probe(url).then(okay=>{if(!okay)fail();});}
                return url;
            });
            status.textContent=source.name+' · 最高19级（实际清晰度依数据覆盖） · 仅当前视角按需加载';
        }

        focusCity(lat, lng) {
            if (!this.globe) return;
            const basemap = document.getElementById('geo-basemap')?.value || 'satellite_hd';
            const isTileMap = ['satellite_hd', 'streets_hd', 'dark_matter', 'streets'].includes(basemap);
            this.globe.pointOfView({ lat, lng, altitude: isTileMap ? 0.012 : 1.2 }, 1000);
        }

        limitLocalZoom() {
            this.globe.controls().minDistance=this.globe.getGlobeRadius()*1.4;
            const pov=this.globe.pointOfView();
            if(pov.altitude<0.4)this.globe.pointOfView({...pov,altitude:0.6},400);
        }

        zoom(factor) {
            if(!this.globe)return;
            const pov=this.globe.pointOfView();
            const min=document.getElementById('geo-basemap')?.value==='satellite'?0.4:0.00002;
            this.globe.pointOfView({...pov,altitude:Math.max(min,Math.min(4,pov.altitude*factor))},300);
        }

        resetView() {
            this.globe?.pointOfView({lat:31.2,lng:115.5,altitude:2.1},600);
        }

        destroy() {
            this.mapSequence=(this.mapSequence || 0)+1;
            this.resizeObserver?.disconnect();
            if (this.resizeHandler) {
                window.removeEventListener('resize', this.resizeHandler);
            }
            this.isInitialized = false;
        }
    }

    const globeRadar = new GlobeRadarController();

    // ── Network & API Layer ─────────────────────────────────────────
    async function readApi(url, options = {}) {
        const response = await fetch(url, options);
        const data = await response.json();
        if (response.status === 401) { setUserSession(null); dom.authModal?.classList.remove('hidden'); }
        if (!response.ok || data.success === false) throw new Error(data.message || data.error || '数据源暂不可用');
        return data;
    }

    function feedParams() {
        return new URLSearchParams({ platform: state.platform, category: state.category, timeRange: state.timeRange, query: state.searchQuery, sort:state.sortBy, final: '1' });
    }

    function feedEndpoint() {
        return state.metricMode === 'topic' ? '/api/topics?' : state.metricMode === 'collected' ? '/api/collected-videos?'
            : state.searchQuery ? '/api/search?' : '/api/trends?';
    }

    function showVideoQuality(quality) {
        if (!quality) return;
        const isLikesPlatform = state.sortBy==='likes';
        const label = quality.status === 'empty' ? '本次筛选无视频'
            : isLikesPlatform ? (quality.withLikes?'公开点赞榜 · 非播放榜':'视频可见 · 点赞未取得')
            : !quality.withViews ? '视频可见 · 播放量未取得'
            : quality.status === 'cached' ? '历史快照 · 非实时'
            : quality.withoutViews ? '部分作品有真实播放量' : '真实视频与播放量';
        if (dom.platformStatusBadge) dom.platformStatusBadge.textContent = label;
        const subtitle = document.querySelector('.nav-btn[data-platform="' + state.platform + '"] .nav-btn-sub');
        if (subtitle) {
            subtitle.textContent = isLikesPlatform
                ? `${quality.videos}件视频 · ${quality.withLikes || 0}件有真实点赞`
                : `${quality.videos}件视频 · ${quality.withViews}件有播放量`;
        }
    }

    async function fetchTopicVideosApi(topic) {
        const params = feedParams();
        params.set('query', topic.title);
        return readApi('/api/search-topic?' + params);
    }

    async function fetchGeoRadarApi(signal) {
        const params=feedParams(); params.set('scope',document.getElementById('geo-scope')?.value || 'available');
        return readApi('/api/geo-hotspots?' + params,{signal});
    }

    function showSourceCoverage(result, mode = state.metricMode) {
        const scope = document.getElementById('ranking-scope');
        if (scope) {
            const hasOnlyLikes = state.sortBy==='likes';
            const sortLabel = hasOnlyLikes ? '按公开点赞降序（不是播放榜）' : '按真实播放量降序';
            const label = result.scope?.label || '已获取作品';
            const sortPart = ' · ' + sortLabel;
            const shown=state.allVideos.length?state.allVideos:(result.list || []),summary=VideoRanking.summary(shown,state.sortBy);
            const prefix=hasOnlyLikes?'like':'view',rounded=shown.filter(v=>v[prefix+'Precision']==='source-rounded').length,bounded=shown.filter(v=>v[prefix+'Precision']==='lower-bound').length;
            scope.textContent = mode === 'topic' ? '平台官方实时话题排名 · 不是视频播放榜 · 发布时效用于关联视频'
                : label + sortPart + ' · '+summary.ranked+'/'+shown.length+'件可排名' + (rounded?' · '+rounded+'件为平台缩写，排序近似':'') + (bounded?' · '+bounded+'件仅公开下界，不排名':'') + (hasOnlyLikes ? ' · 未取得点赞不参与名次' : ' · 未取得播放量不参与名次') + ' · 仅已采集样本，非全站历史总榜';
        }
        const details = document.getElementById('source-details');
        const content = document.getElementById('source-details-content');
        if (details) details.classList.toggle('hidden', !result.coverage);
        if (content && result.coverage) {
            const c = result.coverage;
            if (mode === 'collected') {
                const collectedTime = value => value ? new Date(value).toLocaleString('zh-CN') : '尚无记录';
                content.textContent = `本机此平台保存 ${Number(c.candidates)} 件作品，当前筛选 ${Number(c.unique)} 件；其中有播放量 ${Number(c.knownViews)} 件、未公开 ${Number(c.unknownViews)} 件。首次采集 ${collectedTime(c.earliestCollectedAt)}，最近采集 ${collectedTime(c.latestCollectedAt)}。每平台最多保留 ${Number(c.capacity)} 件，超限淘汰最久未采集的记录；不是全站覆盖率。分类按采集时分区或标题标签匹配，时效按作品原始发布日期。${c.recoveredFromBackup ? '当前索引由上一份备份恢复，最近一批记录可能缺失。' : ''}`;
                return;
            }
            content.innerHTML = `<p>收到 ${Number(c.candidates || 0)} 条候选，${c.retainedCandidates?'另保留 '+Number(c.retainedCandidates)+' 条30分钟内真实采集缓存（未改写采集时间），':''}合并去重并筛选后 ${Number(c.unique || 0)} 条。${c.detailsVerified != null ? '首屏详情再次核验 ' + Number(c.detailsVerified) + ' 条，未能再次核验 ' + Number(c.detailsFailed || 0) + ' 条。' : ''}${result.hasMore ? '继续滚动可获取更多搜索页。' : '本批数据源已读取完毕。'}排名仅适用于已获取作品。</p>`
                + youtubeProxyHint(result.metricEnrichment)
                + (c.sources || []).map(source => `<div class="source-check ${source.status === 'failed' ? 'source-check-failed' : ''}">${source.status === 'failed' ? '失败' : '已读取'} · ${escapeHtml(source.name)} · ${Number(source.count || 0)} 条${source.message ? ' · ' + escapeHtml(source.message) : ''}</div>`).join('');
        }
    }

    // YouTube 指标依赖代理。未配置代理时会静默拿不到播放量，
    // 用户容易误以为"平台不公开"，这里如实说明是本地配置缺失。
    function youtubeProxyHint(metricEnrichment) {
        if (!metricEnrichment) return '';
        if (metricEnrichment.proxyConfigured === false) {
            return `<div class="source-check source-check-failed">未配置 MEDIA_PROXY：YouTube 指标走直连，若网络无法访问则播放量为空。这是本地配置问题，不是平台未公开。</div>`;
        }
        if (metricEnrichment.lastFetchState === 'fetch-failed') {
            return `<div class="source-check source-check-failed">YouTube 指标抓取失败（网络或代理异常），未取得播放量；这不代表平台隐藏了播放量。</div>`;
        }
        return '';
    }

    async function loadData(reset = true, forceRefresh = false) {
        if(!reset && state.isLoading) return;
        document.getElementById('ranking-metric').disabled=state.metricMode==='topic';
        state.refreshAttempts=reset?0:(state.refreshAttempts || 0)+1;
        const visibleCount=reset?30:Math.max(30,state.displayedVideos.length);
        const sequence = ++state.requestSequence;
        state.feedAbort?.abort();
        state.feedAbort = new AbortController();
        state.isLoading = true;
        if(reset) {
            state.feedRefreshing=false;
            state.page = 1;
            state.remotePage = 1;
            state.remoteHasMore = false;
            state.nextCursor = '';
            state.hasMore = true;
            state.allVideos = [];
            state.displayedVideos = [];
            state.topicsList = [];
            state.currentTopic = null;
        }
        if(reset) { state.geoHotspots = []; globeRadar.updatePoints([]); }
        dom.loader.classList.toggle('hidden',!reset);
        dom.emptyState.classList.add('hidden');
        document.getElementById('btn-empty-topics')?.classList.add('hidden');
        if(reset) { dom.cardsGrid.classList.add('hidden'); dom.topicsGrid.classList.add('hidden'); }
        dom.topicDrilldownView.classList.add('hidden');
        dom.endHint.classList.add('hidden');
        dom.refreshBtn.classList.add('is-loading');
        dom.infiniteLoader.classList.add('hidden');
        document.getElementById('btn-load-more')?.classList.add('hidden');
        document.getElementById('ranking-scope').textContent = '正在核验当前筛选的数据来源…';
        if(reset)document.getElementById('source-details').classList.add('hidden');
        const params = feedParams();
        params.set('refresh', forceRefresh ? '1' : '0');
        const mode = state.metricMode;
        const endpoint = feedEndpoint();
        try {
            const result = await readApi(endpoint + params, { signal: state.feedAbort.signal });
            if (sequence !== state.requestSequence) return;
            let list = result.list || [];
            state.feedRefreshing=Boolean(result.refreshing);
            if(!reset && state.remotePage>1 && mode!=='topic') {
                // Updating the first batch must not discard pages already loaded by scrolling.
                const byId=new Map(state.allVideos.map(v=>[v.normPlatform+':'+v.id,v]));
                for(const video of list)byId.set(video.normPlatform+':'+video.id,video);
                list=[...byId.values()].sort((a,b)=>VideoRanking.compare(a,b,state.sortBy));
            }
            if (mode === 'single') showVideoQuality(result.dataQuality);
            const status = document.getElementById('source-status');
            if (status) status.textContent = (result.historical ? '历史采集 · ' : result.stale?'真实采集快照 · ':'') + (result.sourceMessage || '') + (result.dataQuality ? ` · 当前${result.dataQuality.videos}件视频，${result.dataQuality.withViews}件有真实播放量，${result.dataQuality.withoutViews}件未取得播放量` : '') + (result.partial ? '（部分接口暂不可用，仅显示已验证样本）' : '') + (result.fetchedAt ? ' · 采集 ' + new Date(result.fetchedAt).toLocaleString('zh-CN') : '') + (result.collection?.status === 'write-failed' ? ' · ' + result.collection.message : '');
            showSourceCoverage(result, mode);
            if (!list.length && !(mode!=='topic' && result.hasMore)) {
                state.hasMore=false;
                dom.emptyState.classList.remove('hidden');
                dom.emptyState.querySelector('p').textContent = result.message || '当前筛选条件下没有可验证的数据，可扩大时效或切换分类。';
                return;
            }
            if (mode === 'topic') {
                state.topicsList = list;
                renderTopicLeaderboard(list, dom.topicsGrid);
                dom.topicsGrid.classList.remove('hidden');
                dom.endHint.classList.remove('hidden');
            } else {
                state.allVideos = list;
                if(reset || state.remotePage===1) {
                    state.remoteHasMore = Boolean(result.hasMore);
                    state.nextCursor = result.nextCursor || '';
                }
                state.pageSize = getResponsivePageSize();
                const displayed=list.slice(0, visibleCount);
                if(reset || JSON.stringify(displayed)!==JSON.stringify(state.displayedVideos))renderVideoCards(displayed, dom.cardsGrid);
                state.displayedVideos = displayed;
                dom.cardsGrid.classList.remove('hidden');
                state.hasMore = list.length > state.displayedVideos.length || state.remoteHasMore;
                dom.endHint.classList.toggle('hidden', state.hasMore || state.feedRefreshing);
            }
            if (state.view === 'globe') loadGeoHotspots(sequence);
            document.getElementById('btn-load-more')?.classList.toggle('hidden',mode==='topic' || !state.hasMore);
        } catch (error) {
            if (error.name === 'AbortError' || sequence !== state.requestSequence) return;
            dom.emptyState.classList.remove('hidden');
            dom.emptyState.querySelector('p').textContent = error.message;
            document.getElementById('btn-empty-topics')?.classList.toggle('hidden', state.platform !== 'douyin' || mode !== 'single');
            const status = document.getElementById('source-status');
            if (status) status.textContent = '数据源暂不可用';
            document.getElementById('ranking-scope').textContent = '未取得真实数据 · 不显示替代榜单';
        } finally {
            if (sequence === state.requestSequence) {
                state.isLoading = false;
                dom.loader.classList.add('hidden');
                dom.refreshBtn.classList.remove('is-loading');
            }
        }
    }

    // ── Metric Mode 1: Single Video Feed ────────────────────────────

    function getSafeCoverUrl(video) {
        if (!video || !video.cover || typeof video.cover !== 'string' || video.cover.trim().length === 0) {
            return '/cover-placeholder.svg';
        }
        let cov = video.cover.trim();
        if (cov.startsWith('//')) cov = 'https:' + cov;

        const covLower = cov.toLowerCase();
        // Route restricted CDNs through proxy-image to bypass referrer/hotlink blocks
        if (
            covLower.includes('douyin') ||
            covLower.includes('tiktokcdn') ||
            covLower.includes('ibytedtos') ||
            covLower.includes('byteimg') ||
            covLower.includes('tos-cn-p-') ||
            covLower.includes('p26-sign') ||
            covLower.includes('p3-sign') ||
            covLower.includes('p11-sign') ||
            covLower.includes('p5-ex') ||
            covLower.includes('hdslb.com') ||
            covLower.includes('xhscdn.com') ||
            covLower.includes('kwaicdn.com') ||
            covLower.includes('yximgs.com')
        ) {
            return `/api/proxy-image?url=${encodeURIComponent(cov)}`;
        }
        return cov;
    }


    function metricText(video,kind) {
        const prefix={views:'view',likes:'like',comments:'comment',shares:'share',collects:'collect'}[kind];
        const value=video[{views:'playRaw',likes:'likeRaw',comments:'commentCount',shares:'shareCount',collects:'collectCount'}[kind]];
        const original=video[prefix+'CountText'] || '',text=/^no views$/i.test(original)?'0':original.replace(/\s*(?:views?|likes?|comments?|shares?|次播放|次观看|播放|观看|点赞|评论|分享|收藏|赞)$/i,'');
        if(video[prefix+'Precision']==='lower-bound')return (text || video[prefix+'LowerBound']+'+')+'（仅下界）';
        if(value==null)return '未取得';
        if(video[prefix+'Precision']==='estimated')return '≈'+formatHeat(value);
        return (video[prefix+'Precision']==='source-rounded'?'约 ':'')+(text || formatHeat(value));
    }

    function renderVideoCards(videos, containerEl, append = false, rankOffset = 0) {
        const existing=new Map([...containerEl.querySelectorAll('.video-card')].map(card=>[card.dataset.videoKey,card]));
        const fragment = document.createDocumentFragment();

        videos.forEach((video, index) => {
            const rank = rankOffset + index + 1;
            const rankClass = rank === 1 ? 'top-1' : (rank === 2 ? 'top-2' : (rank === 3 ? 'top-3' : ''));
            const rankIcon = rank === 1 ? '👑 #1' : (rank === 2 ? '🥈 #2' : (rank === 3 ? '🥉 #3' : `#${rank}`));

            const hasPlay = video.playRaw != null;
            const hasLikes = video.likeRaw != null;
            const ranked = VideoRanking.count(video,state.sortBy)!==null;
            const key=(video.normPlatform || video.platform || state.platform)+':'+video.id;
            const signature=JSON.stringify([state.sortBy,video]);
            const previous=existing.get(key);
            if(previous?.dataset.renderSignature===signature) {
                const badge=previous.querySelector('.card-rank');
                badge.textContent=ranked?rankIcon:(video[(state.sortBy==='likes'?'like':'view')+'Precision']==='lower-bound'?'仅下界 · 未排名':state.sortBy==='likes'?'未入点赞榜':'未入播放榜');
                badge.className='card-rank '+(ranked?rankClass:'');
                fragment.appendChild(previous);return;
            }
            const card=document.createElement('div');card.className='video-card';
            card.dataset.videoId=video.id;card.dataset.videoKey=key;card.dataset.renderSignature=signature;

            let metricType = 'unknown';
            let metricLabel = '未公开';
            let metricIcon = 'fa-circle-question';
            let displayMetric = '未公开';
            let statTooltip = '';
            let secondaryMetricHtml = '';

            if (state.sortBy!=='likes' && hasPlay) {
                metricType = 'views';
                metricLabel = video.viewPrecision === 'estimated' ? '播放(预估)' : '播放';
                metricIcon = 'fa-play';
                displayMetric = metricText(video,'views');
                statTooltip = video.viewPrecision === 'estimated'
                    ? '≈' + Number(video.playRaw).toLocaleString('zh-CN') + ' 预估播放（平台不公开匿名播放计数，按真实点赞×互动率基准推算，非平台数据，仅供排序参考）'
                    : (video.viewPrecision === 'source-rounded' ? '约 ' : '') + Number(video.playRaw).toLocaleString('zh-CN') + ' 真实播放'
                    + (video.viewPrecision==='unverified'?'（原始精度待核验）':'')
                    + (video.partsCount > 1 ? '（作品所有分P累计）' : '') + ' · ' + (video.viewSource || video.source || '平台公开数据')
                    + ((video.viewsFetchedAt || video.fetchedAt) ? ' · 观测 ' + new Date(video.viewsFetchedAt || video.fetchedAt).toLocaleString('zh-CN') : '');
                if (video.likeRaw != null || video.likeLowerBound!=null) {
                    secondaryMetricHtml = `<div class="card-secondary-metric"><i class="fa-regular fa-heart"></i> ${escapeHtml(metricText(video,'likes'))} 点赞 · 辅助参考</div>`;
                }
            } else if (state.sortBy==='likes' && hasLikes) {
                metricType = 'likes';
                metricLabel = '点赞';
                metricIcon = 'fa-heart';
                displayMetric = metricText(video,'likes');
                statTooltip = displayMetric + ' 公开点赞 · 当前为点赞榜，不是播放榜'
                    + ' · ' + (video.likeSource || video.source || '平台公开数据')
                    + ((video.likesFetchedAt || video.fetchedAt) ? ' · 观测 ' + new Date(video.likesFetchedAt || video.fetchedAt).toLocaleString('zh-CN') : '');
                secondaryMetricHtml = `<div class="card-secondary-metric">${hasPlay?escapeHtml(metricText(video,'views'))+' 播放':'播放量未取得'} · 点赞不等于播放量</div>`;
            } else {
                metricLabel=state.sortBy==='likes'?'点赞':'播放';
                displayMetric=metricText(video,state.sortBy);
                statTooltip = '本次数据未提供当前排行指标，不参与名次';
                if(state.sortBy==='views') {
                    const reasons={'placeholder-zero':'原站返回零占位，不能当作真实零播放',
                        'aggregate-interactions':'原站此数为点赞、收藏与评论合计，已拒绝作为播放量',
                        'unverified-schema':'原站结构化计数尚无独立播放证据，未用于排名',
                        'identity-mismatch':'计数作品编号不匹配，未用于排名','not-provided':'已核对原站详情，未提供可核验播放量',
                        'note-not-video':'该笔记为图文内容，不是视频，没有播放量指标',
                        'not-checked':'尚未核验该作品详情，播放量未知（不是零播放）'};
                    if(reasons[video.viewEvidence?.status])statTooltip=reasons[video.viewEvidence.status]+' · 不参与播放排名';
                }
                if((hasLikes || video.likeLowerBound!=null) && state.sortBy==='views')secondaryMetricHtml=`<div class="card-secondary-metric">${escapeHtml(metricText(video,'likes'))} 点赞 · 辅助指标，不用于播放排名</div>`;
            }

            const rankBadgeTitle = state.sortBy==='views' && hasPlay
                ? '当前已获取作品内真实播放量排名'
                : (state.sortBy==='likes' && hasLikes ? '当前已获取作品内公开点赞排名' : '缺少当前指标，未参与排名');
            const rankBadgeText = ranked ? rankIcon : video[(state.sortBy==='likes'?'like':'view')+'Precision']==='lower-bound'?'仅下界 · 未排名':state.sortBy==='likes'?'未入点赞榜':'未入播放榜';
            const coverUrl = getSafeCoverUrl(video);

            card.innerHTML = `
                <div class="card-thumbnail-wrapper">
                    <img class="card-thumbnail" src="${escapeHtml(coverUrl)}" alt="${escapeHtml(video.title)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='/cover-placeholder.svg'">
                    <span class="card-rank ${ranked?rankClass:''}" title="${escapeHtml(rankBadgeTitle)}">${rankBadgeText}</span>
                    <span class="card-duration">${escapeHtml(video.duration || 'Shorts')}</span>
                    <div class="card-play-btn">
                        <div class="card-play-btn-inner"><i class="fa-solid fa-play"></i></div>
                    </div>
                </div>

                <div class="card-details">
                    <h3 class="card-title" title="${escapeHtml(video.title)}">${escapeHtml(video.title)}</h3>
                    <div class="card-published">
                        <i class="fa-regular fa-clock"></i>
                            <span>${video.datePrecision === 'relative' ? '约 ' : ''}${formatPublishDate(video.pubdate)}${video.partsCount > 1 ? ' · ' + Number(video.partsCount) + 'P作品' : ''}</span>
                    </div>
                    <div class="card-footer">
                        <span class="card-author" title="${escapeHtml(video.author || '达人')}">
                            <i class="fa-solid fa-circle-user"></i> ${escapeHtml(video.author || '达人')}
                        </span>
                        <div class="card-stats" title="${escapeHtml(statTooltip)}">
                            <i class="fa-solid ${metricIcon}" ${metricType === 'likes' ? 'style="color:#ff2442;"' : ''}></i>
                            <span>${escapeHtml(displayMetric)} ${escapeHtml(metricLabel)}</span>
                        </div>
                    </div>
                    ${secondaryMetricHtml}
                    ${[['comments','评论','commentCount','comment'],['collects','收藏','collectCount','collect'],['shares','分享','shareCount','share']].some(([, ,key,prefix])=>video[key]!=null || video[prefix+'LowerBound']!=null)?'<div class="card-secondary-metric">'+[['comments','评论','commentCount','comment'],['collects','收藏','collectCount','collect'],['shares','分享','shareCount','share']].filter(([, ,key,prefix])=>video[key]!=null || video[prefix+'LowerBound']!=null).map(([kind,label])=>escapeHtml(metricText(video,kind))+' '+label).join(' · ')+'</div>':''}
                    ${video.lastSeenAt ? `<div class="card-collected-at">历史采集 · ${escapeHtml(new Date(video.lastSeenAt).toLocaleString('zh-CN'))}</div>` : ''}
                    ${video.viewPrecision === 'source-rounded' ? '<div class="card-collected-at">播放量为平台公开缩写，非精确整数</div>' : ''}
                    ${video.viewPrecision === 'estimated' ? '<div class="card-collected-at">播放量为互动推算预估（非平台数据）</div>' : ''}
                    ${video.likePrecision === 'source-rounded' ? '<div class="card-collected-at">点赞为平台公开缩写，非精确整数</div>' : ''}
                    ${video.viewPrecision==='unverified' || video.likePrecision==='unverified'?'<div class="card-collected-at">旧记录未保留原始精度，待重新采集核验</div>':''}
                </div>
            `;

            card.addEventListener('click', () => {
                openVideoModal(video);
            });

            fragment.appendChild(card);
        });

        if(append)containerEl.appendChild(fragment);else containerEl.replaceChildren(fragment);
    }

    // ── Metric Mode 2: Topic Event Leaderboard ──────────────────────

    function renderTopicLeaderboard(topics, containerEl) {
        containerEl.innerHTML = '';
        const fragment = document.createDocumentFragment();

        topics.forEach((topic, index) => {
            const card = document.createElement('div');
            card.className = 'topic-event-card';

            const rank = topic.rank || index + 1;
            const rankClass = rank === 1 ? 'top-1' : (rank === 2 ? 'top-2' : (rank === 3 ? 'top-3' : ''));
            const rankIcon = rank === 1 ? '👑 1' : (rank === 2 ? '🥈 2' : (rank === 3 ? '🥉 3' : `${rank}`));

            card.innerHTML = `
                <div class="topic-card-left">
                    <div class="topic-rank-badge ${rankClass}">${rankIcon}</div>
                    <div class="topic-content-box">
                        <div class="topic-title-row">
                            <span class="topic-tag-pill">${escapeHtml(topic.tag || '🔥 爆款')}</span>
                            <h3 class="topic-title-text">${escapeHtml(topic.title)}</h3>
                        </div>
                        <p class="topic-desc-text">${escapeHtml(topic.desc || '全网综合热门话题与挑战赛讨论狂潮')}</p>
                    </div>
                </div>
                <div class="topic-card-right">
                    <div class="topic-stats-column">
                        <span class="topic-heat-badge"><i class="fa-solid fa-fire"></i> ${escapeHtml(topic.heatDisplay || '未公开')} 热度</span>
                        <span class="topic-works-count">${escapeHtml(topic.worksCountDisplay || '作品数未公开')}</span>
                    </div>
                    <button class="btn-view-topic-videos">
                        <span>查看关联视频</span> <i class="fa-solid fa-chevron-right"></i>
                    </button>
                </div>
            `;

            card.addEventListener('click', () => {
                openTopicDrilldown(topic);
            });

            fragment.appendChild(card);
        });

        containerEl.appendChild(fragment);
    }

    // ── Metric Mode 2: Topic Drill-Down ─────────────────────────────
    async function openTopicDrilldown(topic) {
        state.currentTopic = topic;

        // Switch View
        dom.topicsGrid.classList.add('hidden');
        dom.topicDrilldownView.classList.remove('hidden');
        dom.drilldownCardsGrid.innerHTML = `
            <div class="loader-container" style="grid-column: 1 / -1;">
                <div class="neon-spinner"></div>
                <p>正在拉取话题【${escapeHtml(topic.title)}】下的高播放量爆款视频...</p>
            </div>
        `;

        dom.drilldownTopicTag.textContent = topic.tag || '🔥 爆款话题';
        dom.drilldownTopicTitle.textContent = topic.title;
        dom.drilldownTopicMeta.textContent = `官方热度: ${topic.heatDisplay || '未公开'} · 关联视频按当前发布时效筛选`;

        try {
            const res = await fetchTopicVideosApi(topic);
            if (state.currentTopic !== topic) return;
            const videos = res.list || [];

            if (videos.length === 0) {
                dom.drilldownCardsGrid.innerHTML = `
                    <div class="empty-container" style="grid-column: 1 / -1;">
                        <i class="fa-regular fa-folder-open empty-icon"></i>
                        <h3>暂无该话题下的视频</h3>
                    </div>
                `;
                return;
            }

            renderVideoCards(videos, dom.drilldownCardsGrid);
        } catch (err) {
            console.error('[Drilldown] Fetch failed:', err);
            if (state.currentTopic !== topic) return;
            dom.drilldownCardsGrid.innerHTML = `<div class="empty-container" style="grid-column:1/-1"><h3>关联视频暂不可用</h3><p>${escapeHtml(err.message)}</p></div>`;
            showToast(err.message, 'error');
        }
    }

    function closeTopicDrilldown() {
        state.currentTopic = null;
        dom.topicDrilldownView.classList.add('hidden');
        dom.topicsGrid.classList.remove('hidden');
    }

    function getResponsivePageSize() {
        return 30;
    }

    // ── Infinite Scroll Pagination ──────────────────────────────────
    function handleScrollPagination() {
        if (state.metricMode === 'topic' || state.isLoading || !state.hasMore) return;

        const { scrollTop, scrollHeight, clientHeight } = dom.gridScrollArea;
        // 提前 450px 预触发，实现无感平滑懒加载
        if (scrollTop + clientHeight >= scrollHeight - 450) {
            loadNextPage();
        }
    }

    async function loadNextPage() {
        if (state.isLoading) return;
        const currentLength = state.displayedVideos.length;
        dom.infiniteLoader.classList.remove('hidden');
        state.isLoading = true;
        const sequence = state.requestSequence;
        let fetchedRemote = false;
        try {
            // 本地候选耗尽后真正请求下一批上游搜索页，不在100条静态列表处停止。
            for (let attempts = 0; currentLength >= state.allVideos.length && state.remoteHasMore && attempts < 3; attempts++) {
                const params = feedParams();
                params.set('page', String(state.remotePage + 1));
                if (state.nextCursor) params.set('cursor', state.nextCursor);
                const endpoint = feedEndpoint();
                const result = await readApi(endpoint + params, { signal: state.feedAbort.signal });
                if (sequence !== state.requestSequence) return;
                fetchedRemote = true;
                if (state.metricMode === 'single') showVideoQuality(result.dataQuality);
                state.remotePage++;
                state.remoteHasMore = Boolean(result.hasMore);
                state.nextCursor = result.nextCursor || '';
                const byId = new Map(state.allVideos.map(video => [video.normPlatform + ':' + video.id, video]));
                for (const video of result.list || []) byId.set(video.normPlatform + ':' + video.id, video);
                state.allVideos = [...byId.values()].sort((a,b)=>VideoRanking.compare(a,b,state.sortBy));
                showSourceCoverage(result);
                const status = document.getElementById('source-status');
                if (status) status.textContent = (result.sourceMessage || '') + ` · 已读取 ${state.remotePage} 批 · 累计 ${state.allVideos.length} 个作品` + (result.collection?.status === 'write-failed' ? ' · ' + result.collection.message : '');
            }
            if (sequence !== state.requestSequence) return;
            state.page += 1;
            const batchSize = getResponsivePageSize();
            state.displayedVideos = state.allVideos.slice(0, currentLength + batchSize);
            renderVideoCards(state.displayedVideos,dom.cardsGrid);
            state.hasMore = state.displayedVideos.length < state.allVideos.length || state.remoteHasMore;
            dom.endHint.classList.toggle('hidden', state.hasMore || state.feedRefreshing);
            document.getElementById('btn-load-more')?.classList.toggle('hidden',!state.hasMore);
            dom.emptyState.classList.toggle('hidden',state.displayedVideos.length>0);
            if(!state.displayedVideos.length)dom.emptyState.querySelector('p').textContent='当前公开样本批次没有匹配视频。'+(state.remoteHasMore?'仍有后续样本，可点击继续加载；这不是全站检索结果。':'已读取的公开样本已结束，不代表全平台没有相关视频。');
        } catch (error) {
            if (error.name !== 'AbortError' && sequence === state.requestSequence) {
                showToast('继续加载失败：' + error.message + '。再次滚动可重试。', 'error');
            }
        } finally {
            if (sequence === state.requestSequence) {
                dom.infiniteLoader.classList.add('hidden');
                state.isLoading = false;
            }
        }
    }

    // ── 3D Geo Radar Data Synchronizer (All 48 Cities & Multi-Tier Metrics) ─
    async function loadGeoHotspots(sequence = state.requestSequence) {
        state.geoAbort?.abort();
        state.geoAbort=new AbortController();
        const geoSequence=(state.geoSequence || 0)+1; state.geoSequence=geoSequence;
        document.getElementById('geo-source-note').textContent='正在统计真实视频样本，不会把地理参考城市算作视频…';
        try {
            const data = await fetchGeoRadarApi(state.geoAbort.signal);
            if (sequence !== state.requestSequence || geoSequence!==state.geoSequence) return;
            const hotspots = Array.isArray(data.list) ? data.list : (Array.isArray(data.hotspots) ? data.hotspots : []);

            state.geoHotspots = hotspots;
            state.geoMetadata = data;
            globeRadar.cityCatalog=data.cityCatalog || [];
            document.getElementById('geo-source-note').textContent=(data.scope==='available'?'已采集平台汇总':'当前平台')+'：'+(data.platforms || []).map(p=>PLATFORM_CONFIG[p]?.name || p).join(' / ')+' · '+data.sampleSize+'条真实样本 · '+hotspots.length+'个关联城市 · 非作者所在地'+(data.collectedAt?' · 最早采集 '+new Date(data.collectedAt).toLocaleTimeString('zh-CN'):'');

            // Update Metrics
            dom.geoCityCount.textContent = hotspots.length;

            const totalEstimatedWorks = data.totalSignals || hotspots.reduce((acc, cur) => acc + (cur.count || 0), 0);
            dom.geoVideoCount.textContent = totalEstimatedWorks + '条';
            dom.geoCoverage.textContent = '样本 ' + (data.sampleSize || 0);

            // Render Panel List (Show all 48 cities with custom tier indicators)
            renderHotspotList(hotspots);

            // Update Globe 3D Points
            // 数据可能先于按需加载的地球库返回；始终保存，初始化完成后再绘制。
            globeRadar.updatePoints(hotspots);
        } catch (err) {
            if(err.name==='AbortError')return;
            console.error('[Geo] Load failed:', err);
            if (sequence !== state.requestSequence || geoSequence!==state.geoSequence) return;
            state.geoHotspots = [];
            globeRadar.updatePoints([]);
            if (dom.hotspotList) dom.hotspotList.innerHTML = `<p class="source-status">${escapeHtml(err.message)}</p>`;
            if (dom.geoCityCount) dom.geoCityCount.textContent = '0';
            if (dom.geoVideoCount) dom.geoVideoCount.textContent = '0条';
            if (dom.geoCoverage) dom.geoCoverage.textContent = '源不可用';
            document.getElementById('geo-source-note').textContent='该范围没有可用样本：'+err.message;
        }
    }

    function renderHotspotList(hotspots) {
        dom.hotspotList.innerHTML = '';
        if (!hotspots.length) dom.hotspotList.innerHTML = '<p class="source-status">当前样本没有明确城市关联，不推测作者所在地。</p>';
        hotspots.forEach(spot => {
            const row = document.createElement('div');
            row.className = 'hotspot-row';
            const tierClass = spot.tier || 'normal';
            // 颜色只接受十六进制色值，防止API数据注入style属性。
            const safeColor = /^#[0-9a-fA-F]{3,8}$/.test(spot.color || '') ? spot.color : '#38bdf8';
            row.innerHTML = `
                <span><i class="legend-dot ${tierClass}"></i> <strong>${escapeHtml(spot.city)}</strong> · ${escapeHtml(spot.country)}</span>
                <span style="color: ${safeColor}; font-weight: 700;">${escapeHtml(spot.countDisplay || formatHeat(spot.count) + '条')}</span>
            `;
            row.addEventListener('click', () => {
                globeRadar.focusCity(spot.lat, spot.lng);
            });
            dom.hotspotList.appendChild(row);
        });
    }

    // ── Popup Video Player & Origin Platform Link ───────────────────
    function openVideoModal(video) {
        state.activeVideo = video;

        dom.modalPlatformBadge.textContent = video.platform || state.platform.toUpperCase();
        dom.modalVideoTitle.textContent = video.title || '视频播放';
        dom.modalVideoAuthor.innerHTML = `<i class="fa-regular fa-user"></i> ${escapeHtml(video.author || '达人')}`;
        dom.modalVideoPlayCount.innerHTML = `<i class="fa-regular fa-eye"></i> ${escapeHtml(metricText(video,'views'))} 播放${video.likeRaw==null && video.likeLowerBound==null?'':' · '+escapeHtml(metricText(video,'likes'))+' 点赞'}`;

        // Direct Original Platform Link in New Tab
        dom.modalOpenOriginBtn.href = safeExternalUrl(video.url);
        dom.modalOpenOriginBtn.classList.toggle('hidden', !video.url);

        // Player Embed Construction
        renderPlayerEmbed(video, dom.modalVideoWrapper);

        // Start Danmaku Engine
        danmakuEngine.start(dom.modalDanmakuScreen, video, dom.modalDanmakuCount);

        // Open Modal
        dom.playerModal.classList.remove('hidden');
    }

    function renderPlayerEmbed(video, containerEl) {
        containerEl.innerHTML = '';
        const bvid = video.id;

        if (bvid && (/^BV[0-9a-zA-Z]{10}$/.test(bvid) || /^av\d+$/.test(bvid))) {
            // Bilibili Iframe Player
            const iframe = document.createElement('iframe');
            iframe.src = `https://player.bilibili.com/player.html?${bvid.startsWith('av') ? 'aid=' + bvid.slice(2) : 'bvid=' + bvid}&page=1&high_quality=1&as_wide=1&allowfullscreen=true&autoplay=1`;
            iframe.setAttribute('allowfullscreen', 'true');
            iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
            containerEl.appendChild(iframe);
        } else if (video.normPlatform === 'youtube' && /^[\w-]{11}$/.test(video.id)) {
            const iframe = document.createElement('iframe');
            iframe.src = 'https://www.youtube-nocookie.com/embed/' + video.id + '?autoplay=1';
            iframe.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture'; iframe.allowFullscreen = true;
            iframe.title = video.title; containerEl.appendChild(iframe);
        } else if (video.normPlatform === 'tiktok' && /^\d{15,22}$/.test(video.id)) {
            const iframe = document.createElement('iframe');
            iframe.src = 'https://www.tiktok.com/player/v1/' + video.id + '?autoplay=1';
            iframe.allow = 'autoplay; fullscreen'; iframe.allowFullscreen = true;
            iframe.title = video.title; containerEl.appendChild(iframe);
        } else if (video.streamUrl) {
            // Direct MP4 / HLS Video Element
            const videoEl = document.createElement('video');
            videoEl.src = video.streamUrl;
            videoEl.controls = true;
            videoEl.autoplay = true;
            containerEl.appendChild(videoEl);
        } else {
            // High-Tech Cyber Placeholder with Direct Sniffer & Origin Links
            containerEl.innerHTML = `
                <div class="player-placeholder" style="background: #000; position: relative; width: 100%; height: 100%; min-height: 240px; display: flex; align-items: center; justify-content: center;">
                    <img src="${escapeHtml(video.cover || '')}" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0.35; filter: blur(4px);">
                    <div style="position: relative; z-index: 2; display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; padding: 20px;">
                        <i class="fa-solid fa-circle-play play-trigger-btn" style="font-size: 52px; color: #38bdf8; cursor: pointer; transition: transform 0.2s;" title="点击尝试提取视频流或前往原站"></i>
                        <p style="color: #fff; font-size: 13.5px; font-weight: 600; margin: 0;">支持在线嗅探物理媒体流或直接在原站观看</p>
                        <div style="display: flex; gap: 10px; margin-top: 4px;">
                            <button type="button" class="btn btn-primary btn-sm sniff-action-btn" style="font-size: 12px; pointer-events: auto;"><i class="fa-solid fa-wand-magic-sparkles"></i> 提取物理媒体</button>
                            ${video.url ? `<a href="${escapeHtml(safeExternalUrl(video.url))}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="font-size: 12px; pointer-events: auto;"><i class="fa-solid fa-arrow-up-right-from-square"></i> 在原平台打开</a>` : ''}
                        </div>
                    </div>
                </div>
            `;
            const sniffBtn = containerEl.querySelector('.sniff-action-btn');
            const playTrigger = containerEl.querySelector('.play-trigger-btn');
            if (sniffBtn) {
                sniffBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    sniffVideoDirectStream(video, sniffBtn);
                });
            }
            if (playTrigger) {
                playTrigger.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (sniffBtn) {
                        sniffVideoDirectStream(video, sniffBtn);
                    } else if (video.url) {
                        window.open(video.url, '_blank', 'noopener,noreferrer');
                    }
                });
            }
        }
    }

    function closePlayerModal() {
        dom.playerModal.classList.add('hidden');
        dom.modalVideoWrapper.innerHTML = '';
        danmakuEngine.stop();
    }
    const closeVideoModal = closePlayerModal;

    function closeDrawer() {
        dom.detailDrawer?.classList.add('hidden');
    }

    // ── Stream Sniffer & Video Action Tools ──────────────────────────
    async function sniffVideoDirectStream(video, btnEl) {
        if (!video) return;
        const targetUrl = video.url;
        if (!targetUrl) return showToast('作品缺少原平台链接，未构造其它平台的视频地址', 'error');

        const originalBtnHtml = btnEl ? btnEl.innerHTML : '';
        if (btnEl) {
            btnEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 嗅探中...`;
            btnEl.disabled = true;
        }

        showToast('正在启动引擎，智能提取物理视频流...', 'info');

        try {
            const res = await fetch('/api/parse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: targetUrl })
            });
            const data = await res.json();
            if (res.status === 401) { setUserSession(null); dom.authModal?.classList.remove('hidden'); }
            if (!res.ok || !data.success || !data.videoUrl) throw new Error(data.message || data.error || '平台未返回可验证的实际媒体流');
            if (data.success && data.videoUrl) {
                if (state.activeVideo !== video) return;
                if (!data.data?.needsMux) video.streamUrl = data.videoUrl;
                renderPlayerEmbed(video, dom.modalVideoWrapper);
                showToast(data.data?.needsMux ? '已取得真实视频轨与音轨；仍使用原站播放器，有声文件需合并' : '已取得实际媒体流，播放器已尝试加载', 'success');
                initUserSession();

                // Drawer Tools Feedback
                dom.streamUrlInput.value = data.videoUrl;
                dom.streamUrlBox.classList.remove('hidden');
                dom.btnDownloadVideo.classList.remove('hidden');

                // Populate AI Insights
                populateAiInsights(video);
            }
        } catch (err) {
            console.error('[Sniff] Error:', err);
            showToast('媒体提取失败：' + err.message + '。原站链接仍可自行查看。', 'error');
        } finally {
            if (btnEl) {
                btnEl.innerHTML = originalBtnHtml;
                btnEl.disabled = false;
            }
        }
    }

    async function downloadVideo(video) {
        if (!video) return;
        let targetUrl = video.url;
        if (!targetUrl && video.id) {
            if (video.id.startsWith('BV') || video.id.startsWith('av')) {
                targetUrl = `https://www.bilibili.com/video/${video.id}`;
            } else if (video.platform === 'douyin' || /^\d+$/.test(video.id)) {
                targetUrl = `https://www.douyin.com/video/${video.id}`;
            } else if (video.platform === 'youtube') {
                targetUrl = `https://www.youtube.com/watch?v=${video.id}`;
            } else {
                return showToast('缺少当前作品的有效原平台链接，未替换成B站素材', 'error');
            }
        }

        if (!targetUrl) return;

        closeVideoModal();
        closeDrawer();
        switchMainView('mediatools');

        if (dom.mtInputUrl) {
            dom.mtInputUrl.value = targetUrl;
            dom.mtClearBtn?.classList.remove('hidden');
        }

        if (window.heatHubDownloaderController) {
            window.heatHubDownloaderController.extract(targetUrl);
        }
    }

    function copyVideoLink(video) {
        if (!video) return;
        const link = video.url;
        if (!link) return showToast('作品没有可验证的原平台链接', 'error');
        navigator.clipboard.writeText(link).then(() => {
            showToast('已成功复制视频原链接到剪贴板！', 'success');
        }).catch(() => {
            showToast('复制链接失败，请手动复制', 'error');
        });
    }

    function populateAiInsights(video) {
        dom.aiCategoryBadge.textContent = '等待真实字幕分析';
        dom.aiHighlightsList.innerHTML = '<li>打开媒体工作台后，将提取该视频字幕或原声，再生成内容总结与重点。</li>';
        dom.aiRecommendationText.textContent = '分析依据和时间戳将在工作台显示。';
    }

    // ── Global Multi-Language System (i18n) ─────────────────────────
    const I18N_DICTIONARY = {
        'zh-CN': {
            title: '万热观象 | Heat Hub - 全球多平台实时热点监测与全能媒体工作台',
            nav_feed: '榜单大盘',
            nav_globe: '热点地球',
            nav_downloader: '万能解析下载',
            nav_downloader_sub: '原声下载 · 真实字幕 · 内容总结',
            btn_user_center: '个人中心 / 登录',
            menu_profile: '个人信息 (Profile)',
            menu_benefits: '个人权益与配额 (Benefits)',
            menu_history: '下载历史记录 (History)',
            menu_settings: '系统设置 (语言/代理)',
            menu_roles: '登录其他账号',
            menu_logout: '退出登录',
            hero_badge: '万热观象 · HEAT HUB 全能媒体工作台',
            hero_title: '万能音视频解析与二创工作台',
            hero_subtitle: '无需注册或扫码 · 公开媒体 MP4 / 原声 MP3 · 真实字幕与语音转写 · 基于内容的重点分析。地区与平台公开访问限制仍可能影响可用性。',
            btn_download_mp4: '下载无水印原画视频 (MP4)',
            btn_extract_mp3: '提取纯音频 (MP3)',
            btn_copy_stream: '复制下载直链',
            tab_transcript: '原声台词与逐句字幕提取',
            tab_ai_insights: '视频内容与重点分析',
            transcript_sync_hint: '逐句音画对齐（点击时间戳可直接跳转视频播放）',
            settings_title: '系统偏好与设置',
            settings_sub: '配置多语言环境、海外平台网络代理与操作偏好',
            set_tab_lang: '语言偏好 (Language)',
            set_tab_proxy: '网络与代理 (Proxy)',
            label_select_lang: '选择系统全局显示语言 (Select System Language):',
            btn_save_settings: '保存并应用设置'
        },
        'zh-TW': {
            title: '萬熱觀象 | Heat Hub - 全球多平台實時熱點監測與全能媒體工作台',
            nav_feed: '榜單大盤',
            nav_globe: '熱點地球',
            nav_downloader: '萬能解析下載',
            nav_downloader_sub: '原聲下載 · 真實字幕 · 內容總結',
            btn_user_center: '個人中心 / 登入',
            menu_profile: '個人資訊 (Profile)',
            menu_benefits: '個人權益與配額 (Benefits)',
            menu_history: '下載歷史記錄 (History)',
            menu_settings: '系統設定 (語言/代理)',
            menu_roles: '登入其他帳號',
            menu_logout: '登出系統',
            hero_badge: '萬熱觀象 · HEAT HUB 全能媒體工作台',
            hero_title: '萬能影音解析與二創工作台',
            hero_subtitle: '解析平台允許存取的媒體 · MP4 / 原聲 MP3 · 真實字幕與語音轉寫 · 基於內容的重點分析。登入、地區與平台限制會影響可用性。',
            btn_download_mp4: '下載無浮水印原畫影片 (MP4)',
            btn_extract_mp3: '提取純音訊 (MP3)',
            btn_copy_stream: '複製下載直鏈',
            tab_transcript: '原聲台詞與逐句字幕提取',
            tab_ai_insights: '影片內容與重點分析',
            transcript_sync_hint: '逐句音畫對齊（點擊時間戳可直接跳轉影片播放）',
            settings_title: '系統偏好與設定',
            settings_sub: '配置多語言環境、海外平台網絡代理與操作偏好',
            set_tab_lang: '語言偏好 (Language)',
            set_tab_proxy: '網絡與代理 (Proxy)',
            label_select_lang: '選擇系統全局顯示語言 (Select System Language):',
            btn_save_settings: '儲存並套用設定'
        },
        'en': {
            title: 'Heat Hub | Universal Hot Video Intelligence & Multi-Platform Media Workbench',
            nav_feed: 'Trending Feed',
            nav_globe: '3D Radar Globe',
            nav_downloader: 'Universal Downloader',
            nav_downloader_sub: 'Original audio · Real captions · Content summary',
            btn_user_center: 'User Center / Sign In',
            menu_profile: 'User Profile',
            menu_benefits: 'Membership & Quotas',
            menu_history: 'Download History',
            menu_settings: 'Preferences (Language/Proxy)',
            menu_roles: 'Sign in to another account',
            menu_logout: 'Log Out',
            hero_badge: 'HEAT HUB · Universal Creator Workbench',
            hero_title: 'Universal Media Sniffer & Creative Workbench',
            hero_subtitle: 'Accessible platform media · MP4 and original-audio MP3 · Real subtitles and speech transcription · Evidence-based content analysis. Login, region and platform restrictions may apply.',
            btn_download_mp4: 'Download HD Video (MP4)',
            btn_extract_mp3: 'Extract Audio (MP3)',
            btn_copy_stream: 'Copy Direct Stream URL',
            tab_transcript: 'Spoken Transcript & Subtitles',
            tab_ai_insights: 'Video content and key points',
            transcript_sync_hint: 'Timestamp Sync (Click any timestamp to seek video playback)',
            settings_title: 'System Settings & Preferences',
            settings_sub: 'Customize language, international network proxies, and behaviors',
            set_tab_lang: 'Language',
            set_tab_proxy: 'Network Proxy',
            label_select_lang: 'Select System Language:',
            btn_save_settings: 'Save and Apply'
        },
        'ja': {
            title: '万熱観象 | Heat Hub - 世界トレンド動画モニタリング＆万能メディアワークベンチ',
            nav_feed: 'トレンド一覧',
            nav_globe: '3D地球儀',
            nav_downloader: '万能ダウンローダー',
            nav_downloader_sub: '音声 · 実字幕 · 内容要約',
            btn_user_center: 'ユーザーセンター / ログイン',
            menu_profile: 'プロフィール (Profile)',
            menu_benefits: '会員特典と利用枠 (Benefits)',
            menu_history: 'ダウンロード履歴 (History)',
            menu_settings: 'システム設定 (言語/プロキシ)',
            menu_roles: '権限ロール切り替え',
            menu_logout: 'ログアウト',
            hero_badge: 'HEAT HUB · 万能メディアワークベンチ',
            hero_title: '万能メディア解析＆二次創作ワークベンチ',
            hero_subtitle: 'アクセス可能なメディア · MP4 / 音声 MP3 · 実字幕と音声認識 · 内容に基づく要点分析。ログイン・地域・サービス制限が適用されます。',
            btn_download_mp4: '透かしなし動画保存 (MP4)',
            btn_extract_mp3: '音声のみ抽出 (MP3)',
            btn_copy_stream: '直リンクをコピー',
            tab_transcript: '音声セリフ・字幕タイムライン',
            tab_ai_insights: '動画内容と要点分析',
            transcript_sync_hint: 'タイムスタンプ同期（クリックで動画再生位置へジャンプ）',
            settings_title: 'システム環境設定',
            settings_sub: 'グローバル言語環境、海外プロキシ、動作設定',
            set_tab_lang: '言語設定 (Language)',
            set_tab_proxy: 'プロキシ設定 (Proxy)',
            label_select_lang: '表示言語を選択してください:',
            btn_save_settings: '設定を保存'
        },
        'ko': {
            title: '만열관상 | Heat Hub - 글로벌 실시간 핫 비디오 모니터링 및 미디어 워크벤치',
            nav_feed: '트렌드 차트',
            nav_globe: '3D 지구본',
            nav_downloader: '만능 다운로더',
            nav_downloader_sub: '원음 · 실제 자막 · 내용 요약',
            btn_user_center: '마이페이지 / 로그인',
            menu_profile: '개인정보 (Profile)',
            menu_benefits: '멤버십 혜택 (Benefits)',
            menu_history: '다운로드 기록 (History)',
            menu_settings: '환경 설정 (언어/프록시)',
            menu_roles: '체험 역할 전환',
            menu_logout: '로그아웃',
            hero_badge: 'HEAT HUB · 만능 미디어 워크벤치',
            hero_title: '만능 스트림 추출 및 2차 창작 워크벤치',
            hero_subtitle: '접근 가능한 미디어 · MP4 / 원음 MP3 · 실제 자막과 음성 인식 · 내용 기반 분석. 로그인, 지역 및 플랫폼 제한이 적용됩니다.',
            btn_download_mp4: '워터마크 없는 동영상 다운로드 (MP4)',
            btn_extract_mp3: '음원 추출 (MP3)',
            btn_copy_stream: '직접 링크 복사',
            tab_transcript: '음성 대사 및 자막 추출',
            tab_ai_insights: '영상 내용 및 핵심 분석',
            transcript_sync_hint: '타임스탬프 동기화 (클릭 시 해당 영상 재생 지점으로 이동)',
            settings_title: '시스템 환경 설정',
            settings_sub: '언어 설정, 해외 프록시 네트워크 및 시스템 환경 관리',
            set_tab_lang: '언어 설정 (Language)',
            set_tab_proxy: '프록시 설정 (Proxy)',
            label_select_lang: '시스템 표시 언어 선택:',
            btn_save_settings: '설정 저장 및 적용'
        }
    };

    class I18nEngine {
        constructor() {
            this.currentLang = localStorage.getItem('heathub_lang') || 'zh-CN';
        }

        init() {
            this.applyLanguage(this.currentLang, false);
        }

        setLanguage(lang) {
            if (!I18N_DICTIONARY[lang]) lang = 'zh-CN';
            this.currentLang = lang;
            localStorage.setItem('heathub_lang', lang);
            this.applyLanguage(lang, true);
        }

        applyLanguage(lang, showNotification = true) {
            const dict = I18N_DICTIONARY[lang] || I18N_DICTIONARY['zh-CN'];

            // 1. Update Document Title
            if (dict.title) document.title = dict.title;

            // 2. Update all data-i18n elements
            document.querySelectorAll('[data-i18n]').forEach(el => {
                const key = el.getAttribute('data-i18n');
                if (dict[key]) {
                    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                        el.placeholder = dict[key];
                    } else {
                        el.textContent = dict[key];
                    }
                }
            });

            // 3. Update Settings modal radio cards
            dom.langCards?.forEach(card => {
                const cardLang = card.dataset.lang;
                const isSelected = cardLang === lang;
                card.classList.toggle('active', isSelected);
                const radio = card.querySelector('input[type="radio"]');
                if (radio) radio.checked = isSelected;
            });

            if (showNotification) {
                const langNames = {
                    'zh-CN': '简体中文 (Simplified Chinese)',
                    'zh-TW': '繁體中文 (Traditional Chinese)',
                    'en': 'English',
                    'ja': '日本語 (Japanese)',
                    'ko': '한국어 (Korean)'
                };
                showToast(`🌐 系统语言已切换为: ${langNames[lang] || lang}`, 'success');
            }
        }
    }

    const i18n = new I18nEngine();
    window.i18n = i18n;

    // ── Authentication, User Center & Settings Controller ────────────
    class UserCenterController {
        constructor() {
            this.activeTab = 'language';
        }

        init() {
            // 1. Toggle User Center Dropdown on clicking user identity card
            if (dom.userIdentityCard) {
                dom.userIdentityCard.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!state.user) return;
                    dom.userCenterDropdown?.classList.toggle('hidden');
                    dom.userCenterWrapper?.classList.toggle('active');
                });
            }

            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (dom.userCenterWrapper && !dom.userCenterWrapper.contains(e.target)) {
                    dom.userCenterDropdown?.classList.add('hidden');
                    dom.userCenterWrapper?.classList.remove('active');
                }
            });

            // 2. Dropdown Menu Actions
            dom.menuBtnProfile?.addEventListener('click', () => {
                dom.userCenterDropdown?.classList.add('hidden');
                this.openProfileModal();
            });

            dom.menuBtnBenefits?.addEventListener('click', () => {
                dom.userCenterDropdown?.classList.add('hidden');
                dom.benefitsModal?.classList.remove('hidden');
            });

            dom.menuBtnHistory?.addEventListener('click', () => {
                dom.userCenterDropdown?.classList.add('hidden');
                switchMainView('mediatools');
                setTimeout(() => {
                    const histElem = document.getElementById('mt-history-list');
                    histElem?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 100);
            });

            dom.menuBtnSettings?.addEventListener('click', () => {
                dom.userCenterDropdown?.classList.add('hidden');
                dom.settingsModal?.classList.remove('hidden');
            });

            dom.menuBtnSwitchRole?.addEventListener('click', () => {
                dom.userCenterDropdown?.classList.add('hidden');
                dom.authModal?.classList.remove('hidden');
            });

            dom.menuBtnLogout?.addEventListener('click', () => {
                dom.userCenterDropdown?.classList.add('hidden');
                this.logout();
            });

            // 3. Profile Modal Actions
            dom.closeProfileModalBtn?.addEventListener('click', () => {
                dom.profileModal?.classList.add('hidden');
            });
            dom.profileModal?.addEventListener('click', (e) => {
                if (e.target === dom.profileModal) dom.profileModal.classList.add('hidden');
            });
            dom.btnProfileToBenefits?.addEventListener('click', () => {
                dom.profileModal?.classList.add('hidden');
                dom.benefitsModal?.classList.remove('hidden');
            });

            // 4. Benefits Modal Actions
            dom.closeBenefitsModalBtn?.addEventListener('click', () => {
                dom.benefitsModal?.classList.add('hidden');
            });
            dom.benefitsModal?.addEventListener('click', (e) => {
                if (e.target === dom.benefitsModal) dom.benefitsModal.classList.add('hidden');
            });

            // 5. Settings Modal Navigation Tabs
            dom.settingsTabBtns?.forEach(btn => {
                btn.addEventListener('click', () => {
                    dom.settingsTabBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const targetTab = btn.dataset.settab;
                    dom.setContentLanguage?.classList.toggle('hidden', targetTab !== 'language');
                    dom.setContentProxy?.classList.toggle('hidden', targetTab !== 'proxy');
                });
            });

            // 6. Language Selection Cards
            dom.langCards?.forEach(card => {
                card.addEventListener('click', () => {
                    const lang = card.dataset.lang;
                    if (lang) i18n.setLanguage(lang);
                });
            });
        }

        async openProfileModal() {
            if (!requireLogin()) return;
            await initUserSession();
            const user = state.user;
            if (!user) return;
            if (dom.profileUserAvatar) dom.profileUserAvatar.src = user.avatar || '/avatar-placeholder.svg';
            if (dom.profileNickname) dom.profileNickname.textContent = user.nickname || user.username;
            if (dom.profileUsername) dom.profileUsername.textContent = user.username;
            if (dom.profileRoleBadge) dom.profileRoleBadge.textContent = user.role === 'admin' ? 'ADMIN' : user.role === 'pro' ? 'PRO' : 'USER';
            if (dom.profileRegDate) dom.profileRegDate.textContent = user.registeredAt ? new Date(user.registeredAt).toLocaleDateString() : '旧账号未记录';
            const quota = user.quota;
            if (dom.profileQuotaDisplay) dom.profileQuotaDisplay.textContent = quota.limit === null
                ? '已完成 ' + quota.used + ' 次，处理中 ' + quota.pending + ' 次（无每日配额限制）'
                : '已完成 ' + quota.used + ' / ' + quota.limit + ' 次，处理中 ' + quota.pending + ' 次，剩余 ' + quota.remaining + ' 次';
            if (dom.profileQuotaBar) dom.profileQuotaBar.style.width = quota.limit === null ? '0%' : Math.min(100, (quota.used + quota.pending) / quota.limit * 100) + '%';
            const nickname = document.getElementById('profile-edit-nickname');
            if (nickname) nickname.value = user.nickname;
            dom.profileModal?.classList.remove('hidden');
        }

        async logout() {
            try {
                await readApi('/api/auth/logout', { method: 'POST' });
                localStorage.removeItem('hotpot_token');
                setUserSession(null);
                dom.userCenterDropdown?.classList.add('hidden');
                dom.profileModal?.classList.add('hidden');
                showToast('服务端会话已注销', 'info');
            } catch (error) { showToast('退出失败：' + error.message + '，尚未假报退出', 'error'); }
        }
    }

    const userCenterController = new UserCenterController();
    window.userCenterController = userCenterController;

    function requireLogin() {
        if (state.user) return true;
        dom.authModal?.classList.remove('hidden');
        showToast('账号资料需要登录；访客无需登录即可浏览、分析与下载公开媒体', 'info');
        return false;
    }

    async function initUserSession() {
        localStorage.removeItem('hotpot_token');
        try {
            const response = await fetch('/api/auth/me', { cache: 'no-store' });
            if (response.ok) { const data = await response.json(); setUserSession(data.user); return; }
            if (response.status !== 401) showToast('账号状态读取失败，未显示虚假身份', 'warning');
        } catch { showToast('账号状态暂不可用', 'warning'); }
        setUserSession(null);
    }

    function setUserSession(user) {
        const changed = state.user?.username !== user?.username;
        state.user = user;
        updateUserUi(user);
        if (changed) {
            dom.loginForm?.reset(); dom.registerForm?.reset();
            document.getElementById('account-password-form')?.reset();
            heatHubDownloaderController.sequence++;
            heatHubDownloaderController.parseAbort?.abort();
            heatHubDownloaderController.analysisAbort?.abort();
            heatHubDownloaderController.activeData = null;
            dom.mtResultsContainer?.classList.add('hidden');
            dom.mtLoadingState?.classList.add('hidden');
            dom.mtNativeVideo?.pause(); dom.mtNativeVideo?.removeAttribute('src');
            dom.mtNativeAudio?.pause(); dom.mtNativeAudio?.removeAttribute('src');
            document.getElementById('mt-bili-frame')?.remove();
            dom.mtTranscriptTimeline && (dom.mtTranscriptTimeline.innerHTML = '');
            if(dom.mtAiTrigger)dom.mtAiTrigger.textContent='请读取当前账号的视频后分析';
            if(dom.mtAiHooks)dom.mtAiHooks.innerHTML='';
            if(dom.mtAiRecommendations)dom.mtAiRecommendations.textContent='';
            if(dom.mtImageGallery)dom.mtImageGallery.innerHTML='';
            if (dom.mtExtractBtn) dom.mtExtractBtn.disabled = false;
        }
        heatHubDownloaderController.renderHistory();
    }

    function updateUserUi(user) {
        dom.userLoggedInBox?.classList.toggle('hidden', !user);
        dom.userLoginTrigger?.classList.toggle('hidden', Boolean(user));
        if (dom.settingProxy) dom.settingProxy.disabled=user?.role!=='admin';
        document.querySelectorAll('.proxy-pill-btn').forEach(button=>button.disabled=user?.role!=='admin');
        if (!user) return;
        const avatar = user.avatar || '/avatar-placeholder.svg';
        if (dom.userAvatar) dom.userAvatar.src = avatar;
        if (dom.dropdownUserAvatar) dom.dropdownUserAvatar.src = avatar;
        if (dom.userNickname) dom.userNickname.textContent = user.nickname || user.username;
        if (dom.dropdownNickname) dom.dropdownNickname.textContent = user.nickname || user.username;
        const label = user.role === 'admin' ? 'ADMIN' : user.role === 'pro' ? 'PRO' : 'USER';
        for (const badge of [dom.userRoleBadge, dom.dropdownRoleBadge]) if (badge) { badge.className = 'role-badge role-' + user.role; badge.textContent = label; }
        if (dom.dropdownQuotaCount) dom.dropdownQuotaCount.textContent = user.quota?.limit === null ? '无每日额度限制（队列有限）' : '剩余 ' + user.quota?.remaining + ' / ' + user.quota?.limit + ' 次';
    }

    // ── Settings & Proxy ────────────────────────────────────────────
    async function loadSettings() {
        try {
            const res = await fetch('/api/settings');
            const data = await res.json();
            if (data.success) {
                // 代理地址仅管理员可见；普通用户凭 proxyConfigured 布尔显示连接状态。
                dom.settingProxy.value = data.proxy || '';
                updateProxyStatus(Boolean(data.proxyConfigured || data.proxy));
            }
        } catch (e) {}
    }

    function updateProxyStatus(enabled) {
        const hasProxy = Boolean(enabled);
        dom.proxyStatus.className = `proxy-status-badge ${hasProxy ? 'active' : 'inactive'}`;
        dom.proxyStatus.textContent = hasProxy ? '已连接' : '未连接';
        dom.sidebarProxyDot?.classList.toggle('active', hasProxy);
    }

    async function saveSettings() {
        if(state.user?.role!=='admin') {
            dom.settingsModal?.classList.add('hidden'); showToast('语言偏好已保存在本机；全局代理仅管理员可修改', 'info'); return;
        }
        const proxy = dom.settingProxy.value.trim();
        try {
            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ proxy })
            });
            const data = await res.json();
            if (data.success) {
                showToast('系统设置与网络代理已保存生效！', 'success');
                updateProxyStatus(Boolean(proxy));
                dom.settingsModal?.classList.add('hidden');
            }
        } catch (e) {
            showToast('保存设置失败', 'error');
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        const icon = type === 'success' ? 'fa-circle-check' : (type === 'error' ? 'fa-circle-exclamation' : (type === 'warning' ? 'fa-triangle-exclamation' : 'fa-circle-info'));
        toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${escapeHtml(message)}</span>`;
        dom.toastContainer.appendChild(toast);
        setTimeout(() => {
            if (toast.parentNode === dom.toastContainer) {
                dom.toastContainer.removeChild(toast);
            }
        }, 3200);
    }

    function formatHeat(num) {
        const n = Number(num);
        if (!Number.isFinite(n) || n <= 0) return '0';
        if (n >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, '') + '亿';
        if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
        return n.toLocaleString();
    }

    function formatPublishDate(timestamp) {
        if (!timestamp) return '发布时间未公开';
        let ts = Number(timestamp);
        if (!Number.isFinite(ts) || ts <= 0) {
            const parsed = Date.parse(timestamp);
            ts = !isNaN(parsed) ? Math.floor(parsed / 1000) : 0;
        }
        if (ts > 1e11) ts = Math.floor(ts / 1000);
        const date = new Date(ts * 1000);
        if (isNaN(date.getTime()) || date.getFullYear() < 2000) {
            return '发布时间未公开';
        }
        const y = date.getFullYear();
        const m = date.getMonth() + 1;
        const d = date.getDate();
        return `${y}年${m}月${d}日`;
    }

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // 可点击跳转的URL只接受http(s)，防止 javascript: 等协议经API数据进入 href。
    function safeExternalUrl(url) {
        const value = String(url || '').trim();
        return /^https?:\/\//i.test(value) ? value : '#';
    }

    // ── Heat Hub Universal Downloader & Creative Master Controller ──
    class HeatHubDownloaderController {
        constructor() {
            this.sequence = 0;
            this.analysisAbort = null;
            this.parseAbort = null;
            this.activeData = null;
            this.activeP = 0;
        }

        init() {
            // 1. Quick Sample Chips
            document.querySelectorAll('.galaxy-sample-row .sample-chip').forEach(btn => {
                btn.addEventListener('click', () => {
                    const url = btn.getAttribute('data-url');
                    if (url && dom.mtInputUrl) {
                        dom.mtInputUrl.value = url;
                        dom.mtClearBtn?.classList.remove('hidden');
                        this.extract(url);
                    }
                });
            });

            // 2. Paste Button
            if (dom.mtPasteBtn) {
                dom.mtPasteBtn.addEventListener('click', async () => {
                    try {
                        const text = await navigator.clipboard.readText();
                        if (text && dom.mtInputUrl) {
                            dom.mtInputUrl.value = text.trim();
                            dom.mtClearBtn?.classList.remove('hidden');
                            showToast('已从剪贴板粘贴分享口令', 'info');
                            this.extract(text.trim());
                        }
                    } catch (e) {
                        dom.mtInputUrl?.focus();
                        showToast('请直接在输入框中使用 Ctrl+V 粘贴', 'info');
                    }
                });
            }

            // 3. Clear Button
            if (dom.mtClearBtn) {
                dom.mtClearBtn.addEventListener('click', () => {
                    if (dom.mtInputUrl) {
                        dom.mtInputUrl.value = '';
                        dom.mtClearBtn.classList.add('hidden');
                        dom.mtInputUrl.focus();
                    }
                });
            }

            // 4. Input textarea auto-grow and keydown
            if (dom.mtInputUrl) {
                dom.mtInputUrl.addEventListener('input', () => {
                    dom.mtClearBtn?.classList.toggle('hidden', !dom.mtInputUrl.value);
                    dom.mtErrorBox?.classList.add('hidden');
                });
                dom.mtInputUrl.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        this.extract(dom.mtInputUrl.value);
                    }
                });
            }

            // 5. Extract Submit Button
            if (dom.mtExtractBtn) {
                dom.mtExtractBtn.addEventListener('click', () => {
                    if (dom.mtInputUrl) {
                        this.extract(dom.mtInputUrl.value);
                    }
                });
            }

            // 6. Close Result Button
            if (dom.mtBtnCloseResult) {
                dom.mtBtnCloseResult.addEventListener('click', () => {
                    dom.mtResultsContainer?.classList.add('hidden');
                    this.sequence += 1;
                    this.analysisAbort?.abort();
                    this.parseAbort?.abort();
                    document.getElementById('mt-bili-frame')?.remove();
                    if (dom.mtNativeVideo) {
                        dom.mtNativeVideo.pause();
                        dom.mtNativeVideo.removeAttribute('src');
                        dom.mtNativeVideo.load();
                    }
                });
            }

            // 7. Dual Feature Tabs Navigation (Transcript vs AI Insights)
            dom.mtTabBtns?.forEach(btn => {
                btn.addEventListener('click', () => {
                    dom.mtTabBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const targetTab = btn.dataset.mttab;
                    dom.mtPanelTranscript?.classList.toggle('hidden', targetTab !== 'transcript');
                    dom.mtPanelAi?.classList.toggle('hidden', targetTab !== 'ai');
                });
            });

            // Download prepared, validated media instead of renaming raw tracks.
            dom.mtBtnDownloadMp4?.addEventListener('click', () => this.prepareDownload('download', dom.mtBtnDownloadMp4));
            dom.mtBtnDownloadMp3?.addEventListener('click', () => this.prepareDownload('audio', dom.mtBtnDownloadMp3));

            // 10. Copy Stream URL
            if (dom.mtBtnCopyStream) {
                dom.mtBtnCopyStream.addEventListener('click', () => {
                    if (!this.activeData) return;
                    const streamUrl = this.activeData.originDownloadVideoUrl || this.activeData.downloadVideoUrl;
                    if (streamUrl) {
                        navigator.clipboard.writeText(streamUrl).then(() => {
                            showToast(this.activeData.needsMux ? '已复制视频轨地址（不含原声音轨），有声文件请使用 MP4 下载' : '实际媒体地址已复制（有有效期）', 'success');
                        });
                    }
                });
            }

            // 11. Download All Images ZIP (for Xiaohongshu / Douyin Photos)
            if (dom.mtBtnDownloadAllZip) {
                dom.mtBtnDownloadAllZip.addEventListener('click', () => {
                    if (!this.activeData || !Array.isArray(this.activeData.images) || this.activeData.images.length === 0) {
                        showToast('当前没有可打包的原图', 'warning');
                        return;
                    }
                    this.downloadAllImagesAsZip(this.activeData.title, this.activeData.images);
                });
            }

            // 12. Download BGM
            if (dom.mtBtnDownloadBgm) {
                dom.mtBtnDownloadBgm.addEventListener('click', () => {
                    this.prepareDownload('audio', dom.mtBtnDownloadBgm);
                });
            }

            // 13. Audio panel download
            if (dom.mtBtnDownloadAudioFile) {
                dom.mtBtnDownloadAudioFile.addEventListener('click', () => {
                    this.prepareDownload('audio', dom.mtBtnDownloadAudioFile);
                });
            }

            // 14. Lightbox Close
            if (dom.mtLightboxClose) {
                dom.mtLightboxClose.addEventListener('click', () => {
                    dom.mtLightboxModal?.classList.add('hidden');
                });
            }
            if (dom.mtLightboxModal) {
                dom.mtLightboxModal.addEventListener('click', (e) => {
                    if (e.target === dom.mtLightboxModal) {
                        dom.mtLightboxModal.classList.add('hidden');
                    }
                });
            }

            // 15. Clear History Button
            if (dom.mtBtnClearHistory) {
                dom.mtBtnClearHistory.addEventListener('click', () => {
                    this.clearHistory();
                });
            }

            // 16. Load initial history & stats
            this.renderHistory();
            this.fetchTodayStats();
        }

        triggerDownload(url, filename) {
            let finalUrl = url;
            if (!finalUrl.startsWith('/api/download') && !finalUrl.startsWith('/api/media/jobs/')) {
                finalUrl = `/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename || 'media')}`;
            }
            const a = document.createElement('a');
            a.href = finalUrl;
            a.download = filename || 'download';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }

        async extract(inputUrl) {
            if (!inputUrl || !inputUrl.trim()) {
                showToast('请先输入或粘贴视频/图文链接', 'warning');
                dom.mtInputUrl?.focus();
                return;
            }

            const sequence = ++this.sequence;
            this.analysisAbort?.abort();
            this.parseAbort?.abort();
            this.parseAbort = new AbortController();
            this.activeData = null;
            dom.mtLoadingState?.classList.remove('hidden');
            dom.mtResultsContainer?.classList.add('hidden');
            dom.mtErrorBox?.classList.add('hidden');
            if (dom.mtExtractBtn) dom.mtExtractBtn.disabled = true;

            try {
                const headers = { 'Content-Type': 'application/json' };

                const res = await fetch('/api/parse', {
                    method: 'POST',
                    signal: this.parseAbort.signal,
                    headers,
                    body: JSON.stringify({ url: inputUrl.trim() })
                });

                const payload = await res.json();
                if (res.status === 401) { setUserSession(null); dom.authModal?.classList.remove('hidden'); }
                if (sequence !== this.sequence) return;
                if (!payload.success || !payload.data) {
                    throw new Error(payload.error || payload.message || '解析失败，请检查链接有效性');
                }

                const data = payload.data;
                this.activeData = data;
                this.activeP = 0;

                // Determine Kind & Render
                if (data.noteType === 'image' && Array.isArray(data.images) && data.images.length > 0) {
                    this.renderImagePanel(data);
                } else if (data.noteType === 'audio' || !data.downloadVideoUrl && !data.originDownloadVideoUrl && (data.downloadAudioUrl || data.originDownloadAudioUrl)) {
                    this.renderAudioPanel(data);
                } else {
                    this.renderVideoPanel(data);
                }

                dom.mtLoadingState?.classList.add('hidden');
                dom.mtResultsContainer?.classList.remove('hidden');
                showToast('已取得真实媒体信息；分析和有声文件仍需处理', 'success');

                this.renderHistory();
                initUserSession();

                this.fetchTodayStats();
                if (data.noteType !== 'image') this.runAnalysis(data, sequence);

            } catch (err) {
                if (err.name === 'AbortError' || sequence !== this.sequence) return;
                console.error('[Heat Hub Downloader] Extract Error:', err);
                dom.mtLoadingState?.classList.add('hidden');
                if (dom.mtErrorBox && dom.mtErrorMsg) {
                    dom.mtErrorMsg.textContent = err.message || '解析引擎出现错误，请检查链接';
                    dom.mtErrorBox.classList.remove('hidden');
                }
                showToast(err.message || '解析失败，请检查链接有效性', 'warning');
            } finally {
                if (sequence === this.sequence && dom.mtExtractBtn) dom.mtExtractBtn.disabled = false;
            }
        }

        renderVideoPanel(data) {
            dom.mtPanelVideo?.classList.remove('hidden');
            dom.mtPanelImage?.classList.add('hidden');
            dom.mtPanelAudio?.classList.add('hidden');

            if (dom.mtResPlatform) {
                const platNames = {
                    douyin: '抖音无水印',
                    bilibili: '哔哩哔哩',
                    xiaohongshu: '小红书',
                    kuaishou: '快手',
                    youtube: 'YouTube',
                    tiktok: 'TikTok',
                    twitter: 'Twitter / X',
                    universal: '网页在线流'
                };
                dom.mtResPlatform.textContent = platNames[data.platform] || String(data.platform || 'UNIVERSAL').toUpperCase();
            }

            if (dom.mtResTitle) dom.mtResTitle.textContent = data.title || '无标题视频';
            if (dom.mtResAuthor) dom.mtResAuthor.textContent = data.author || '创作者';
            if (dom.mtResDuration) {
                const dur = data.duration;
                dom.mtResDuration.textContent = typeof dur === 'number' ? `${Math.floor(dur / 60)}分${dur % 60}秒` : (dur || 'Shorts');
            }
            if (dom.mtResOriginLink) {
                dom.mtResOriginLink.href = safeExternalUrl(data.url);
            }

            // Stream playback proxy URL
            const playUrl = data.playVideoUrl || `/api/play?url=${encodeURIComponent(data.originDownloadVideoUrl || data.downloadVideoUrl)}&referer=${encodeURIComponent(data.url || '')}`;
            if (dom.mtNativeVideo) {
                document.getElementById('mt-bili-frame')?.remove();
                dom.mtNativeVideo.classList.toggle('hidden', Boolean(data.needsMux && data.bvid));
                if (data.needsMux) dom.mtNativeVideo.removeAttribute('src');
                else dom.mtNativeVideo.src = playUrl;
                dom.mtNativeVideo.poster = data.cover || '';
                dom.mtNativeVideo.load();
                if (data.needsMux && data.bvid) {
                    const iframe = document.createElement('iframe');
                    iframe.id = 'mt-bili-frame';
                    iframe.src = 'https://player.bilibili.com/player.html?bvid=' + encodeURIComponent(data.bvid) + '&cid=' + data.cid + '&autoplay=0';
                    iframe.allowFullscreen = true;
                    iframe.style.cssText = 'width:100%;aspect-ratio:16/9;border:0;display:block;';
                    dom.mtNativeVideo.parentNode.appendChild(iframe);
                }
            }

            // Multi-P Pages (for Bilibili multi-part videos)
            if (dom.mtPagesWrapper && dom.mtPagesList) {
                if (Array.isArray(data.pages) && data.pages.length > 1) {
                    dom.mtPagesCount.textContent = data.pages.length;
                    dom.mtPagesList.innerHTML = data.pages.map((p, idx) => `
                        <button class="page-pill ${p.cid === data.cid ? 'active' : ''}" data-pindex="${idx}">
                            <span class="p-num">P${p.page || (idx + 1)}</span>
                            <span class="p-title">${escapeHtml(p.part || `第${idx + 1}节`)}</span>
                        </button>
                    `).join('');
                    dom.mtPagesWrapper.classList.remove('hidden');

                    // Bind page click events
                    dom.mtPagesList.querySelectorAll('.page-pill').forEach(pill => {
                        pill.addEventListener('click', () => {
                            const pIndex = parseInt(pill.dataset.pindex) || 0;
                            dom.mtPagesList.querySelectorAll('.page-pill').forEach(el => el.classList.remove('active'));
                            pill.classList.add('active');
                            this.switchMultiPage(data, pIndex);
                        });
                    });
                } else {
                    dom.mtPagesWrapper.classList.add('hidden');
                }
            }

            // Render Transcript Timeline
            this.renderTranscript(data.transcript, data.title);

            // Render AI Video Insights
            this.renderAiInsights(data.aiAnalysis, data);
        }

        renderTranscript(transcriptData, title) {
            let list = [];
            let fullText = '';
            let srtContent = '';

            if (transcriptData) {
                if (Array.isArray(transcriptData)) {
                    list = transcriptData;
                } else if (Array.isArray(transcriptData.transcript)) {
                    list = transcriptData.transcript;
                    fullText = transcriptData.fullText || transcriptData.plainText || '';
                    srtContent = transcriptData.srtContent || '';
                }
            }

            if (!fullText && list.length > 0) {
                fullText = list.map(item => item.text).join('\n');
            }

            if (dom.mtTranscriptCount) {
                dom.mtTranscriptCount.textContent = `${list.length}句`;
            }

            if (dom.mtTranscriptTimeline) {
                if (list.length === 0) {
                    dom.mtTranscriptTimeline.innerHTML = `
                        <div class="transcript-empty-state">
                            <i class="fa-solid fa-microphone-lines"></i>
                            <p>该视频暂未提取到逐句原声台词</p>
                        </div>
                    `;
                } else {
                    dom.mtTranscriptTimeline.innerHTML = list.map(item => {
                        // startSec 必须收敛为数字后再进属性插值，非数字输入按0处理。
                        const startSec = Number(item.startSec) || 0;
                        const mm = String(Math.floor(startSec / 60)).padStart(2, '0');
                        const ss = String(Math.floor(startSec % 60)).padStart(2, '0');
                        const timeStr = `${mm}:${ss}`;

                        return `
                            <div class="transcript-line-item" data-start="${startSec}" title="点击跳转至 ${timeStr} 播放">
                                <button type="button" class="time-stamp-btn" data-start="${startSec}">[${timeStr}]</button>
                                <span class="line-content-text">${escapeHtml(item.text)}</span>
                            </div>
                        `;
                    }).join('');

                    // Bind click to seek video
                    dom.mtTranscriptTimeline.querySelectorAll('.transcript-line-item').forEach(line => {
                        line.addEventListener('click', () => {
                            const sec = parseFloat(line.dataset.start) || 0;
                            if (dom.mtNativeVideo) {
                                this.seekVideo(sec);
                                showToast(`已跳转至 ${Math.floor(sec)}秒 播放`, 'info');
                            }
                        });
                    });

                    // Sync video playback time with transcript highlight in real time
                    if (dom.mtNativeVideo) {
                        dom.mtNativeVideo.ontimeupdate = () => {
                            const curTime = dom.mtNativeVideo.currentTime;
                            const items = dom.mtTranscriptTimeline?.querySelectorAll('.transcript-line-item');
                            if (!items || items.length === 0) return;

                            let activeIdx = -1;
                            for (let i = 0; i < items.length; i++) {
                                const s = parseFloat(items[i].dataset.start) || 0;
                                const nextS = items[i + 1] ? (parseFloat(items[i + 1].dataset.start) || Infinity) : Infinity;
                                if (curTime >= s && curTime < nextS) {
                                    activeIdx = i;
                                    break;
                                }
                            }

                            if (activeIdx !== -1) {
                                items.forEach((item, idx) => {
                                    const isCurrent = idx === activeIdx;
                                    if (item.classList.contains('active') !== isCurrent) {
                                        item.classList.toggle('active', isCurrent);
                                        if (isCurrent && dom.mtTranscriptTimeline) {
                                            const container = dom.mtTranscriptTimeline;
                                            const cTop = container.scrollTop;
                                            const cHeight = container.clientHeight;
                                            const itemTop = item.offsetTop - container.offsetTop;
                                            if (itemTop < cTop || itemTop > cTop + cHeight - 40) {
                                                item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                                            }
                                        }
                                    }
                                });
                            }
                        };
                    }
                }
            }

            // Bind Transcript Action Buttons
            if (dom.mtBtnCopyTranscript) {
                dom.mtBtnCopyTranscript.onclick = () => {
                    if (!fullText) {
                        showToast('暂无可复制的台词内容', 'warning');
                        return;
                    }
                    navigator.clipboard.writeText(fullText).then(() => {
                        showToast('已复制全部原声台词全文！', 'success');
                    });
                };
            }

            if (dom.mtBtnExportTxt) {
                dom.mtBtnExportTxt.onclick = () => {
                    if (!fullText) {
                        showToast('暂无可导出的台词', 'warning');
                        return;
                    }
                    const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
                    const blobUrl = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = blobUrl;
                    a.download = `${title || 'video'}_原声台词.txt`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(blobUrl);
                    showToast('已成功导出 TXT 台词文档！', 'success');
                };
            }

            if (dom.mtBtnExportSrt) {
                dom.mtBtnExportSrt.onclick = () => {
                    let srt = srtContent;
                    if (!srt && list.length > 0) {
                        srt = list.map((item, idx) => {
                            const s = item.startSec || 0;
                            const e = item.endSec || (s + 3);
                            const formatSrtTime = (sec) => {
                                const h = String(Math.floor(sec / 3600)).padStart(2, '0');
                                const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
                                const sInt = String(Math.floor(sec % 60)).padStart(2, '0');
                                const ms = String(Math.floor((sec % 1) * 1000)).padStart(3, '0');
                                return `${h}:${m}:${sInt},${ms}`;
                            };
                            return `${idx + 1}\n${formatSrtTime(s)} --> ${formatSrtTime(e)}\n${item.text}\n`;
                        }).join('\n');
                    }

                    if (!srt) {
                        showToast('暂无可导出的字幕时间轴', 'warning');
                        return;
                    }

                    const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' });
                    const blobUrl = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = blobUrl;
                    a.download = `${title || 'video'}_标准字幕.srt`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(blobUrl);
                    showToast('已成功导出 SRT 字幕文件！', 'success');
                };
            }
        }

        renderAiInsights(aiData, videoData) {
            if (dom.mtAiCategory) dom.mtAiCategory.textContent = aiData?.category || '等待内容分析';
            if (dom.mtAiAudience) dom.mtAiAudience.textContent = aiData ? (aiData.method === 'extractive' ? '真实字幕摘录' : aiData.method === 'textrank' ? '本地语义摘要（TextRank，无神经模型）' : '基于真实字幕的 AI 总结') : '分析尚未完成';
            if (dom.mtAiTrigger) dom.mtAiTrigger.textContent = aiData?.summary || '读取实际字幕或视频原声后，将显示视频讲了什么。';
            if (dom.mtAiHooks) {
                const points = aiData?.keyPoints || [];
                dom.mtAiHooks.innerHTML = points.length ? points.map(point => {
                    const startSec = Number(point.startSec) || 0;
                    return `
                    <button class="hook-card analysis-point" data-seek="${startSec}">
                        <span class="hook-tag">${Math.floor(startSec / 60)}:${String(Math.floor(startSec % 60)).padStart(2, '0')}</span>
                        <p class="hook-desc">${escapeHtml(point.text)}</p>
                        <blockquote>字幕依据：${escapeHtml(point.quote)}</blockquote>
                    </button>
                `; }).join('') : '<p>等待可回溯的字幕重点。</p>';
                dom.mtAiHooks.querySelectorAll('[data-seek]').forEach(button => button.addEventListener('click', () => this.seekVideo(Number(button.dataset.seek))));
            }
            if (dom.mtAiStoryboard) dom.mtAiStoryboard.textContent = aiData?.notice || '内容分析依据字幕与语音。画面、镜头及音乐没有进行视觉识别。';
            if (dom.mtAiRecommendations) dom.mtAiRecommendations.textContent = aiData?.recommendations || '分析完成后显示基于内容的学习建议。';
        }

        seekVideo(sec) {
            const frame = document.getElementById('mt-bili-frame');
            if (frame) {
                const url = new URL(frame.src);
                url.searchParams.set('t', Math.floor(sec));
                frame.src = url.toString();
            } else if (dom.mtNativeVideo) {
                dom.mtNativeVideo.currentTime = sec;
                dom.mtNativeVideo.play().catch(() => {});
            }
        }

        async pollJob(kind, data, onUpdate, signal) {
            const payload = await readApi('/api/media/jobs', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: data.url, mediaId: data.mediaId, kind }) });
            let job = payload.job;
            while (true) {
                onUpdate?.(job);
                if (job.status === 'complete') return job;
                if (job.status === 'failed') throw new Error(job.error || job.message);
                await new Promise((resolve, reject) => {
                    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, 1200);
                    const cancel = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
                    if (signal?.aborted) return cancel();
                    signal?.addEventListener('abort', cancel, { once: true });
                });
                job = (await readApi('/api/media/jobs/' + job.id, { signal })).job;
            }
        }

        async runAnalysis(data, sequence = this.sequence) {
            this.analysisAbort?.abort();
            this.analysisAbort = new AbortController();
            const status = document.getElementById('mt-analysis-status');
            document.getElementById('mt-btn-retry-analysis')?.classList.add('hidden');
            let renderedCount = 0;
            try {
                const job = await this.pollJob('analyze', data, current => {
                    if (sequence !== this.sequence) return;
                    if (status) status.textContent = current.message + ' · ' + current.progress + '%';
                    if (current.transcript && current.transcript.lineCount !== renderedCount) {
                        const scrollTop = dom.mtTranscriptTimeline?.scrollTop || 0;
                        this.renderTranscript(current.transcript, data.title);
                        if (dom.mtTranscriptTimeline) dom.mtTranscriptTimeline.scrollTop = scrollTop;
                        renderedCount = current.transcript.lineCount;
                    }
                }, this.analysisAbort.signal);
                if (sequence !== this.sequence) return;
                data.transcript = job.transcript;
                data.aiAnalysis = job.analysis;
                this.renderTranscript(job.transcript, data.title);
                this.renderAiInsights(job.analysis, data);
                if (status) status.textContent = (job.analysis?.method === 'extractive' ? '转写完成 · 原句摘录（非AI语义总结）'
                    : job.analysis?.method === 'textrank' ? '转写完成 · 本地语义摘要（TextRank，无神经模型）'
                    : '完成 · AI语义总结') + ' · ' + (job.transcript.source === 'platform-subtitles' ? '平台字幕' : '原声语音识别') + ' · ' + job.transcript.lineCount + '句' + (job.transcript.notice ? ' · ' + job.transcript.notice : '');
                if (job.accountWriteFailed) showToast('分析已完成，但账户配额/历史记录写入失败，请检查存储环境', 'warning');
                initUserSession(); this.renderHistory();
            } catch (error) {
                if (error.name === 'AbortError' || sequence !== this.sequence) return;
                if (status) status.textContent = '分析失败：' + error.message;
                document.getElementById('mt-btn-retry-analysis')?.classList.remove('hidden');
                this.renderAiInsights(null, data);
            }
        }

        async prepareDownload(kind, button) {
            const data = this.activeData;
            if (!data) return;
            const original = button?.innerHTML;
            const owner = state.user?.username || null;
            if (button) button.disabled = true;
            try {
                const job = await this.pollJob(kind, data, current => {
                    if (button) button.textContent = current.message + ' ' + current.progress + '%';
                });
                if ((state.user?.username || null) !== owner) return;
                if (!job.downloadUrl) throw new Error('文件尚未生成');
                this.triggerDownload(job.downloadUrl, data.title);
                if (kind === 'download' && data === this.activeData && dom.mtNativeVideo) {
                    document.getElementById('mt-bili-frame')?.remove();
                    dom.mtNativeVideo.classList.remove('hidden');
                    dom.mtNativeVideo.src = job.downloadUrl;
                }
                showToast(kind === 'download' ? (job.hasAudio === false ? '已生成 MP4（原视频没有音轨）' : '已生成有声 MP4，开始下载') : '已转换为 MP3，开始下载', 'success');
                if (job.accountWriteFailed) showToast('媒体已生成，但账户配额/历史记录写入失败，请检查存储环境', 'warning');
            } catch (error) { showToast(error.message, 'error'); }
            finally { if (button) { button.innerHTML = original; button.disabled = false; } initUserSession(); this.renderHistory(); }
        }

        switchMultiPage(data, pIndex) {
            const pageItem = data.pages?.[pIndex];
            if (!pageItem) return;
            const url = new URL(data.url);
            url.searchParams.set('p', pageItem.page);
            this.extract(url.toString());
        }

        renderImagePanel(data) {
            dom.mtPanelVideo?.classList.add('hidden');
            dom.mtPanelImage?.classList.remove('hidden');
            dom.mtPanelAudio?.classList.add('hidden');

            if (dom.mtImgTitle) dom.mtImgTitle.textContent = data.title || '小红书/抖音图文笔记';
            const images = data.images || [];
            if (dom.mtImgCount) dom.mtImgCount.textContent = images.length;

            if (dom.mtBtnDownloadBgm) {
                const hasBgm = Boolean(data.originDownloadAudioUrl || data.downloadAudioUrl);
                dom.mtBtnDownloadBgm.classList.toggle('hidden', !hasBgm);
            }

            if (dom.mtImageGallery) {
                dom.mtImageGallery.innerHTML = images.map((img, idx) => {
                    const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(img.url)}`;
                    return `
                        <div class="galaxy-image-card">
                            <div class="img-preview-box" data-full="${escapeHtml(img.url)}" data-index="${idx + 1}">
                                <img src="${escapeHtml(proxyUrl)}" alt="原图 ${idx + 1}" loading="lazy" decoding="async" class="note-thumb">
                                <span class="img-idx-badge">#${idx + 1}</span>
                                <div class="img-zoom-overlay"><i class="fa-solid fa-magnifying-glass-plus"></i> 查看大图</div>
                            </div>
                            <div class="img-card-actions">
                                <button class="btn-dl-single-img" data-url="${escapeHtml(img.url)}" data-idx="${idx + 1}">
                                    <i class="fa-solid fa-arrow-down-to-line"></i> 下载此原图
                                </button>
                            </div>
                        </div>
                    `;
                }).join('');

                // Bind single image download & zoom
                dom.mtImageGallery.querySelectorAll('.img-preview-box').forEach(box => {
                    box.addEventListener('click', () => {
                        const fullUrl = box.dataset.full;
                        const idx = parseInt(box.dataset.index, 10) - 1;
                        this.openLightbox(fullUrl, `${data.title || '原图'}`, idx);
                    });
                });

                dom.mtImageGallery.querySelectorAll('.btn-dl-single-img').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const imgUrl = btn.dataset.url;
                        const idx = btn.dataset.idx;
                        this.downloadSingleImage(imgUrl, `${data.title || 'image'}_${idx}`);
                    });
                });
            }
        }

        renderAudioPanel(data) {
            dom.mtPanelVideo?.classList.add('hidden');
            dom.mtPanelImage?.classList.add('hidden');
            dom.mtPanelAudio?.classList.remove('hidden');

            if (dom.mtAudioTitle) dom.mtAudioTitle.textContent = data.title || '纯音频节目';
            const audioUrl = data.playVideoUrl || data.downloadAudioUrl || data.originDownloadAudioUrl;
            if (dom.mtNativeAudio && audioUrl) {
                dom.mtNativeAudio.src = audioUrl;
                dom.mtNativeAudio.load();
            }
        }

        openLightbox(imgUrl, title, index = 0) {
            if (!dom.mtLightboxModal || !dom.mtLightboxImg) return;
            this.lightboxIndex = index;
            const images = this.activeData?.images || [];
            const curImg = (images[index] && images[index].url) ? images[index].url : imgUrl;
            const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(curImg)}`;
            dom.mtLightboxImg.src = proxyUrl;
            const displayTitle = images.length > 1 ? `${title || '原图'} (${index + 1}/${images.length})` : (title || '大图预览');
            if (dom.mtLightboxTitle) dom.mtLightboxTitle.textContent = displayTitle;
            if (dom.mtLightboxDownload) {
                dom.mtLightboxDownload.href = '#';
                dom.mtLightboxDownload.onclick = event => { event.preventDefault(); this.downloadSingleImage(curImg, `${title || 'image'}_${index + 1}`); };
            }
            dom.mtLightboxModal.classList.remove('hidden');
        }

        navigateLightbox(direction) {
            const images = this.activeData?.images || [];
            if (images.length <= 1) return;
            let nextIndex = (this.lightboxIndex || 0) + direction;
            if (nextIndex < 0) nextIndex = images.length - 1;
            if (nextIndex >= images.length) nextIndex = 0;
            this.openLightbox(images[nextIndex].url, this.activeData.title, nextIndex);
        }

        async readOriginalImage(url) {
            const response = await fetch('/api/proxy-image?download=1&url=' + encodeURIComponent(url));
            if (!response.ok) throw new Error('原图接口返回HTTP ' + response.status);
            const blob = await response.blob();
            const extensions = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp', 'image/gif':'gif', 'image/avif':'avif' };
            if (!blob.size || !extensions[blob.type]) throw new Error('未取得可验证的原图，不能下载占位图片');
            return { blob, ext:extensions[blob.type] };
        }

        saveBlob(blob, filename) {
            const url = URL.createObjectURL(blob), anchor = document.createElement('a');
            anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }

        async downloadSingleImage(url, title) {
            try { const image = await this.readOriginalImage(url); this.saveBlob(image.blob, (title || 'image').replace(/[\\/:*?"<>|]/g,'_') + '.' + image.ext); this.renderHistory(); }
            catch (error) { showToast(error.message, 'error'); }
        }

        async downloadAllImagesAsZip(title, images) {
            if (typeof JSZip === 'undefined') return showToast('图片打包组件不可用', 'error');
            const zip = new JSZip(), clean = (title || 'images').replace(/[\\/:*?"<>|]/g,'_'), failures = [];
            let completed = 0, cursor = 0;
            showToast('正在获取并核验 ' + images.length + ' 张实际原图', 'info');
            await Promise.all(Array.from({length:Math.min(3,images.length)}, async () => {
                while (cursor < images.length) {
                    const index = cursor++;
                    try { const image = await this.readOriginalImage(images[index].url); zip.file(clean + '_' + (index+1) + '.' + image.ext, image.blob); completed++; }
                    catch (error) { failures.push('第' + (index+1) + '张：' + error.message); }
                }
            }));
            if (!completed) return showToast('全部原图获取失败，未生成空ZIP或占位图ZIP', 'error');
            if (failures.length) zip.file('FAILED.txt', failures.join('\n'));
            this.saveBlob(await zip.generateAsync({type:'blob'}), clean + (failures.length ? '_部分原图.zip' : '_全部原图.zip'));
            showToast('已打包真实原图 ' + completed + ' / ' + images.length + ' 张' + (failures.length ? '；缺失记录见FAILED.txt' : ''), failures.length ? 'warning' : 'success');
            this.renderHistory();
        }

        // 服务端按账号隔离的实际处理记录；解析、生成与发送状态不混为“已下载”。
        async removeHistoryItem(id) {
            try { await readApi('/api/media/history/' + encodeURIComponent(id), { method: 'DELETE' }); await this.renderHistory(); }
            catch (error) { showToast(error.message, 'error'); }
        }

        async clearHistory() {
            try { await readApi('/api/media/history', { method: 'DELETE' }); await this.renderHistory(); showToast('当前会话处理记录已清空', 'info'); }
            catch (error) { showToast(error.message, 'error'); }
        }

        async renderHistory() {
            if (!dom.mtHistoryList) return;
            const owner = state.user?.username || null;
            try {
                const response = await readApi('/api/media/history');
                if ((state.user?.username || null) !== owner) return;
                const note=document.getElementById('mt-visitor-status');
                if(note)note.textContent=response.visitor?'免登录访客 · 当前浏览器会话 · 今日剩余 '+response.quota.remaining+' / '+response.quota.limit+' 次处理；解析和新任务分别计次，失败退回。':'当前账号的实际处理记录与额度；访客无需注册也可使用。';
                const list = response.list || [];
                if (dom.mtHistoryCount) dom.mtHistoryCount.textContent = list.length;
                const statuses = { parsed: '已解析（尚未下载）', prepared: '已生成结果', sent: '服务端已发送文件（不代表已保存到磁盘）', streamed:'已发送媒体预览/片段', failed: '处理失败' };
                const kinds = { parse: '媒体解析', analyze: '字幕与内容分析', transcript: '字幕转写', download: 'MP4生成', audio: 'MP3转码', 'direct-download': '直接文件发送' };
                dom.mtHistoryList.innerHTML = list.length ? list.map(item =>
                    '<div class="history-item-row"><div class="hist-info"><div class="hist-title-row"><span class="hist-plat-badge">' + escapeHtml(kinds[item.kind] || item.kind) + '</span><span class="hist-title">' + escapeHtml(item.title || '处理记录') + '</span></div><span class="hist-time">' + escapeHtml(statuses[item.status] || item.status) + ' · ' + new Date(item.timestamp).toLocaleString() + '</span></div><div class="hist-actions">' +
                    (item.url ? '<button class="btn-hist-reparse" data-url="' + escapeHtml(item.url) + '">重新解析</button>' : '') +
                    '<button class="btn-hist-del" data-id="' + escapeHtml(item.id) + '">删除记录</button></div></div>'
                ).join('') : '<p class="history-empty">当前会话暂无实际处理记录；粘贴公开视频链接即可分析或下载，无需登录。</p>';
                dom.mtHistoryList.querySelectorAll('.btn-hist-reparse').forEach(button => button.addEventListener('click', () => { dom.mtInputUrl.value = button.dataset.url; this.extract(button.dataset.url); }));
                dom.mtHistoryList.querySelectorAll('.btn-hist-del').forEach(button => button.addEventListener('click', () => this.removeHistoryItem(button.dataset.id)));
            } catch (error) {
                if ((state.user?.username || null) === owner) dom.mtHistoryList.textContent = '处理记录读取失败：' + error.message;
            }
        }

        async fetchTodayStats() {
            try {
                const res = await fetch('/api/stats/today');
                const data = await res.json();
                if (data && data.success) {
                    if (dom.mtTodayTotalCount) {
                        dom.mtTodayTotalCount.textContent = Number(data.totalCount || 0).toLocaleString();
                    }
                    if (dom.mtTodayPlatforms && data.platforms) {
                        dom.mtTodayPlatforms.innerHTML = `
                            <div class="stat-pill"><span class="pill-dot dy"></span> 抖音 <strong>${data.platforms.douyin || 0}</strong></div>
                            <div class="stat-pill"><span class="pill-dot bili"></span> B站 <strong>${data.platforms.bilibili || 0}</strong></div>
                            <div class="stat-pill"><span class="pill-dot xhs"></span> 小红书 <strong>${data.platforms.xiaohongshu || 0}</strong></div>
                            <div class="stat-pill"><span class="pill-dot ks"></span> 快手 <strong>${data.platforms.kuaishou || 0}</strong></div>
                        `;
                    }
                }
            } catch (e) {
                console.warn('[Stats] Failed to fetch today stats:', e);
            }
        }
    }

    const heatHubDownloaderController = new HeatHubDownloaderController();
    window.heatHubDownloaderController = heatHubDownloaderController;
    window.galaxyDownloaderController = heatHubDownloaderController; // backward compatibility alias


    // ── Main View Switching Engine ──────────────────────────────────
    function switchMainView(view) {
        state.view = view;
        dom.platformTitle.textContent=view==='globe'?'热点地球':view==='mediatools'?'媒体工作台':(PLATFORM_CONFIG[state.platform]?.name || state.platform);
        document.getElementById('ranking-context')?.classList.toggle('hidden',view!=='feed');
        document.getElementById('source-status')?.classList.toggle('hidden',view!=='feed');
        dom.viewSwitchBtns.forEach(b => {
            b.classList.toggle('active', b.dataset.view === view);
        });

        // Update sidebar nav active state
        if (dom.btnNavMediatools) {
            dom.btnNavMediatools.classList.toggle('active', view === 'mediatools');
        }
        if (view !== 'mediatools') {
            dom.navBtns.forEach(b => {
                if (b.dataset.platform === state.platform) b.classList.add('active');
                else if (b.dataset.platform) b.classList.remove('active');
            });
        } else {
            dom.navBtns.forEach(b => {
                if (b.dataset.platform) b.classList.remove('active');
            });
        }

        // Pause any active background playback when switching views
        if (view !== 'mediatools') {
            if (dom.mtNativeVideo) dom.mtNativeVideo.pause();
            if (dom.mtNativeAudio) dom.mtNativeAudio.pause();
        }

        if (view === 'globe') {
            dom.gridScrollArea?.classList.add('hidden');
            dom.categoryFiltersContainer?.classList.add('hidden');
            dom.mediatoolsView?.classList.add('hidden');
            dom.globeView?.classList.remove('hidden');
            if (!globeRadar.isInitialized && dom.globeStage) {
                globeRadar.init(dom.globeStage);
            }
            globeRadar.updatePoints(state.geoHotspots);
            globeRadar.globe?.resumeAnimation();
            requestAnimationFrame(() => globeRadar.resizeHandler?.());
            loadGeoHotspots();
        } else if (view === 'mediatools') {
            globeRadar.globe?.pauseAnimation();
            dom.globeView?.classList.add('hidden');
            dom.gridScrollArea?.classList.add('hidden');
            dom.categoryFiltersContainer?.classList.add('hidden');
            dom.mediatoolsView?.classList.remove('hidden');
        } else {
            globeRadar.globe?.pauseAnimation();
            dom.globeView?.classList.add('hidden');
            dom.mediatoolsView?.classList.add('hidden');
            dom.categoryFiltersContainer?.classList.remove('hidden');
            dom.gridScrollArea?.classList.remove('hidden');
        }
    }

    // ── Event Bindings ──────────────────────────────────────────────
    function bindEvents() {
        // Init I18n Engine & User Center & Downloader
        i18n.init();
        userCenterController.init();
        heatHubDownloaderController.init();
        document.getElementById('mt-btn-retry-analysis')?.addEventListener('click', () => {
            if (heatHubDownloaderController.activeData) heatHubDownloaderController.runAnalysis(heatHubDownloaderController.activeData);
        });

        // Platform Navigation
        dom.navBtns.forEach(btn => {
            const accessibleName = btn.querySelector('.nav-btn-name')?.textContent?.trim();
            if (accessibleName) { btn.setAttribute('aria-label', accessibleName); btn.title = accessibleName; }
            btn.addEventListener('click', () => {
                const plat = btn.dataset.platform;
                if (!plat) return;
                if (plat === state.platform && state.view === 'feed') return;

                dom.navBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                dom.btnNavMediatools?.classList.remove('active');

                state.platform = plat;
                const config = PLATFORM_CONFIG[plat] || { name: plat, color: '#38bdf8' };
                if (dom.platformTitle) dom.platformTitle.textContent = config.name;
                if (dom.platformStatusBadge) dom.platformStatusBadge.textContent = config.badge || '实时聚合中';

                // Set Accent Color
                document.documentElement.style.setProperty('--accent', config.color);
                document.documentElement.style.setProperty('--glow', config.glow);

                // Switch to Feed view when clicking a platform
                switchMainView('feed');
                loadData(true);
            });
        });

        // Sidebar MediaTools Nav Button
        if (dom.btnNavMediatools) {
            dom.btnNavMediatools.addEventListener('click', () => {
                switchMainView('mediatools');
            });
        }

        // Metric Mode Toggle
        dom.btnMetricSingle?.addEventListener('click', () => {
            if (state.metricMode === 'single') return;
            state.metricMode = 'single';
            dom.btnMetricSingle.classList.add('active');
            dom.btnMetricTopic?.classList.remove('active');
            dom.btnMetricCollected?.classList.remove('active');
            switchMainView('feed');
            loadData(true);
        });

        dom.btnMetricTopic?.addEventListener('click', () => {
            if (state.metricMode === 'topic') return;
            state.metricMode = 'topic';
            dom.btnMetricTopic.classList.add('active');
            dom.btnMetricSingle?.classList.remove('active');
            dom.btnMetricCollected?.classList.remove('active');
            switchMainView('feed');
            loadData(true);
        });
        document.getElementById('btn-empty-topics')?.addEventListener('click', () => dom.btnMetricTopic?.click());
        dom.btnMetricCollected?.addEventListener('click', () => {
            if (state.metricMode === 'collected') return;
            state.metricMode = 'collected';
            dom.btnMetricCollected.classList.add('active');
            dom.btnMetricSingle?.classList.remove('active');
            dom.btnMetricTopic?.classList.remove('active');
            switchMainView('feed');
            loadData(true);
        });

        // Back from Topic Drilldown
        dom.btnBackToTopics?.addEventListener('click', closeTopicDrilldown);

        // Search Input
        dom.searchInput?.addEventListener('input', (e) => {
            dom.searchClearBtn?.classList.toggle('hidden', !e.target.value);
        });

        dom.searchBtn?.addEventListener('click', () => {
            state.searchQuery = dom.searchInput?.value.trim() || '';
            switchMainView('feed');
            loadData(true);
        });

        dom.searchInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                state.searchQuery = dom.searchInput?.value.trim() || '';
                switchMainView('feed');
                loadData(true);
            }
        });

        dom.searchClearBtn?.addEventListener('click', () => {
            if (dom.searchInput) dom.searchInput.value = '';
            dom.searchClearBtn?.classList.add('hidden');
            state.searchQuery = '';
            loadData(true);
        });

        // Global Shortcuts: Ctrl + K, Escape for modals, ArrowLeft/ArrowRight for Lightbox
        window.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                dom.searchInput?.focus();
            } else if (e.key === 'Escape') {
                if (dom.mtLightboxModal && !dom.mtLightboxModal.classList.contains('hidden')) {
                    dom.mtLightboxModal.classList.add('hidden');
                    return;
                }
                if (dom.playerModal && !dom.playerModal.classList.contains('hidden')) {
                    closePlayerModal();
                    return;
                }
                if (dom.settingsModal && !dom.settingsModal.classList.contains('hidden')) {
                    dom.settingsModal.classList.add('hidden');
                    return;
                }
                if (dom.profileModal && !dom.profileModal.classList.contains('hidden')) {
                    dom.profileModal.classList.add('hidden');
                    return;
                }
                if (dom.benefitsModal && !dom.benefitsModal.classList.contains('hidden')) {
                    dom.benefitsModal.classList.add('hidden');
                    return;
                }
                if (dom.authModal && !dom.authModal.classList.contains('hidden')) {
                    dom.authModal.classList.add('hidden');
                    return;
                }
                if (dom.userCenterDropdown && !dom.userCenterDropdown.classList.contains('hidden')) {
                    dom.userCenterDropdown.classList.add('hidden');
                    dom.userCenterWrapper?.classList.remove('active');
                    return;
                }
                if (dom.detailDrawer && !dom.detailDrawer.classList.contains('hidden')) {
                    dom.detailDrawer.classList.add('hidden');
                    return;
                }
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                if (dom.mtLightboxModal && !dom.mtLightboxModal.classList.contains('hidden')) {
                    heatHubDownloaderController.navigateLightbox(e.key === 'ArrowLeft' ? -1 : 1);
                }
            }
        });

        // Category Chips
        dom.filterChips?.forEach(chip => {
            chip.addEventListener('click', () => {
                dom.filterChips.forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                state.category = chip.dataset.category;
                switchMainView('feed');
                loadData(true);
            });
        });

        // Time Chips
        dom.timeChips?.forEach(chip => {
            chip.addEventListener('click', () => {
                dom.timeChips.forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                state.timeRange = chip.dataset.time;
                switchMainView('feed');
                loadData(true);
            });
        });

        // View Switcher (Feed vs 3D Globe vs MediaTools)
        dom.viewSwitchBtns?.forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;
                switchMainView(view);
            });
        });

        // Refresh Button
        dom.refreshBtn?.addEventListener('click', () => {
            loadData(true, true);
        });

        // Scroll Pagination
        dom.gridScrollArea?.addEventListener('scroll', handleScrollPagination);

        // Player Modal Danmaku Controls
        dom.modalDanmakuToggle?.addEventListener('click', () => {
            danmakuEngine.toggle(dom.modalDanmakuScreen, dom.modalDanmakuToggle);
        });

        dom.modalDanmakuSend?.addEventListener('click', sendModalDanmaku);
        dom.modalDanmakuInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') sendModalDanmaku();
        });

        function sendModalDanmaku() {
            const val = dom.modalDanmakuInput?.value.trim();
            if (!val) return;
            danmakuEngine.emit(dom.modalDanmakuScreen, val, true);
            if (dom.modalDanmakuInput) dom.modalDanmakuInput.value = '';
            showToast('弹幕发射成功！', 'success');
        }

        // Close Player Modal
        dom.closePlayerModalBtn?.addEventListener('click', closePlayerModal);
        dom.playerModal?.addEventListener('click', (e) => {
            if (e.target === dom.playerModal) closePlayerModal();
        });

        // Player Modal Action Tools
        dom.modalCopyLinkBtn?.addEventListener('click', () => copyVideoLink(state.activeVideo));
        dom.modalSniffBtn?.addEventListener('click', () => sniffVideoDirectStream(state.activeVideo, dom.modalSniffBtn));
        dom.modalDownloadBtn?.addEventListener('click', () => downloadVideo(state.activeVideo));

        // Drawer Action Tools
        if (dom.btnCopyLink) dom.btnCopyLink.addEventListener('click', () => copyVideoLink(state.activeVideo));
        if (dom.btnParseStream) dom.btnParseStream.addEventListener('click', () => sniffVideoDirectStream(state.activeVideo, dom.btnParseStream));
        if (dom.btnDownloadVideo) dom.btnDownloadVideo.addEventListener('click', () => downloadVideo(state.activeVideo));
        if (dom.btnCopyStream) dom.btnCopyStream.addEventListener('click', () => {
            navigator.clipboard.writeText(dom.streamUrlInput?.value || '').then(() => {
                showToast('已复制视频直链地址！', 'success');
            });
        });
        if (dom.closeDrawerBtn) dom.closeDrawerBtn.addEventListener('click', () => {
            dom.detailDrawer?.classList.add('hidden');
        });

        // Settings Modal
        dom.settingsBtn?.addEventListener('click', () => {
            dom.settingsModal?.classList.remove('hidden');
        });
        dom.closeModalBtn?.addEventListener('click', () => {
            dom.settingsModal?.classList.add('hidden');
        });
        dom.settingsModal?.addEventListener('click', (e) => {
            if (e.target === dom.settingsModal) dom.settingsModal.classList.add('hidden');
        });
        dom.btnSaveSettings?.addEventListener('click', saveSettings);
        dom.proxyPills?.forEach(pill => {
            pill.addEventListener('click', () => {
                if (dom.settingProxy) dom.settingProxy.value = pill.dataset.url;
            });
        });

        // Auth Modal & Role Switching
        dom.openLoginBtn?.addEventListener('click', () => {
            dom.authModal.classList.remove('hidden');
        });
        dom.closeAuthModalBtn?.addEventListener('click', () => {
            dom.authModal.classList.add('hidden');
        });
        dom.authModal?.addEventListener('click', (e) => {
            if (e.target === dom.authModal) dom.authModal.classList.add('hidden');
        });


        dom.authTabs?.forEach(tab => {
            tab.addEventListener('click', () => {
                dom.authTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const target = tab.dataset.tab;
                dom.loginForm.classList.toggle('hidden', target !== 'login');
                dom.registerForm.classList.toggle('hidden', target !== 'register');
            });
        });

        // Login Form
        dom.loginForm?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = dom.loginUsername.value.trim();
            const password = dom.loginPassword.value;
            try {
                const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await res.json();
                if (data.success) {
                    setUserSession(data.user);
                    showToast(`欢迎回来，${data.user.nickname || data.user.username}`, 'success');
                    dom.authModal.classList.add('hidden');
                } else {
                    dom.loginMsgBox.textContent = data.message || '登录失败';
                    dom.loginMsgBox.className = 'auth-message-box error';
                    dom.loginMsgBox.classList.remove('hidden');
                }
            } catch (err) {
                showToast('登录请求失败', 'error');
            }
        });

        // Register Form
        dom.registerForm?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = dom.regUsername.value.trim();
            const nickname = dom.regNickname.value.trim() || username;
            const password = dom.regPassword.value;
            try {
                const res = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, nickname, password })
                });
                const data = await res.json();
                if (data.success) {
                    setUserSession(data.user);
                    showToast(`注册成功！欢迎加入，${data.user.nickname}`, 'success');
                    dom.authModal.classList.add('hidden');
                } else {
                    dom.regMsgBox.textContent = data.message || '注册失败';
                    dom.regMsgBox.className = 'auth-message-box error';
                    dom.regMsgBox.classList.remove('hidden');
                }
            } catch (err) {
                showToast('注册请求失败', 'error');
            }
        });

        // Legacy Logout button in auth if any
        dom.authLogoutBtn?.addEventListener('click', () => {
            userCenterController.logout();
        });
    }

    // ── Application Bootstrapping ───────────────────────────────────
    async function loadPlatformCapabilities() {
        try {
            const result = await readApi('/api/platforms');
            for (const item of result.list || []) {
                const button = document.querySelector('.nav-btn[data-platform="' + item.platform + '"]');
                if (!button) continue;
                const subtitle = button.querySelector('.nav-btn-sub');
                const status=item.verification?.videos?.status;
                const quality = item.verification?.videos?.dataQuality;
                if (subtitle) subtitle.textContent = status==='unavailable' ? '视频源受限 · 查看状态' : quality ? `${quality.videos}件视频 · ${quality.withViews}件有播放量` : item.label;
                button.title = item.label + '；排名仅覆盖实际检索作品，非全站历史总榜。';
            }
        } catch { /* 平台说明失败不阻止真实作品加载。 */ }
    }

    async function init() {
        bindEvents();
        document.getElementById('btn-load-more')?.addEventListener('click',()=>loadNextPage());
        document.getElementById('geo-scope')?.addEventListener('change',()=>loadGeoHotspots());
        document.getElementById('geo-refresh')?.addEventListener('click',()=>loadGeoHotspots());
        document.getElementById('ranking-metric')?.addEventListener('change',event=>{state.sortBy=VideoRanking.metric(event.target.value);loadData();});
        document.getElementById('geo-zoom-in')?.addEventListener('click',()=>globeRadar.zoom(0.5));
        document.getElementById('geo-zoom-out')?.addEventListener('click',()=>globeRadar.zoom(2));
        document.getElementById('geo-reset-view')?.addEventListener('click',()=>globeRadar.resetView());
        document.getElementById('geo-basemap')?.addEventListener('change',event=>globeRadar.setBasemap(event.target.value));
        document.getElementById('geo-countries')?.addEventListener('change',()=>globeRadar.updateCountries());
        for(const id of ['system-status-modal','account-edit-modal','platform-connect-modal']) {
            const modal=document.getElementById(id);
            modal?.addEventListener('click',event=>{if(event.target===modal)modal.classList.add('hidden');});
        }
        window.addEventListener('keydown',event=>{if(event.key==='Escape')for(const id of ['system-status-modal','account-edit-modal','platform-connect-modal'])document.getElementById(id)?.classList.add('hidden');});
        document.getElementById('btn-platform-connect')?.addEventListener('click',()=>document.getElementById('platform-connect-modal').classList.remove('hidden'));
        document.getElementById('close-platform-connect')?.addEventListener('click',()=>document.getElementById('platform-connect-modal').classList.add('hidden'));
        document.getElementById('btn-system-status')?.addEventListener('click', async () => {
            document.getElementById('system-status-modal').classList.remove('hidden');
            const body=document.getElementById('system-status-body'); body.textContent='正在读取当前实际状态…';
            try {
                const data=await readApi('/api/system/status');
                const statuses={ok:'已读取真实数据',partial:'部分源失败',cached:'真实缓存（非实时）',unavailable:'未取得数据','not-verified':'尚未实测'};
                body.innerHTML='<p>账号为真实服务端会话；没有演示提权。语音模型配置：'+(data.media.asr?'存在':'缺失')+'；语义模型配置：'+(data.media.localAnalysis?'存在':'缺失')+'。模型存在不代表本次分析已通过，结果需查看实际任务。</p><p>'+escapeHtml(data.note)+'</p>'+
                    data.platforms.map(p=>'<div class="source-check"><strong>'+escapeHtml(PLATFORM_CONFIG[p.platform]?.name || p.platform)+'</strong><p>视频：'+escapeHtml(statuses[p.verification.videos.status] || p.verification.videos.status)+'；话题：'+(p.topics==='unavailable'?'尚未接通':escapeHtml(statuses[p.verification.topics.status] || p.verification.topics.status))+'</p>'+(p.verification.videos.dataQuality?'<p>本次 '+Number(p.verification.videos.dataQuality.videos)+' 件视频，'+Number(p.verification.videos.dataQuality.withViews)+' 件有真实播放量，'+Number(p.verification.videos.dataQuality.withoutViews)+' 件未取得播放量。视频信息可见不等于播放数据可用。</p>':'')+'<p>'+escapeHtml(p.verification.videos.message || p.label)+'</p></div>').join('');
            } catch(error){body.textContent='状态读取失败：'+error.message;}
        });
        document.getElementById('close-system-status')?.addEventListener('click',()=>document.getElementById('system-status-modal').classList.add('hidden'));
        document.getElementById('btn-account-edit')?.addEventListener('click', () => {
            if (!requireLogin()) return;
            dom.profileModal?.classList.add('hidden');
            document.getElementById('profile-edit-nickname').value = state.user.nickname;
            document.getElementById('account-edit-modal').classList.remove('hidden');
        });
        document.getElementById('close-account-edit')?.addEventListener('click', () => document.getElementById('account-edit-modal').classList.add('hidden'));
        document.getElementById('profile-edit-form')?.addEventListener('submit', async event => {
            event.preventDefault();
            try { const data = await readApi('/api/account/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: document.getElementById('profile-edit-nickname').value }) }); setUserSession(data.user); showToast('昵称已在服务端保存', 'success'); }
            catch (error) { showToast(error.message, 'error'); }
        });
        document.getElementById('account-password-form')?.addEventListener('submit', async event => {
            event.preventDefault();
            try { const data = await readApi('/api/account/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: document.getElementById('account-current-password').value, password: document.getElementById('account-new-password').value }) }); setUserSession(data.user); event.target.reset(); showToast('密码已修改，旧会话已失效', 'success'); }
            catch (error) { showToast(error.message, 'error'); }
        });
        loadPlatformCapabilities();
        await Promise.allSettled([initUserSession(),loadSettings(),loadData(true)]);
    }

    init();
});
