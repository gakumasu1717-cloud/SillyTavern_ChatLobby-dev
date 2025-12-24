// Chat Lobby Extension for SillyTavern
// 캐릭터 기반 채팅방 선택 UI + 페르소나 선택 + 폴더/분류 관리

(function() {
    'use strict';

    console.log('[Chat Lobby] Loading extension...');

    const extensionName = 'Chat Lobby';
    const extensionFolderPath = 'third-party/SillyTavern-ChatLobby';
    const STORAGE_KEY = 'chatLobby_data';
    
    // 모바일 감지
    const isMobile = () => window.innerWidth <= 768 || ('ontouchstart' in window);
    
    // 디바운스 헬퍼
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
    
    // 페르소나 선택 상태 추적 (전역)
    let isProcessingPersona = false;

    // ============================================
    // 폴더/분류 데이터 관리
    // ============================================
    
    // 기본 데이터 구조
    const defaultData = {
        folders: [
            { id: 'favorites', name: '⭐ 즐겨찾기', isSystem: true, order: 0 },
            { id: 'uncategorized', name: '📁 미분류', isSystem: true, order: 999 }
        ],
        chatAssignments: {}, // { "캐릭터avatar_채팅파일명": "폴더id" }
        favorites: [], // ["캐릭터avatar_채팅파일명", ...]
        sortOption: 'recent', // recent, created, name, favorites
        filterFolder: 'all', // all, favorites, 폴더id
        collapsedFolders: [], // 접힌 폴더 목록
        charSortOption: 'recent', // recent, name, created, chats - 캐릭터 정렬 옵션
        autoFavoriteRules: {
            recentDays: 0, // 0 = 비활성화, 3 = 최근 3일 사용 시 자동 즐겨찾기
        }
    };

    // 데이터 로드
    function loadLobbyData() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const data = JSON.parse(saved);
                // 기본값과 병합 (누락된 필드 보완)
                return { ...defaultData, ...data };
            }
        } catch (e) {
            console.error('[Chat Lobby] Failed to load data:', e);
        }
        return { ...defaultData };
    }

    // 데이터 저장
    function saveLobbyData(data) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.error('[Chat Lobby] Failed to save data:', e);
        }
    }

    // 채팅 키 생성 (캐릭터avatar_채팅파일명)
    function getChatKey(charAvatar, chatFileName) {
        return `${charAvatar}_${chatFileName}`;
    }

    // 폴더 추가
    function addFolder(name) {
        const data = loadLobbyData();
        const id = 'folder_' + Date.now();
        const maxOrder = Math.max(...data.folders.filter(f => !f.isSystem || f.id !== 'uncategorized').map(f => f.order), 0);
        data.folders.push({ id, name, isSystem: false, order: maxOrder + 1 });
        saveLobbyData(data);
        return id;
    }

    // 폴더 삭제
    function deleteFolder(folderId) {
        const data = loadLobbyData();
        const folder = data.folders.find(f => f.id === folderId);
        if (!folder || folder.isSystem) return false;
        
        // 해당 폴더의 채팅들을 미분류로 이동
        Object.keys(data.chatAssignments).forEach(key => {
            if (data.chatAssignments[key] === folderId) {
                data.chatAssignments[key] = 'uncategorized';
            }
        });
        
        data.folders = data.folders.filter(f => f.id !== folderId);
        saveLobbyData(data);
        return true;
    }

    // 폴더 이름 변경
    function renameFolder(folderId, newName) {
        const data = loadLobbyData();
        const folder = data.folders.find(f => f.id === folderId);
        if (!folder || folder.isSystem) return false;
        folder.name = newName;
        saveLobbyData(data);
        return true;
    }

    // 채팅을 폴더에 할당
    function assignChatToFolder(charAvatar, chatFileName, folderId) {
        const data = loadLobbyData();
        const key = getChatKey(charAvatar, chatFileName);
        data.chatAssignments[key] = folderId;
        saveLobbyData(data);
    }

    // 채팅의 폴더 가져오기
    function getChatFolder(charAvatar, chatFileName) {
        const data = loadLobbyData();
        const key = getChatKey(charAvatar, chatFileName);
        return data.chatAssignments[key] || 'uncategorized';
    }

    // 즐겨찾기 토글
    function toggleFavorite(charAvatar, chatFileName) {
        const data = loadLobbyData();
        const key = getChatKey(charAvatar, chatFileName);
        const index = data.favorites.indexOf(key);
        if (index > -1) {
            data.favorites.splice(index, 1);
        } else {
            data.favorites.push(key);
        }
        saveLobbyData(data);
        return index === -1; // 새로 추가되었으면 true
    }

    // 즐겨찾기 여부 확인
    function isFavorite(charAvatar, chatFileName) {
        const data = loadLobbyData();
        const key = getChatKey(charAvatar, chatFileName);
        return data.favorites.includes(key);
    }

    // 정렬 옵션 설정
    function setSortOption(option) {
        const data = loadLobbyData();
        data.sortOption = option;
        saveLobbyData(data);
    }

    // 캐릭터 정렬 옵션 설정
    function setCharSortOption(option) {
        const data = loadLobbyData();
        data.charSortOption = option;
        saveLobbyData(data);
    }

    // 캐릭터별 채팅 수 캐시 (성능 최적화)
    const chatCountCache = new Map();
    let chatCountCacheTime = 0;
    const CACHE_DURATION = 60000; // 1분

    // 캐릭터별 채팅 수 가져오기
    async function getCharacterChatCount(characterAvatar) {
        // 캐시 확인
        const now = Date.now();
        if (now - chatCountCacheTime > CACHE_DURATION) {
            chatCountCache.clear();
            chatCountCacheTime = now;
        }
        if (chatCountCache.has(characterAvatar)) {
            return chatCountCache.get(characterAvatar);
        }
        
        try {
            const chats = await loadChatsForCharacter(characterAvatar);
            const count = Array.isArray(chats) ? chats.length : Object.keys(chats || {}).length;
            chatCountCache.set(characterAvatar, count);
            return count;
        } catch (e) {
            return 0;
        }
    }

    // 필터 폴더 설정
    function setFilterFolder(folderId) {
        const data = loadLobbyData();
        data.filterFolder = folderId;
        saveLobbyData(data);
    }

    // 다중 채팅 이동
    function moveChatsBatch(chatKeys, targetFolderId) {
        const data = loadLobbyData();
        chatKeys.forEach(key => {
            data.chatAssignments[key] = targetFolderId;
        });
        saveLobbyData(data);
    }

    // ============================================
    // SillyTavern API 접근
    // ============================================
    
    const getContext = () => window.SillyTavern?.getContext?.() || null;
    
    // SillyTavern 요청 헤더 가져오기
    const getRequestHeaders = () => {
        // SillyTavern의 getRequestHeaders 함수 사용
        if (window.SillyTavern?.getContext) {
            const context = window.SillyTavern.getContext();
            if (context.getRequestHeaders) {
                return context.getRequestHeaders();
            }
        }
        // 대체 방법: 직접 헤더 구성
        return {
            'Content-Type': 'application/json',
            'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || '',
        };
    };

    // 폴더 목록 HTML 생성
    function getFoldersHTML() {
        const data = loadLobbyData();
        const sorted = [...data.folders].sort((a, b) => a.order - b.order);
        return sorted.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
    }

    // 로비 UI HTML - 3칸 그리드 레이아웃 (왼쪽: 페르소나+캐릭터, 오른쪽: 채팅목록)
    function createLobbyHTML() {
        return `
        <div id="chat-lobby-fab" title="Chat Lobby 열기">💬</div>
        <div id="chat-lobby-overlay" style="display: none;">
            <div id="chat-lobby-container">
                <div id="chat-lobby-header">
                    <h2>Chat Lobby</h2>
                    <div class="header-actions">
                        <button id="chat-lobby-refresh" title="새로고침">🔄</button>
                        <button id="chat-lobby-import-char" title="캐릭터 임포트">📥</button>
                        <button id="chat-lobby-add-persona" title="페르소나 추가">👤</button>
                        <button id="chat-lobby-close">✕</button>
                    </div>
                </div>
                <div id="chat-lobby-main">
                    <!-- 왼쪽 패널: 페르소나 + 캐릭터 -->
                    <div id="chat-lobby-left">
                        <div id="chat-lobby-persona-bar">
                            <div id="chat-lobby-persona-list">
                                <div class="lobby-loading">로딩 중...</div>
                            </div>
                        </div>
                        <div id="chat-lobby-search">
                            <input type="text" id="chat-lobby-search-input" placeholder="캐릭터 검색...">
                            <select id="chat-lobby-char-sort" title="캐릭터 정렬">
                                <option value="recent">🕒 최근 채팅순</option>
                                <option value="name">🔤 이름순</option>
                                <option value="created">📅 생성일순</option>
                                <option value="chats">💬 채팅 수</option>
                            </select>
                        </div>
                        <div id="chat-lobby-characters">
                            <div class="lobby-loading">캐릭터 로딩 중...</div>
                        </div>
                    </div>
                    <!-- 오른쪽 패널: 채팅 목록 (항상 표시) -->
                    <div id="chat-lobby-chats">
                        <div id="chat-lobby-chats-header">
                            <button id="chat-lobby-chats-back" title="뒤로">←</button>
                            <img src="" alt="avatar" id="chat-panel-avatar" title="캐릭터 설정" style="display:none;">
                            <div class="char-info">
                                <div class="char-name" id="chat-panel-name">캐릭터를 선택하세요</div>
                                <div class="chat-count" id="chat-panel-count"></div>
                            </div>
                            <button id="chat-lobby-delete-char" title="캐릭터 삭제" style="display:none;">🗑️</button>
                            <button id="chat-lobby-new-chat" style="display:none;">+ 새 채팅</button>
                        </div>
                        <div id="chat-lobby-folder-bar" style="display:none;">
                            <div class="folder-filter">
                                <select id="chat-lobby-folder-filter">
                                    <option value="all">📁 전체</option>
                                    <option value="favorites">⭐ 즐겨찾기</option>
                                </select>
                                <select id="chat-lobby-chat-sort">
                                    <option value="recent">🕐 최신순</option>
                                    <option value="name">🔤 이름순</option>
                                    <option value="messages">💬 메시지수</option>
                                </select>
                            </div>
                            <div class="folder-actions">
                                <button id="chat-lobby-batch-mode" title="다중 선택">☑️</button>
                                <button id="chat-lobby-folder-manage" title="폴더 관리">📁</button>
                            </div>
                        </div>
                        <div id="chat-lobby-batch-toolbar" style="display:none;">
                            <span id="batch-selected-count">0개 선택</span>
                            <select id="batch-move-folder">
                                <option value="">폴더 선택...</option>
                            </select>
                            <button id="batch-move-btn">이동</button>
                            <button id="batch-cancel-btn">취소</button>
                        </div>
                        <div id="chat-lobby-chats-list">
                            <div class="lobby-empty-state">
                                <i>💬</i>
                                <div>캐릭터를 선택하세요</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <!-- 폴더 관리 모달 -->
        <div id="chat-lobby-folder-modal" style="display:none;">
            <div class="folder-modal-content">
                <div class="folder-modal-header">
                    <h3>📁 폴더 관리</h3>
                    <button id="folder-modal-close">✕</button>
                </div>
                <div class="folder-modal-body">
                    <div class="folder-add-row">
                        <input type="text" id="new-folder-name" placeholder="새 폴더 이름...">
                        <button id="add-folder-btn">추가</button>
                    </div>
                    <div id="folder-list"></div>
                </div>
            </div>
        </div>
        `;
    }

    // 페르소나 목록 로드
    async function loadPersonas() {
        try {
            // API를 통해 페르소나 아바타 목록 가져오기
            const response = await fetch('/api/avatars/get', {
                method: 'POST',
                headers: getRequestHeaders(),
            });
            
            if (!response.ok) {
                console.error('[Chat Lobby] Failed to fetch personas:', response.status);
                return [];
            }
            
            const avatars = await response.json();
            console.log('[Chat Lobby] Raw avatars from API:', avatars);
            
            if (!Array.isArray(avatars)) {
                return [];
            }
            
            // power_user를 import해서 페르소나 이름 가져오기
            let personaNames = {};
            let sortOrder = 'asc';
            try {
                const powerUserModule = await import('../../../../power-user.js');
                personaNames = powerUserModule.power_user?.personas || {};
                sortOrder = powerUserModule.power_user?.persona_sort_order || 'asc';
                console.log('[Chat Lobby] power_user.personas:', personaNames);
            } catch (e) {
                console.log('[Chat Lobby] Could not import power_user:', e);
            }
            
            const personas = avatars.map(avatarId => {
                const name = personaNames[avatarId] || avatarId.replace('.png', '').replace('.jpg', '').replace('.webp', '');
                return { key: avatarId, name: name };
            });
            
            // 숫자 → 영문 → 한글 순 정렬
            personas.sort((a, b) => {
                const aName = a.name.toLowerCase();
                const bName = b.name.toLowerCase();
                
                // 첫 글자 타입 판별 (숫자=0, 영문=1, 한글=2, 기타=3)
                const getType = (str) => {
                    const c = str.charAt(0);
                    if (/[0-9]/.test(c)) return 0;
                    if (/[a-z]/.test(c)) return 1;
                    if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(c)) return 2;
                    return 3;
                };
                
                const typeA = getType(aName);
                const typeB = getType(bName);
                
                if (typeA !== typeB) return typeA - typeB;
                return aName.localeCompare(bName, 'ko');
            });
            
            console.log('[Chat Lobby] Final sorted personas:', personas);
            return personas;
        } catch (error) {
            console.error('[Chat Lobby] Failed to load personas:', error);
            return [];
        }
    }

    // 페르소나 선택 UI 업데이트 (가로 스크롤 - 아바타만)
    async function updatePersonaSelect() {
        const container = document.getElementById('chat-lobby-persona-list');
        if (!container) return;

        container.innerHTML = '<div class="lobby-loading">로딩 중...</div>';
        
        const personas = await loadPersonas();
        
        // 현재 페르소나 가져오기 - personas.js에서 직접 import
        let currentPersona = '';
        try {
            const personasModule = await import('../../../../personas.js');
            currentPersona = personasModule.user_avatar || '';
        } catch (e) {
            console.log('[Chat Lobby] Could not get user_avatar:', e);
        }

        if (personas.length === 0) {
            container.innerHTML = '<div class="persona-empty">페르소나 없음</div>';
            console.log('[Chat Lobby] No personas found');
            return;
        }
        
        console.log('[Chat Lobby] Current persona:', currentPersona);
        
        // 모든 페르소나 아바타 + 이름 + 삭제 버튼 표시
        let html = '';
        personas.forEach(persona => {
            const isSelected = persona.key === currentPersona ? 'selected' : '';
            const avatarUrl = `/User Avatars/${encodeURIComponent(persona.key)}`;
            html += `<div class="persona-item ${isSelected}" data-persona="${escapeHtml(persona.key)}" title="${escapeHtml(persona.name)}">
                <img class="persona-avatar" src="${avatarUrl}" alt="" onerror="this.outerHTML='<div class=persona-avatar>👤</div>'">
                <span class="persona-name">${escapeHtml(persona.name)}</span>
                <button class="persona-delete-btn" data-persona="${escapeHtml(persona.key)}" title="페르소나 삭제">×</button>
            </div>`;
        });
        
        container.innerHTML = html;
        
        // 클릭 이벤트 - 페르소나 선택 / 아바타 클릭 시 페르소나 관리
        container.querySelectorAll('.persona-item').forEach(item => {
            // 아바타 이미지 클릭 → 페르소나 관리 화면 (선택된 페르소나만)
            const avatarImg = item.querySelector('.persona-avatar');
            if (avatarImg) {
                // 터치 이벤트도 처리
                let avatarTouchHandled = false;
                
                const handleAvatarClick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    
                    // 중복 처리 방지
                    if (isProcessingPersona) {
                        console.log('[Chat Lobby] Already processing persona action, ignoring');
                        return false;
                    }
                    
                    // 현재 실제로 selected 클래스가 있는지 다시 확인
                    const isCurrentlySelected = item.classList.contains('selected');
                    console.log('[Chat Lobby] Avatar clicked, isSelected:', isCurrentlySelected);
                    
                    if (isCurrentlySelected) {
                        console.log('[Chat Lobby] Selected persona avatar clicked, opening management');
                        openPersonaManagement();
                    } else {
                        // 선택되지 않은 페르소나 아바타 클릭 → 해당 페르소나 선택
                        console.log('[Chat Lobby] Unselected persona avatar clicked, selecting persona');
                        isProcessingPersona = true;
                        container.querySelectorAll('.persona-item').forEach(el => el.classList.remove('selected'));
                        item.classList.add('selected');
                        changePersona(item.dataset.persona).finally(() => {
                            isProcessingPersona = false;
                        });
                    }
                    return false;
                };
                
                avatarImg.addEventListener('touchstart', () => { avatarTouchHandled = false; }, { passive: true });
                avatarImg.addEventListener('touchend', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    avatarTouchHandled = true;
                    handleAvatarClick(e);
                }, { capture: true });
                avatarImg.addEventListener('click', (e) => {
                    if (!avatarTouchHandled) {
                        handleAvatarClick(e);
                    }
                    avatarTouchHandled = false;
                }, { capture: true });
                avatarImg.style.cursor = 'pointer';
            }
            
            // 이름 클릭 → 페르소나 선택 (이미 선택된 경우 무시)
            const nameSpan = item.querySelector('.persona-name');
            if (nameSpan) {
                nameSpan.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // 이미 선택된 페르소나면 무시
                    if (item.classList.contains('selected')) return;
                    if (isProcessingPersona) return;
                    isProcessingPersona = true;
                    container.querySelectorAll('.persona-item').forEach(el => el.classList.remove('selected'));
                    item.classList.add('selected');
                    changePersona(item.dataset.persona).finally(() => {
                        isProcessingPersona = false;
                    });
                });
                nameSpan.style.cursor = 'pointer';
            }
            
            // 전체 아이템 클릭 → 페르소나 선택 (삭제 버튼, 아바타 제외, 이미 선택된 경우 무시)
            item.addEventListener('click', (e) => {
                if (e.target.classList.contains('persona-delete-btn')) return;
                if (e.target.classList.contains('persona-avatar')) return;
                if (e.target.tagName === 'IMG') return; // img 태그도 제외
                // 이미 선택된 페르소나면 무시
                if (item.classList.contains('selected')) return;
                if (isProcessingPersona) return;
                isProcessingPersona = true;
                container.querySelectorAll('.persona-item').forEach(el => el.classList.remove('selected'));
                item.classList.add('selected');
                changePersona(item.dataset.persona).finally(() => {
                    isProcessingPersona = false;
                });
            });
        });
        
        // 페르소나 삭제 버튼 이벤트
        container.querySelectorAll('.persona-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const personaKey = btn.dataset.persona;
                const personaName = btn.closest('.persona-item').title;
                deletePersona(personaKey, personaName);
            });
        });
        
        console.log('[Chat Lobby] Persona list updated with', personas.length, 'items');
    }

    // 페르소나 삭제 (로비 열린 상태에서 API로 직접 삭제)
    async function deletePersona(personaKey, personaName) {
        if (!confirm(`"${personaName}" 페르소나를 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`)) return;
        
        try {
            // API로 직접 페르소나 삭제
            const response = await fetch('/api/avatars/delete', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ avatar: personaKey })
            });
            
            if (response.ok) {
                console.log('[Chat Lobby] Persona deleted:', personaKey);
                // 페르소나 목록 새로고침
                await updatePersonaSelect();
            } else {
                console.error('[Chat Lobby] Failed to delete persona:', response.status);
                alert('페르소나 삭제에 실패했습니다.');
            }
        } catch (error) {
            console.error('[Chat Lobby] Failed to delete persona:', error);
            alert('페르소나 삭제 중 오류가 발생했습니다.');
        }
    }
    
    // 페르소나 관리 화면으로 이동 (페르소나 아바타 클릭 시)
    async function openPersonaManagement() {
        console.log('[Chat Lobby] === openPersonaManagement START ===' );
        
        // 로비 닫기
        closeLobby();
        
        // 지연 후 클릭
        await new Promise(resolve => setTimeout(resolve, 300));
        
        const personaDrawer = document.getElementById('persona-management-button');
        
        if (personaDrawer) {
            const drawerIcon = personaDrawer.querySelector('.drawer-icon');
            const drawerContent = personaDrawer.querySelector('.drawer-content');
            
            // 현재 drawer 상태 확인
            const isDrawerOpen = drawerContent && drawerContent.classList.contains('openDrawer');
            const isIconOpen = drawerIcon && drawerIcon.classList.contains('openIcon');
            console.log('[Chat Lobby] Drawer state - isDrawerOpen:', isDrawerOpen, 'isIconOpen:', isIconOpen);
            
            // 이미 열려있으면 아무것도 안 함
            if (isDrawerOpen || isIconOpen) {
                console.log('[Chat Lobby] Drawer already open, skipping');
                console.log('[Chat Lobby] === openPersonaManagement END ===');
                return;
            }
            
            // ST-CustomTheme이 drawer를 이동시켰는지 확인
            const isSTMoved = personaDrawer.classList.contains('st-hamburger-moved-drawer');
            console.log('[Chat Lobby] ST-CustomTheme moved drawer:', isSTMoved);
            
            if (isSTMoved) {
                // ST-CustomTheme 환경: hamburger 아이콘 클릭으로 패널 열기
                const hamburgerIcon = document.getElementById('leftNavDrawerIcon');
                
                if (hamburgerIcon) {
                    // hamburger가 닫혀있으면 클릭해서 열기
                    const isHamburgerOpen = hamburgerIcon.classList.contains('openIcon');
                    
                    if (!isHamburgerOpen) {
                        console.log('[Chat Lobby] Clicking hamburger icon to open panel');
                        hamburgerIcon.click();
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }
                }
                
                // drawer-icon 클래스 변경
                if (drawerIcon) {
                    drawerIcon.classList.remove('closedIcon');
                    drawerIcon.classList.add('openIcon');
                }
                
                // drawer-content 클래스 변경 및 표시
                if (drawerContent) {
                    drawerContent.classList.remove('closedDrawer');
                    drawerContent.classList.add('openDrawer');
                    drawerContent.style.display = 'block';
                }
                
                console.log('[Chat Lobby] === openPersonaManagement END ===');
                return;
            }
            
            // 일반 환경: drawer가 닫혀있을 때만 클릭
            if (drawerIcon && !isIconOpen) {
                console.log('[Chat Lobby] Clicking drawer-icon to open');
                drawerIcon.click();
            }
        }

        console.log('[Chat Lobby] === openPersonaManagement END ===');
    }

    // 페르소나 변경
    async function changePersona(personaKey) {
        try {
            if (!personaKey) {
                console.log('[Chat Lobby] No persona selected');
                return;
            }
            
            console.log('[Chat Lobby] Changing persona to:', personaKey);
            
            // personas.js의 setUserAvatar 직접 import (페이지네이션과 무관하게 작동)
            try {
                const personasModule = await import('../../../../personas.js');
                if (typeof personasModule.setUserAvatar === 'function') {
                    await personasModule.setUserAvatar(personaKey);
                    console.log('[Chat Lobby] Persona changed via setUserAvatar');
                    return; // 성공하면 종료 - UI 새로고침 안 함 (깜빡임 방지)
                }
            } catch (e) {
                console.log('[Chat Lobby] Could not use setUserAvatar:', e);
            }
            
            // 폴백: SillyTavern context
            if (typeof window.SillyTavern?.getContext?.()?.setUserAvatar === 'function') {
                await window.SillyTavern.getContext().setUserAvatar(personaKey);
                console.log('[Chat Lobby] Persona changed via context');
            }
        } catch (error) {
            console.error('[Chat Lobby] Failed to change persona:', error);
        }
    }

    // 캐릭터 목록 로드
    async function loadCharacters() {
        const context = getContext();
        if (!context) {
            console.error('[Chat Lobby] Context not available');
            return [];
        }

        try {
            const characters = context.characters || [];
            return characters;
        } catch (error) {
            console.error('[Chat Lobby] Failed to load characters:', error);
            return [];
        }
    }

    // 채팅 캐시 (모바일 최적화)
    const chatsCache = new Map();
    let chatsCacheTime = 0;
    const CHATS_CACHE_DURATION = 30000; // 30초

    // 캐릭터의 채팅 목록 로드
    async function loadChatsForCharacter(characterAvatar, forceRefresh = false) {
        console.log('[Chat Lobby] Fetching chats for:', characterAvatar);
        if (!characterAvatar) return [];

        try {
            // 캐시 확인 (forceRefresh가 아닐 때)
            const now = Date.now();
            const cacheKey = characterAvatar;
            if (!forceRefresh && now - chatsCacheTime < CHATS_CACHE_DURATION && chatsCache.has(cacheKey)) {
                console.log('[Chat Lobby] Using cached chats');
                return chatsCache.get(cacheKey);
            }
            
            const response = await fetch('/api/characters/chats', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    avatar_url: characterAvatar,
                    simple: false
                }),
            });

            if (!response.ok) {
                console.error('[Chat Lobby] HTTP error:', response.status);
                return [];
            }
            const data = await response.json();
            console.log('[Chat Lobby] Raw chat data count:', Array.isArray(data) ? data.length : 'not array');
            
            if (data && data.error === true) {
                return [];
            }
            
            // 캐시 저장
            const result = data || [];
            chatsCache.set(cacheKey, result);
            chatsCacheTime = now;
            
            return result;
        } catch (error) {
            console.error('[Chat Lobby] Failed to load chats:', error);
            return [];
        }
    }
    
    // 캐시 무효화 (새 채팅, 삭제 등)
    function invalidateChatsCache(characterAvatar) {
        if (characterAvatar) {
            chatsCache.delete(characterAvatar);
        } else {
            chatsCache.clear();
        }
    }

    // 캐릭터 카드 렌더링
    function renderCharacterCard(char, index) {
        const avatarUrl = char.avatar ? `/characters/${encodeURIComponent(char.avatar)}` : '/img/ai4.png';
        const name = char.name || 'Unknown';
        const safeAvatar = (char.avatar || '').replace(/"/g, '&quot;');
        
        // SillyTavern 캐릭터 즐겨찾기 체크
        const isFav = !!(char.fav === true || char.fav === 'true' || char.data?.extensions?.fav);
        const favBadge = isFav ? '<span class="char-fav-badge">⭐</span>' : '';

        return `
        <div class="lobby-char-card ${isFav ? 'is-char-fav' : ''}" data-char-index="${index}" data-char-avatar="${safeAvatar}" data-is-fav="${isFav}">
            ${favBadge}
            <img class="lobby-char-avatar" src="${avatarUrl}" alt="${name}" onerror="this.src='/img/ai4.png'">
            <div class="lobby-char-name">${escapeHtml(name)}</div>
        </div>
        `;
    }

    // 채팅 아이템 렌더링
    function renderChatItem(chat, characterAvatar, chatIndex) {
        if (!chat) return '';
        
        // 파일명 추출
        let fileName = '';
        if (typeof chat === 'object') {
            fileName = chat.file_name || chat.fileName || chat.name || '';
            if (!fileName && chat[0]) {
                // 배열 형태일 경우
                fileName = chat[0].file_name || chat[0].fileName || '';
            }
        }
        if (!fileName) fileName = `chat_${chatIndex}`;
        
        const displayName = fileName.replace('.jsonl', '');
        
        // 미리보기 텍스트
        let preview = '';
        if (chat.preview) preview = chat.preview;
        else if (chat.mes) preview = chat.mes;
        else if (chat.last_message) preview = chat.last_message;
        else preview = '채팅 기록';
        
        // 메시지 수 - 다양한 필드명 시도
        let messageCount = 0;
        if (typeof chat.chat_items === 'number') messageCount = chat.chat_items;
        else if (typeof chat.message_count === 'number') messageCount = chat.message_count;
        else if (typeof chat.chat_size === 'number') messageCount = chat.chat_size;
        else if (typeof chat.mes_count === 'number') messageCount = chat.mes_count;
        else if (typeof chat.count === 'number') messageCount = chat.count;
        else if (Array.isArray(chat.messages)) messageCount = chat.messages.length;
        else if (Array.isArray(chat)) messageCount = chat.length;

        // 날짜 포맷
        let lastDate = '';
        if (chat.last_mes) lastDate = formatDate(chat.last_mes);
        else if (chat.last_message_date) lastDate = formatDate(chat.last_message_date);
        else if (chat.date) lastDate = formatDate(chat.date);
        else {
            // 파일명에서 날짜 추출 (YYYY-MM-DD)
            const dateMatch = fileName.match(/(\d{4})-(\d{2})-(\d{2})/);
            if (dateMatch) {
                lastDate = `${dateMatch[1]}.${dateMatch[2]}.${dateMatch[3]}`;
            }
        }
        
        // 파일 크기 - 문자열이면 그대로 사용
        let fileSize = '';
        if (typeof chat.file_size === 'string') {
            fileSize = chat.file_size;
        } else if (typeof chat.file_size === 'number') {
            fileSize = formatFileSize(chat.file_size);
        }
        
        const safeAvatar = (characterAvatar || '').replace(/"/g, '&quot;');
        
        // 즐겨찾기 상태 확인
        const isFav = isFavorite(characterAvatar, fileName);
        const favIcon = isFav ? '⭐' : '☆';
        const favClass = isFav ? 'is-favorite' : '';
        
        // 폴더 정보
        const folderId = getChatFolder(characterAvatar, fileName);
        const data = loadLobbyData();
        const folder = data.folders.find(f => f.id === folderId);
        const folderName = folder ? folder.name : '';
        
        // 메타 정보 구성 (메시지 수만)
        const metaInfo = messageCount > 0 ? `💬 ${messageCount}개` : '';
        
        // 툴팁용 긴 미리보기 (500자)
        const tooltipPreview = truncateText(preview, 500);

        return `
        <div class="lobby-chat-item ${favClass}" data-file-name="${escapeHtml(fileName)}" data-char-avatar="${safeAvatar}" data-chat-index="${chatIndex}" data-folder-id="${folderId}" data-tooltip="${escapeHtml(tooltipPreview).replace(/"/g, '&quot;')}">
            <div class="chat-checkbox" style="display:none;">
                <input type="checkbox" class="chat-select-cb">
            </div>
            <button class="chat-fav-btn" title="즐겨찾기">${favIcon}</button>
            <div class="chat-content">
                <div class="chat-name">${escapeHtml(displayName)}</div>
                <div class="chat-preview">${escapeHtml(truncateText(preview, 80))}</div>
                <div class="chat-meta">
                    ${metaInfo ? `<span>${metaInfo}</span>` : ''}
                    ${folderName && folderId !== 'uncategorized' ? `<span class="chat-folder-tag">${escapeHtml(folderName)}</span>` : ''}
                </div>
            </div>
            <button class="chat-delete-btn" title="채팅 삭제">🗑️</button>
            <div class="chat-tooltip">
                <div class="chat-tooltip-header">📝 마지막 메시지</div>
                <div class="chat-tooltip-content">${escapeHtml(tooltipPreview)}</div>
            </div>
        </div>
        `;
    }

    // 캐릭터 그리드 업데이트
    async function updateCharacterGrid(searchTerm = '', retryCount = 0) {
        const container = document.getElementById('chat-lobby-characters');
        if (!container) return;

        container.innerHTML = '<div class="lobby-loading">캐릭터 로딩 중...</div>';

        let characters = await loadCharacters();
        
        // 캐릭터가 없고 재시도 횟수가 3번 미만이면 재시도
        if (characters.length === 0 && retryCount < 3) {
            console.log('[Chat Lobby] No characters found, retrying...', retryCount + 1);
            setTimeout(() => updateCharacterGrid(searchTerm, retryCount + 1), 500);
            return;
        }

        if (characters.length === 0) {
            container.innerHTML = `
                <div class="lobby-empty-state">
                    <i>👥</i>
                    <div>캐릭터가 없습니다</div>
                    <button onclick="window.chatLobbyRefresh()" style="margin-top:10px;padding:8px 16px;cursor:pointer;">새로고침</button>
                </div>
            `;
            return;
        }

        // 검색 필터링
        let filtered = [...characters]; // 원본 보호
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            filtered = filtered.filter(char =>
                (char.name || '').toLowerCase().includes(term)
            );
        }
        
        // 캐릭터 정렬 옵션 가져오기
        const lobbyData = loadLobbyData();
        const charSortOption = lobbyData.charSortOption || 'recent';
        
        // 정렬 드롭다운 값 업데이트
        const sortSelect = document.getElementById('chat-lobby-char-sort');
        if (sortSelect) sortSelect.value = charSortOption;
        
        // 캐릭터 정렬 (즐겨찾기 우선 + 선택된 정렬 기준)
        if (charSortOption === 'name') {
            // 이름순 정렬
            filtered.sort((a, b) => {
                const aIsFav = !!(a.fav === true || a.fav === 'true' || a.data?.extensions?.fav);
                const bIsFav = !!(b.fav === true || b.fav === 'true' || b.data?.extensions?.fav);
                if (aIsFav !== bIsFav) return aIsFav ? -1 : 1;
                return (a.name || '').localeCompare(b.name || '', 'ko');
            });
        } else if (charSortOption === 'created') {
            // 생성일순 정렬 (최신 먼저)
            filtered.sort((a, b) => {
                const aIsFav = !!(a.fav === true || a.fav === 'true' || a.data?.extensions?.fav);
                const bIsFav = !!(b.fav === true || b.fav === 'true' || b.data?.extensions?.fav);
                if (aIsFav !== bIsFav) return aIsFav ? -1 : 1;
                const aDate = a.create_date || a.date_added || 0;
                const bDate = b.create_date || b.date_added || 0;
                return bDate - aDate;
            });
        } else if (charSortOption === 'chats') {
            // 채팅 수 순 정렬 - 비동기로 처리
            const chatCounts = await Promise.all(
                filtered.map(async (char) => {
                    const count = await getCharacterChatCount(char.avatar);
                    return { char, count };
                })
            );
            chatCounts.sort((a, b) => {
                const aIsFav = !!(a.char.fav === true || a.char.fav === 'true' || a.char.data?.extensions?.fav);
                const bIsFav = !!(b.char.fav === true || b.char.fav === 'true' || b.char.data?.extensions?.fav);
                if (aIsFav !== bIsFav) return aIsFav ? -1 : 1;
                return b.count - a.count;
            });
            filtered = chatCounts.map(item => item.char);
        } else {
            // 최근 채팅순 (기본) - date_last_chat 기준
            filtered.sort((a, b) => {
                const aIsFav = !!(a.fav === true || a.fav === 'true' || a.data?.extensions?.fav);
                const bIsFav = !!(b.fav === true || b.fav === 'true' || b.data?.extensions?.fav);
                if (aIsFav !== bIsFav) return aIsFav ? -1 : 1;
                const aDate = a.date_last_chat || a.last_mes || 0;
                const bDate = b.date_last_chat || b.last_mes || 0;
                return bDate - aDate;
            });
        }

        if (filtered.length === 0) {
            container.innerHTML = `
                <div class="lobby-empty-state">
                    <i>🔍</i>
                    <div>검색 결과가 없습니다</div>
                </div>
            `;
            return;
        }

        container.innerHTML = filtered.map((char, idx) => {
            const originalIndex = characters.indexOf(char);
            return renderCharacterCard(char, originalIndex);
        }).join('');

        // 캐릭터 카드 클릭 이벤트 - 터치/클릭 중복 방지
        container.querySelectorAll('.lobby-char-card').forEach(card => {
            let touchHandled = false;
            let touchStartY = 0;
            let isScrolling = false;
            
            card.addEventListener('touchstart', (e) => {
                touchHandled = false;
                isScrolling = false;
                touchStartY = e.touches[0].clientY;
            }, { passive: true });
            
            card.addEventListener('touchmove', (e) => {
                if (Math.abs(e.touches[0].clientY - touchStartY) > 10) {
                    isScrolling = true;
                }
            }, { passive: true });
            
            card.addEventListener('touchend', (e) => {
                if (!isScrolling) {
                    e.preventDefault();
                    touchHandled = true;
                    selectCharacter(card);
                }
                isScrolling = false;
            });
            
            card.addEventListener('click', () => {
                if (!touchHandled) {
                    selectCharacter(card);
                }
                touchHandled = false;
            });
        });
    }

    // 캐릭터 선택
    async function selectCharacter(cardElement) {
        // 기존 선택 해제
        document.querySelectorAll('.lobby-char-card.selected').forEach(el => {
            el.classList.remove('selected');
        });

        // 새로 선택
        cardElement.classList.add('selected');

        const charIndex = cardElement.dataset.charIndex;
        const charAvatar = cardElement.dataset.charAvatar;
        const charName = cardElement.querySelector('.lobby-char-name').textContent;
        const avatarSrc = cardElement.querySelector('.lobby-char-avatar').src;

        // 채팅 패널 UI 요소들 표시
        const chatsPanel = document.getElementById('chat-lobby-chats');
        chatsPanel.classList.add('visible');
        
        // 헤더 요소들 표시
        const avatarImg = document.getElementById('chat-panel-avatar');
        avatarImg.style.display = 'block';
        avatarImg.src = avatarSrc;
        
        document.getElementById('chat-panel-name').textContent = charName;
        document.getElementById('chat-panel-count').textContent = '채팅 로딩 중...';
        document.getElementById('chat-lobby-delete-char').style.display = 'block';
        document.getElementById('chat-lobby-new-chat').style.display = 'block';
        document.getElementById('chat-lobby-folder-bar').style.display = 'flex';
        
        // 정렬 옵션 select 값 설정
        const lobbyDataForSort = loadLobbyData();
        const chatSortSelect = document.getElementById('chat-lobby-chat-sort');
        if (chatSortSelect) chatSortSelect.value = lobbyDataForSort.sortOption || 'recent';

        // 새 채팅 버튼 데이터 설정
        document.getElementById('chat-lobby-new-chat').dataset.charIndex = charIndex;
        document.getElementById('chat-lobby-new-chat').dataset.charAvatar = charAvatar;

        // 채팅 목록 로드
        const chatsList = document.getElementById('chat-lobby-chats-list');
        chatsList.innerHTML = '<div class="lobby-loading">채팅 로딩 중...</div>';

        const chats = await loadChatsForCharacter(charAvatar);
        
        // 채팅이 없는 경우 체크 (빈 배열, 빈 객체, error 응답 등)
        const hasNoChats = !chats || 
            (Array.isArray(chats) && chats.length === 0) || 
            (typeof chats === 'object' && !Array.isArray(chats) && (Object.keys(chats).length === 0 || chats.error === true));
        
        console.log('[Chat Lobby] hasNoChats:', hasNoChats, 'chats:', chats);

        if (hasNoChats) {
            document.getElementById('chat-panel-count').textContent = '채팅 없음';
            // 채팅이 없음을 표시
            document.getElementById('chat-lobby-new-chat').dataset.hasChats = 'false';
            console.log('[Chat Lobby] Set hasChats = false');
            chatsList.innerHTML = `
                <div class="lobby-empty-state">
                    <i>💬</i>
                    <div>채팅 기록이 없습니다</div>
                    <div style="font-size: 0.9em; margin-top: 5px;">새 채팅을 시작해보세요!</div>
                </div>
            `;
            return;
        }
        
        // 채팅이 있음을 표시
        document.getElementById('chat-lobby-new-chat').dataset.hasChats = 'true';
        console.log('[Chat Lobby] Set hasChats = true');

        // 채팅 목록을 배열로 변환
        let chatArray = [];
        if (Array.isArray(chats)) {
            chatArray = chats;
        } else if (typeof chats === 'object') {
            chatArray = Object.entries(chats).map(([key, value]) => {
                if (typeof value === 'object') {
                    return { ...value, file_name: value.file_name || key };
                }
                return { file_name: key, ...value };
            });
        }
        
        // 유효한 채팅만 필터링 (실제 파일명이 있는 것)
        chatArray = chatArray.filter(chat => {
            const fileName = chat?.file_name || chat?.fileName || '';
            // 유효한 파일명: .jsonl 확장자 또는 날짜 패턴 포함 (공백 허용)
            const hasJsonl = fileName.includes('.jsonl');
            const hasDatePattern = /\d{4}-\d{2}-\d{2}/.test(fileName);
            const isValidName = fileName && 
                   (hasJsonl || hasDatePattern) &&
                   !fileName.startsWith('chat_') &&
                   fileName.toLowerCase() !== 'error';
            
            console.log('[Chat Lobby] Filter check:', fileName, 'hasJsonl:', hasJsonl, 'hasDate:', hasDatePattern, 'valid:', isValidName);
            return isValidName;
        });
        
        // 필터링 후 채팅이 없으면 빈 상태 표시
        if (chatArray.length === 0) {
            document.getElementById('chat-panel-count').textContent = '채팅 없음';
            chatsList.innerHTML = `
                <div class="lobby-empty-state">
                    <i>💬</i>
                    <div>채팅 기록이 없습니다</div>
                    <div style="font-size: 0.9em; margin-top: 5px;">새 채팅을 시작해보세요!</div>
                </div>
            `;
            return;
        }
        
        // 최신순 정렬 (가장 최근 채팅이 맨 위)
        const lobbyData = loadLobbyData();
        const currentSort = lobbyData.sortOption || 'recent';
        const currentFilter = lobbyData.filterFolder || 'all';
        
        console.log('[Chat Lobby] === Sorting chats ===');
        console.log('[Chat Lobby] Sort option:', currentSort);
        console.log('[Chat Lobby] Filter:', currentFilter);
        console.log('[Chat Lobby] Chats before sort:', chatArray.length);
        
        // 폴더 필터 적용
        if (currentFilter !== 'all') {
            chatArray = chatArray.filter(chat => {
                const fn = chat.file_name || chat.fileName || '';
                const key = getChatKey(charAvatar, fn);
                if (currentFilter === 'favorites') {
                    return lobbyData.favorites.includes(key);
                }
                const assigned = lobbyData.chatAssignments[key] || 'uncategorized';
                return assigned === currentFilter;
            });
        }
        
        // 정렬
        chatArray.sort((a, b) => {
            const fnA = a.file_name || '';
            const fnB = b.file_name || '';
            
            // 항상 즐겨찾기 우선 (모든 정렬 모드에서)
            const keyA = getChatKey(charAvatar, fnA);
            const keyB = getChatKey(charAvatar, fnB);
            const favA = lobbyData.favorites.includes(keyA) ? 0 : 1;
            const favB = lobbyData.favorites.includes(keyB) ? 0 : 1;
            if (favA !== favB) return favA - favB;
            
            // 날짜 파싱 함수
            function parseDate(filename) {
                // 형식: YYYY-MM-DD@HHhMMmSSs (공백 없음)
                const m = filename.match(/(\d{4})-(\d{2})-(\d{2})@(\d{2})h(\d{2})m(\d{2})s/);
                if (m) {
                    return new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]).getTime();
                }
                // 형식: YYYY-MM-DD @HHh MMm SSs (공백 있음) - "2025-10-26 @05h 32m 18s"
                const m2 = filename.match(/(\d{4})-(\d{2})-(\d{2})\s*@\s*(\d{2})h\s*(\d{2})m\s*(\d{2})s/);
                if (m2) {
                    return new Date(+m2[1], +m2[2]-1, +m2[3], +m2[4], +m2[5], +m2[6]).getTime();
                }
                // 형식: YYYY-MM-DD만 있는 경우
                const m3 = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
                if (m3) {
                    return new Date(+m3[1], +m3[2]-1, +m3[3]).getTime();
                }
                return 0;
            }
            
            if (currentSort === 'name') {
                // 이름순 정렬
                return fnA.localeCompare(fnB, 'ko');
            }
            
            // 메시지 수 순 정렬
            if (currentSort === 'messages') {
                const msgA = a.message_count || a.mes_count || 0;
                const msgB = b.message_count || b.mes_count || 0;
                return msgB - msgA;
            }
            
            // 날짜순 (최신 또는 생성일)
            let dateA = parseDate(fnA);
            let dateB = parseDate(fnB);
            
            // 파일명에서 못 찾으면 다른 필드 시도
            if (!dateA && a.last_mes) dateA = typeof a.last_mes === 'number' ? a.last_mes : new Date(a.last_mes).getTime();
            if (!dateB && b.last_mes) dateB = typeof b.last_mes === 'number' ? b.last_mes : new Date(b.last_mes).getTime();
            
            return dateB - dateA; // 내림차순 (최신이 위)
        });

        document.getElementById('chat-panel-count').textContent = `${chatArray.length}개 채팅`;
        chatsList.innerHTML = chatArray.map((chat, idx) => renderChatItem(chat, charAvatar, idx)).join('');

        // 채팅 아이템 클릭 이벤트
        chatsList.querySelectorAll('.lobby-chat-item').forEach(item => {
            // 스크롤 감지를 위한 변수
            let touchStartY = 0;
            let isScrolling = false;
            let touchHandled = false;
            
            const handleItemClick = (e) => {
                // 스크롤 중이면 무시
                if (isScrolling) return;
                
                // 배치 모드일 때는 체크박스 토글
                if (batchModeActive) {
                    const cb = item.querySelector('.chat-select-cb');
                    if (cb && e.target !== cb) {
                        cb.checked = !cb.checked;
                        updateBatchCount();
                    }
                    return;
                }
                // 일반 모드: 채팅 열기
                openChat(item);
            };
            
            // 채팅 열기 (컨텐츠 클릭)
            const chatContent = item.querySelector('.chat-content');
            chatContent.addEventListener('touchstart', (e) => {
                touchHandled = false;
                isScrolling = false;
                touchStartY = e.touches[0].clientY;
            }, { passive: true });
            chatContent.addEventListener('touchmove', (e) => {
                // 10px 이상 이동하면 스크롤로 판단
                if (Math.abs(e.touches[0].clientY - touchStartY) > 10) {
                    isScrolling = true;
                }
            }, { passive: true });
            chatContent.addEventListener('touchend', (e) => {
                if (!isScrolling) {
                    e.preventDefault();
                    touchHandled = true;
                    handleItemClick(e);
                }
                isScrolling = false;
            });
            chatContent.addEventListener('click', (e) => {
                if (!touchHandled) handleItemClick(e);
                touchHandled = false;
            });
            
            // 즐겨찾기 버튼
            const favBtn = item.querySelector('.chat-fav-btn');
            let favTouchStartY = 0;
            let favIsScrolling = false;
            let favTouchHandled = false;
            const handleFav = (e) => {
                e.stopPropagation();
                e.preventDefault();
                const fn = item.dataset.fileName;
                const ca = item.dataset.charAvatar;
                const isNowFav = toggleFavorite(ca, fn);
                favBtn.textContent = isNowFav ? '⭐' : '☆';
                item.classList.toggle('is-favorite', isNowFav);
            };
            favBtn.addEventListener('touchstart', (e) => {
                favTouchHandled = false;
                favIsScrolling = false;
                favTouchStartY = e.touches[0].clientY;
            }, { passive: true });
            favBtn.addEventListener('touchmove', (e) => {
                if (Math.abs(e.touches[0].clientY - favTouchStartY) > 10) {
                    favIsScrolling = true;
                }
            }, { passive: true });
            favBtn.addEventListener('touchend', (e) => {
                if (!favIsScrolling) {
                    e.preventDefault();
                    e.stopPropagation();
                    favTouchHandled = true;
                    handleFav(e);
                }
                favIsScrolling = false;
            });
            favBtn.addEventListener('click', (e) => {
                if (!favTouchHandled) handleFav(e);
                favTouchHandled = false;
            });
            
            // 삭제 버튼
            const delBtn = item.querySelector('.chat-delete-btn');
            let delTouchStartY = 0;
            let delIsScrolling = false;
            let delTouchHandled = false;
            const handleDel = (e) => {
                e.stopPropagation();
                e.preventDefault();
                deleteChat(item);
            };
            delBtn.addEventListener('touchstart', (e) => {
                delTouchHandled = false;
                delIsScrolling = false;
                delTouchStartY = e.touches[0].clientY;
            }, { passive: true });
            delBtn.addEventListener('touchmove', (e) => {
                if (Math.abs(e.touches[0].clientY - delTouchStartY) > 10) {
                    delIsScrolling = true;
                }
            }, { passive: true });
            delBtn.addEventListener('touchend', (e) => {
                if (!delIsScrolling) {
                    e.preventDefault();
                    e.stopPropagation();
                    delTouchHandled = true;
                    handleDel(e);
                }
                delIsScrolling = false;
            });
            delBtn.addEventListener('click', (e) => {
                if (!delTouchHandled) handleDel(e);
                delTouchHandled = false;
            });
        });
        
        // 폴더 필터 드롭다운 값 설정
        const filterSelect = document.getElementById('chat-lobby-folder-filter');
        if (filterSelect) filterSelect.value = currentFilter;
    }
    
    // 채팅만 다시 로드 (필터/정렬 변경 시)
    async function reloadChatsWithFilter(cardElement, filterValue) {
        const charAvatar = cardElement.dataset.charAvatar;
        const chatsList = document.getElementById('chat-lobby-chats-list');
        
        chatsList.innerHTML = '<div class="lobby-loading">채팅 로딩 중...</div>';
        
        // forceRefresh로 캐시 무시
        const chats = await loadChatsForCharacter(charAvatar, true);
        
        // 현재 정렬 옵션 가져오기 (최신값)
        const lobbyData = loadLobbyData();
        const currentSort = lobbyData.sortOption || 'recent';
        console.log('[Chat Lobby] reloadChatsWithFilter - sort:', currentSort, 'filter:', filterValue);
        
        // 정렬 드롭다운 값 동기화
        const chatSortSelect = document.getElementById('chat-lobby-chat-sort');
        if (chatSortSelect && chatSortSelect.value !== currentSort) {
            chatSortSelect.value = currentSort;
        }
        
        // 빈 채팅 체크
        const hasNoChats = !chats || 
            (Array.isArray(chats) && chats.length === 0) || 
            (typeof chats === 'object' && !Array.isArray(chats) && (Object.keys(chats).length === 0 || chats.error === true));
        
        if (hasNoChats) {
            document.getElementById('chat-panel-count').textContent = '채팅 없음';
            chatsList.innerHTML = `
                <div class="lobby-empty-state">
                    <i>💬</i>
                    <div>채팅 기록이 없습니다</div>
                </div>
            `;
            return;
        }
        
        // 배열 변환
        let chatArray = [];
        if (Array.isArray(chats)) {
            chatArray = chats;
        } else if (typeof chats === 'object') {
            chatArray = Object.entries(chats).map(([key, value]) => {
                if (typeof value === 'object') {
                    return { ...value, file_name: value.file_name || key };
                }
                return { file_name: key, ...value };
            });
        }
        
        // 유효한 채팅만 필터링
        chatArray = chatArray.filter(chat => {
            const fileName = chat?.file_name || chat?.fileName || '';
            const hasJsonl = fileName.includes('.jsonl');
            const hasDatePattern = /\d{4}-\d{2}-\d{2}/.test(fileName);
            return fileName && 
                   (hasJsonl || hasDatePattern) &&
                   !fileName.startsWith('chat_') &&
                   fileName.toLowerCase() !== 'error';
        });
        
        // 폴더 필터 적용
        if (filterValue !== 'all') {
            chatArray = chatArray.filter(chat => {
                const fn = chat.file_name || chat.fileName || '';
                const key = getChatKey(charAvatar, fn);
                if (filterValue === 'favorites') {
                    return lobbyData.favorites.includes(key);
                }
                const assigned = lobbyData.chatAssignments[key] || 'uncategorized';
                return assigned === filterValue;
            });
        }
        
        // 정렬 적용
        chatArray.sort((a, b) => {
            const fnA = a.file_name || '';
            const fnB = b.file_name || '';
            
            // 항상 즐겨찾기 우선
            const keyA = getChatKey(charAvatar, fnA);
            const keyB = getChatKey(charAvatar, fnB);
            const favA = lobbyData.favorites.includes(keyA) ? 0 : 1;
            const favB = lobbyData.favorites.includes(keyB) ? 0 : 1;
            if (favA !== favB) return favA - favB;
            
            function parseDate(filename) {
                // 형식: YYYY-MM-DD@HHhMMmSSs (공백 없음)
                const m = filename.match(/(\d{4})-(\d{2})-(\d{2})@(\d{2})h(\d{2})m(\d{2})s/);
                if (m) return new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]).getTime();
                // 형식: YYYY-MM-DD @HHh MMm SSs (공백 있음)
                const m2 = filename.match(/(\d{4})-(\d{2})-(\d{2})\s*@\s*(\d{2})h\s*(\d{2})m\s*(\d{2})s/);
                if (m2) return new Date(+m2[1], +m2[2]-1, +m2[3], +m2[4], +m2[5], +m2[6]).getTime();
                // 형식: YYYY-MM-DD만
                const m3 = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
                if (m3) return new Date(+m3[1], +m3[2]-1, +m3[3]).getTime();
                return 0;
            }
            
            if (currentSort === 'name') return fnA.localeCompare(fnB, 'ko');
            
            // 메시지 수 순 정렬
            if (currentSort === 'messages') {
                const msgA = a.message_count || a.mes_count || 0;
                const msgB = b.message_count || b.mes_count || 0;
                return msgB - msgA; // 많은 순
            }
            
            let dateA = parseDate(fnA);
            let dateB = parseDate(fnB);
            if (!dateA && a.last_mes) dateA = typeof a.last_mes === 'number' ? a.last_mes : new Date(a.last_mes).getTime();
            if (!dateB && b.last_mes) dateB = typeof b.last_mes === 'number' ? b.last_mes : new Date(b.last_mes).getTime();
            return dateB - dateA;
        });
        
        document.getElementById('chat-panel-count').textContent = `${chatArray.length}개 채팅`;
        chatsList.innerHTML = chatArray.map((chat, idx) => renderChatItem(chat, charAvatar, idx)).join('');
        
        // 이벤트 재연결
        bindChatItemEvents(chatsList, charAvatar);
        
        // 드롭다운 값 유지
        const filterSelect = document.getElementById('chat-lobby-folder-filter');
        if (filterSelect) filterSelect.value = filterValue;
    }
    
    // 채팅 아이템 이벤트 바인딩 (재사용)
    function bindChatItemEvents(chatsList, charAvatar) {
        chatsList.querySelectorAll('.lobby-chat-item').forEach(item => {
            let touchStartY = 0;
            let isScrolling = false;
            let touchHandled = false;
            
            const handleItemClick = (e) => {
                if (isScrolling) return;
                if (batchModeActive) {
                    const cb = item.querySelector('.chat-select-cb');
                    if (cb && e.target !== cb) {
                        cb.checked = !cb.checked;
                        updateBatchCount();
                    }
                    return;
                }
                openChat(item);
            };
            
            const chatContent = item.querySelector('.chat-content');
            chatContent.addEventListener('touchstart', (e) => {
                touchHandled = false; isScrolling = false;
                touchStartY = e.touches[0].clientY;
            }, { passive: true });
            chatContent.addEventListener('touchmove', (e) => {
                if (Math.abs(e.touches[0].clientY - touchStartY) > 10) isScrolling = true;
            }, { passive: true });
            chatContent.addEventListener('touchend', (e) => {
                if (!isScrolling) { e.preventDefault(); touchHandled = true; handleItemClick(e); }
                isScrolling = false;
            });
            chatContent.addEventListener('click', (e) => {
                if (!touchHandled) handleItemClick(e);
                touchHandled = false;
            });
            
            // 즐겨찾기/삭제 버튼도 동일하게
            const favBtn = item.querySelector('.chat-fav-btn');
            let favStartY = 0, favScrolling = false, favHandled = false;
            favBtn.addEventListener('touchstart', (e) => { favHandled = false; favScrolling = false; favStartY = e.touches[0].clientY; }, { passive: true });
            favBtn.addEventListener('touchmove', (e) => { if (Math.abs(e.touches[0].clientY - favStartY) > 10) favScrolling = true; }, { passive: true });
            favBtn.addEventListener('touchend', (e) => {
                if (!favScrolling) {
                    e.preventDefault(); e.stopPropagation(); favHandled = true;
                    const isNowFav = toggleFavorite(item.dataset.charAvatar, item.dataset.fileName);
                    favBtn.textContent = isNowFav ? '⭐' : '☆';
                    item.classList.toggle('is-favorite', isNowFav);
                }
                favScrolling = false;
            });
            favBtn.addEventListener('click', (e) => { if (!favHandled) { e.stopPropagation(); const isNowFav = toggleFavorite(item.dataset.charAvatar, item.dataset.fileName); favBtn.textContent = isNowFav ? '⭐' : '☆'; item.classList.toggle('is-favorite', isNowFav); } favHandled = false; });
            
            const delBtn = item.querySelector('.chat-delete-btn');
            let delStartY = 0, delScrolling = false, delHandled = false;
            delBtn.addEventListener('touchstart', (e) => { delHandled = false; delScrolling = false; delStartY = e.touches[0].clientY; }, { passive: true });
            delBtn.addEventListener('touchmove', (e) => { if (Math.abs(e.touches[0].clientY - delStartY) > 10) delScrolling = true; }, { passive: true });
            delBtn.addEventListener('touchend', (e) => { if (!delScrolling) { e.preventDefault(); e.stopPropagation(); delHandled = true; deleteChat(item); } delScrolling = false; });
            delBtn.addEventListener('click', (e) => { if (!delHandled) { e.stopPropagation(); deleteChat(item); } delHandled = false; });
        });
    }
    
    // 폴더 필터 드롭다운 업데이트
    function updateFolderFilterDropdown(selectedValue) {
        const filterSelect = document.getElementById('chat-lobby-folder-filter');
        if (!filterSelect) return;
        
        // 현재 선택된 값 기억 (매개변수 우선)
        const currentValue = selectedValue || filterSelect.value || 'all';
        
        const data = loadLobbyData();
        const sorted = [...data.folders].sort((a, b) => a.order - b.order);
        
        let html = '<option value="all">📁 전체</option>';
        html += '<option value="favorites">⭐ 즐겨찾기만</option>';
        sorted.forEach(f => {
            if (f.id !== 'favorites') {
                html += `<option value="${f.id}">${escapeHtml(f.name)}</option>`;
            }
        });
        filterSelect.innerHTML = html;
        
        // 선택된 값 복원
        filterSelect.value = currentValue;
    }
    
    // 폴더 관리 모달 열기
    function openFolderModal() {
        const modal = document.getElementById('chat-lobby-folder-modal');
        if (!modal) return;
        modal.style.display = 'flex';
        refreshFolderList();
    }
    
    // 폴더 관리 모달 닫기
    function closeFolderModal() {
        const modal = document.getElementById('chat-lobby-folder-modal');
        if (modal) modal.style.display = 'none';
    }
    
    // 폴더 목록 새로고침
    function refreshFolderList() {
        const container = document.getElementById('folder-list');
        if (!container) return;
        
        const data = loadLobbyData();
        const sorted = [...data.folders].sort((a, b) => a.order - b.order);
        
        let html = '';
        sorted.forEach(f => {
            const isSystem = f.isSystem ? 'system' : '';
            const deleteBtn = f.isSystem ? '' : `<button class="folder-delete-btn" data-id="${f.id}">🗑️</button>`;
            const editBtn = f.isSystem ? '' : `<button class="folder-edit-btn" data-id="${f.id}">✏️</button>`;
            
            // 해당 폴더의 채팅 수 계산
            let count = 0;
            if (f.id === 'favorites') {
                count = data.favorites.length;
            } else {
                count = Object.values(data.chatAssignments).filter(v => v === f.id).length;
            }
            
            html += `
            <div class="folder-item ${isSystem}" data-id="${f.id}">
                <span class="folder-name">${escapeHtml(f.name)}</span>
                <span class="folder-count">${count}개</span>
                ${editBtn}
                ${deleteBtn}
            </div>`;
        });
        container.innerHTML = html;
        
        // 이벤트 연결
        container.querySelectorAll('.folder-delete-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (confirm('이 폴더를 삭제하시겠습니까? 내부 채팅은 미분류로 이동됩니다.')) {
                    deleteFolder(btn.dataset.id);
                    refreshFolderList();
                    updateFolderFilterDropdown();
                }
            });
        });
        
        container.querySelectorAll('.folder-edit-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                const data = loadLobbyData();
                const folder = data.folders.find(f => f.id === id);
                if (!folder) return;
                const newName = prompt('새 폴더 이름:', folder.name);
                if (newName && newName.trim()) {
                    renameFolder(id, newName.trim());
                    refreshFolderList();
                    updateFolderFilterDropdown();
                }
            });
        });
    }
    
    // 배치 모드 토글
    let batchModeActive = false;
    function toggleBatchMode() {
        batchModeActive = !batchModeActive;
        const chatsList = document.getElementById('chat-lobby-chats-list');
        const toolbar = document.getElementById('chat-lobby-batch-toolbar');
        const batchBtn = document.getElementById('chat-lobby-batch-mode');
        
        if (batchModeActive) {
            chatsList.classList.add('batch-mode');
            toolbar.classList.add('visible');
            batchBtn.classList.add('active');
            chatsList.querySelectorAll('.chat-checkbox').forEach(cb => cb.style.display = 'block');
            updateBatchMoveDropdown();
        } else {
            chatsList.classList.remove('batch-mode');
            toolbar.classList.remove('visible');
            batchBtn.classList.remove('active');
            chatsList.querySelectorAll('.chat-checkbox').forEach(cb => {
                cb.style.display = 'none';
                cb.querySelector('input').checked = false;
            });
        }
        updateBatchCount();
    }
    
    // 배치 이동 드롭다운 업데이트
    function updateBatchMoveDropdown() {
        const select = document.getElementById('batch-move-folder');
        if (!select) return;
        const data = loadLobbyData();
        const sorted = [...data.folders].sort((a, b) => a.order - b.order);
        let html = '<option value="">이동할 폴더...</option>';
        sorted.forEach(f => {
            if (f.id !== 'favorites') {
                html += `<option value="${f.id}">${escapeHtml(f.name)}</option>`;
            }
        });
        select.innerHTML = html;
    }
    
    // 선택된 채팅 수 업데이트
    function updateBatchCount() {
        const count = document.querySelectorAll('.chat-select-cb:checked').length;
        const countSpan = document.getElementById('batch-selected-count');
        if (countSpan) countSpan.textContent = `${count}개 선택`;
    }
    
    // 배치 이동 실행
    function executeBatchMove() {
        const targetFolder = document.getElementById('batch-move-folder').value;
        if (!targetFolder) {
            alert('이동할 폴더를 선택하세요.');
            return;
        }
        
        const checked = document.querySelectorAll('.chat-select-cb:checked');
        const keys = [];
        checked.forEach(cb => {
            const item = cb.closest('.lobby-chat-item');
            if (item) {
                const key = getChatKey(item.dataset.charAvatar, item.dataset.fileName);
                keys.push(key);
                item.dataset.folderId = targetFolder;
            }
        });
        
        if (keys.length === 0) {
            alert('이동할 채팅을 선택하세요.');
            return;
        }
        
        moveChatsBatch(keys, targetFolder);
        toggleBatchMode(); // 배치 모드 해제
        
        // 현재 캐릭터 다시 선택하여 목록 새로고침
        const selectedCard = document.querySelector('.lobby-char-card.selected');
        if (selectedCard) selectCharacter(selectedCard);
    }

    // 채팅 열기
    async function openChat(chatElement) {
        const fileName = chatElement.dataset.fileName;
        const charAvatar = chatElement.dataset.charAvatar;

        console.log('[Chat Lobby] openChat called, fileName:', fileName);

        if (!charAvatar || !fileName) {
            console.error('[Chat Lobby] Missing chat data');
            return;
        }

        try {
            const context = getContext();
            const characters = context.characters || [];
            const charIndex = characters.findIndex(c => c.avatar === charAvatar);

            if (charIndex === -1) {
                console.error('[Chat Lobby] Character not found');
                return;
            }

            // 로비 닫기 (FAB 버튼은 표시)
            closeLobby();

            // 캐릭터 선택
            await selectCharacterByIndex(charIndex);

            // 채팅 열기 - 파일명으로
            setTimeout(async () => {
                await openChatByFileName(fileName, charAvatar);
            }, 300);

        } catch (error) {
            console.error('[Chat Lobby] Failed to open chat:', error);
        }
    }

    // 채팅 삭제
    async function deleteChat(chatElement) {
        const fileName = chatElement.dataset.fileName;
        const charAvatar = chatElement.dataset.charAvatar;
        
        if (!fileName || !charAvatar) {
            console.error('[Chat Lobby] Missing chat data for delete');
            return;
        }

        // 확인창
        if (!confirm(`"${fileName.replace('.jsonl', '')}" 채팅을 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`)) {
            return;
        }

        try {
            const response = await fetch('/api/chats/delete', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    chatfile: fileName,
                    avatar_url: charAvatar
                }),
            });

            if (response.ok) {
                // 삭제 성공 - UI에서 제거
                chatElement.remove();
                
                // 채팅 카운트 업데이트
                const chatsList = document.getElementById('chat-lobby-chats-list');
                const remainingChats = chatsList.querySelectorAll('.lobby-chat-item').length;
                document.getElementById('chat-panel-count').textContent = `${remainingChats}개 채팅`;
                
                // 채팅이 없으면 빈 상태 표시
                if (remainingChats === 0) {
                    document.getElementById('chat-panel-count').textContent = '채팅 없음';
                    chatsList.innerHTML = `
                        <div class="lobby-empty-state">
                            <i>💬</i>
                            <div>채팅 기록이 없습니다</div>
                            <div style="font-size: 0.9em; margin-top: 5px;">새 채팅을 시작해보세요!</div>
                        </div>
                    `;
                }
                
                console.log('[Chat Lobby] Chat deleted:', fileName);
                // 캐시 무효화
                invalidateChatsCache(charAvatar);
            } else {
                console.error('[Chat Lobby] Failed to delete chat:', response.status);
                // 서버에서 삭제 실패 - 파일이 없을 수 있음, UI에서만 제거할지 확인
                if (confirm('채팅 파일을 찾을 수 없습니다.\n목록에서 제거하시겠습니까?')) {
                    chatElement.remove();
                    const chatsList = document.getElementById('chat-lobby-chats-list');
                    const remainingChats = chatsList.querySelectorAll('.lobby-chat-item').length;
                    document.getElementById('chat-panel-count').textContent = remainingChats > 0 ? `${remainingChats}개 채팅` : '채팅 없음';
                    
                    if (remainingChats === 0) {
                        chatsList.innerHTML = `
                            <div class="lobby-empty-state">
                                <i>💬</i>
                                <div>채팅 기록이 없습니다</div>
                                <div style="font-size: 0.9em; margin-top: 5px;">새 채팅을 시작해보세요!</div>
                            </div>
                        `;
                    }
                }
            }
        } catch (error) {
            console.error('[Chat Lobby] Error deleting chat:', error);
            alert('채팅 삭제 중 오류가 발생했습니다.');
        }
    }

    // 인덱스로 캐릭터 선택
    async function selectCharacterByIndex(index) {
        const context = getContext();
        if (context && typeof context.selectCharacterById === 'function') {
            await context.selectCharacterById(String(index));
        } else {
            const characterList = document.getElementById('rm_print_characters_block');
            if (characterList) {
                const charItems = characterList.querySelectorAll('.character_select');
                if (charItems[index]) {
                    charItems[index].click();
                }
            }
        }
    }

    // 파일명으로 채팅 열기
    async function openChatByFileName(fileName, charAvatar) {
        console.log('[Chat Lobby] === openChatByFileName START ===');
        console.log('[Chat Lobby] Target fileName:', fileName);
        
        try {
            // 채팅 관리 버튼 클릭
            const manageChatsBtn = document.getElementById('option_select_chat');
            console.log('[Chat Lobby] manageChatsBtn found:', !!manageChatsBtn);
            
            if (manageChatsBtn) {
                manageChatsBtn.click();

                // 채팅 목록에서 해당 파일명 찾기
                setTimeout(() => {
                    const chatItems = document.querySelectorAll('.select_chat_block');
                    console.log('[Chat Lobby] Chat items count:', chatItems.length);
                    let found = false;
                    
                    const cleanFileName = fileName.replace('.jsonl', '');
                    console.log('[Chat Lobby] Searching for:', cleanFileName);
                    
                    for (let i = 0; i < chatItems.length; i++) {
                        const item = chatItems[i];
                        // 파일명이 포함된 요소 찾기
                        const nameEl = item.querySelector('.select_chat_block_filename, .ch_name');
                        const itemText = nameEl?.textContent || item.textContent || '';
                        
                        console.log(`[Chat Lobby] Item ${i}:`, itemText.substring(0, 50));
                        
                        // 파일명 비교
                        if (itemText.includes(cleanFileName)) {
                            console.log('[Chat Lobby] FOUND at index:', i);
                            item.click();
                            found = true;
                            break;
                        }
                    }
                    
                    if (!found) {
                        console.warn('[Chat Lobby] NOT FOUND:', fileName);
                    }
                    
                    console.log('[Chat Lobby] === openChatByFileName END ===');
                }, 300);
            }
        } catch (error) {
            console.error('[Chat Lobby] Failed to open specific chat:', error);
        }
    }

    // 새 채팅 시작
    async function startNewChat() {
        const btn = document.getElementById('chat-lobby-new-chat');
        const charIndex = btn.dataset.charIndex;
        const charAvatar = btn.dataset.charAvatar;
        const hasChats = btn.dataset.hasChats === 'true';

        if (!charIndex || !charAvatar) {
            console.error('[Chat Lobby] No character selected');
            return;
        }
        
        // 캐시 무효화 (새 채팅 생성됨)
        invalidateChatsCache(charAvatar);

        closeLobby();
        await selectCharacterByIndex(parseInt(charIndex));

        // 채팅 기록이 있는 경우에만 새 채팅 버튼 클릭
        // (채팅이 없으면 SillyTavern이 자동으로 새 채팅 시작)
        if (hasChats) {
            setTimeout(() => {
                const newChatBtn = document.getElementById('option_start_new_chat');
                if (newChatBtn) {
                    newChatBtn.click();
                }
            }, 300);
        }
    }

    // 로비 열기
    function openLobby() {
        const overlay = document.getElementById('chat-lobby-overlay');
        const container = document.getElementById('chat-lobby-container');
        const fab = document.getElementById('chat-lobby-fab');
        
        if (overlay) {
            overlay.style.display = 'flex';
            if (container) container.style.display = 'flex';
            if (fab) fab.style.display = 'none';
            
            // 배치 모드 리셋
            if (batchModeActive) {
                batchModeActive = false;
                const chatsList = document.getElementById('chat-lobby-chats-list');
                const toolbar = document.getElementById('chat-lobby-batch-toolbar');
                const batchBtn = document.getElementById('chat-lobby-batch-mode');
                if (chatsList) chatsList.classList.remove('batch-mode');
                if (toolbar) toolbar.classList.remove('visible');
                if (batchBtn) batchBtn.classList.remove('active');
            }
            
            // 캐릭터 로딩 (약간의 딜레이 후 시도)
            setTimeout(() => {
                updateCharacterGrid();
                updatePersonaSelect();
                updateFolderFilterDropdown(); // 폴더 드롭다운 초기화
            }, 100);
            
            // 디버그: context 정보 출력
            const ctx = getContext();
            console.log('[Chat Lobby] Context available:', !!ctx);
            console.log('[Chat Lobby] Characters count:', ctx?.characters?.length || 0);
        }
    }
    
    // 전역 새로고침 함수
    window.chatLobbyRefresh = function() {
        updateCharacterGrid();
    };

    // 로비 닫기
    function closeLobby() {
        const container = document.getElementById('chat-lobby-container');
        const fab = document.getElementById('chat-lobby-fab');
        const overlay = document.getElementById('chat-lobby-overlay');
        
        if (container) container.style.display = 'none';
        if (fab) fab.style.display = 'flex';
        
        // 채팅 패널 숨기기
        const chatsPanel = document.getElementById('chat-lobby-chats');
        if (chatsPanel) {
            chatsPanel.classList.remove('visible');
        }
    }

    // 유틸리티 함수들
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function truncateText(text, maxLength) {
        if (!text) return '';
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }

    function formatDate(timestamp) {
        if (!timestamp) return '';
        try {
            const date = new Date(timestamp);
            if (isNaN(date.getTime())) return '';
            return date.toLocaleDateString('ko-KR', {
                month: 'short',
                day: 'numeric'
            });
        } catch {
            return '';
        }
    }

    function formatFileSize(bytes) {
        if (bytes === undefined || bytes === null || isNaN(bytes)) return '';
        bytes = Number(bytes);
        if (bytes < 1024) return bytes + 'B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
        return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
    }

    // 툴팁 위치 계산 및 표시 (PC 전용) - 단순 이벤트 위임
    function setupTooltipPositioning() {
        const chatsList = document.getElementById('chat-lobby-chats-list');
        if (!chatsList) return;

        // 터치 디바이스 체크
        const isDesktop = () => !('ontouchstart' in window) && !navigator.maxTouchPoints;
        
        // 전역 툴팁 요소 생성 (body에 직접 추가)
        let globalTooltip = document.getElementById('chat-lobby-global-tooltip');
        if (!globalTooltip) {
            globalTooltip = document.createElement('div');
            globalTooltip.id = 'chat-lobby-global-tooltip';
            globalTooltip.className = 'chat-global-tooltip';
            globalTooltip.innerHTML = '<div class="tooltip-header">📝 마지막 메시지</div><div class="tooltip-content"></div>';
            document.body.appendChild(globalTooltip);
        }
        
        const tooltipContent = globalTooltip.querySelector('.tooltip-content');
        let hoverTimer = null;
        let currentTarget = null;

        const hideTooltip = () => {
            globalTooltip.style.display = 'none';
            currentTarget = null;
            if (hoverTimer) {
                clearTimeout(hoverTimer);
                hoverTimer = null;
            }
        };

        const showTooltip = (text, x, y) => {
            if (!text) return;
            
            tooltipContent.textContent = text;
            globalTooltip.style.display = 'block';
            
            // 마우스 오른쪽에 표시
            let left = x + 20;
            let top = y - 100;

            // 화면 밖으로 나가면 조정
            if (top < 10) top = 10;
            if (top > window.innerHeight - 220) top = window.innerHeight - 220;

            globalTooltip.style.left = left + 'px';
            globalTooltip.style.top = top + 'px';
        };

        // 이벤트 위임 - mouseover/mouseout 사용
        chatsList.addEventListener('mouseover', (e) => {
            if (!isDesktop()) return;
            
            const chatItem = e.target.closest('.lobby-chat-item');
            if (!chatItem) return;
            
            // 같은 아이템이면 무시
            if (chatItem === currentTarget) return;
            
            // 이전 타이머 취소
            if (hoverTimer) clearTimeout(hoverTimer);
            hideTooltip();
            
            currentTarget = chatItem;
            const tooltipText = chatItem.dataset.tooltip;
            const mouseX = e.clientX;
            const mouseY = e.clientY;
            
            console.log('[Chat Lobby] Hover on chat item, tooltip:', tooltipText ? 'yes' : 'no');
            
            // 0.2초 후 표시
            hoverTimer = setTimeout(() => {
                if (tooltipText && currentTarget === chatItem) {
                    showTooltip(tooltipText, mouseX, mouseY);
                }
            }, 200);
        });
        
        chatsList.addEventListener('mouseout', (e) => {
            if (!isDesktop()) return;
            
            const chatItem = e.target.closest('.lobby-chat-item');
            if (!chatItem) return;
            
            // 다른 채팅 아이템으로 이동하는지 체크
            const relatedTarget = e.relatedTarget;
            const toItem = relatedTarget ? relatedTarget.closest('.lobby-chat-item') : null;
            
            // 아이템 밖으로 나갔거나 다른 아이템으로 이동
            if (!toItem || toItem !== chatItem) {
                hideTooltip();
            }
        });

        // 스크롤 시 숨김
        chatsList.addEventListener('scroll', hideTooltip);
    }

    // 초기화
    function init() {
        console.log('[Chat Lobby] Initializing...');
        
        // 기존 UI 제거
        const existingOverlay = document.getElementById('chat-lobby-overlay');
        if (existingOverlay) existingOverlay.remove();
        const existingFab = document.getElementById('chat-lobby-fab');
        if (existingFab) existingFab.remove();
        const existingModal = document.getElementById('chat-lobby-folder-modal');
        if (existingModal) existingModal.remove();

        document.body.insertAdjacentHTML('beforeend', createLobbyHTML());
        
        // FAB 버튼 초기 표시
        const fab = document.getElementById('chat-lobby-fab');
        if (fab) {
            fab.style.display = 'flex';
        }
        
        // 툴팁 위치 계산 설정
        setupTooltipPositioning();

        // 이벤트 리스너
        document.getElementById('chat-lobby-close').addEventListener('click', closeLobby);
        document.getElementById('chat-lobby-new-chat').addEventListener('click', startNewChat);
        
        // FAB 버튼 클릭
        document.getElementById('chat-lobby-fab').addEventListener('click', openLobby);
        
        // 채팅 패널 뒤로 가기 버튼 (좁은 화면용)
        document.getElementById('chat-lobby-chats-back').addEventListener('click', () => {
            const chatsPanel = document.getElementById('chat-lobby-chats');
            if (chatsPanel) {
                chatsPanel.classList.remove('visible');
            }
            // 캐릭터 선택 해제
            document.querySelectorAll('.lobby-char-card.selected').forEach(el => {
                el.classList.remove('selected');
            });
        });
        
        // 봇 프사 클릭 시 캐릭터 정보/편집 화면으로 이동 (설명, 인사말 등)
        document.getElementById('chat-panel-avatar').addEventListener('click', async () => {
            const selectedCard = document.querySelector('.lobby-char-card.selected');
            if (selectedCard) {
                const charIndex = selectedCard.dataset.charIndex;
                closeLobby();
                await selectCharacterByIndex(parseInt(charIndex));
                // 캐릭터 선택 후 우측 패널의 캐릭터 정보 화면 열기
                setTimeout(() => {
                    // 우측 drawer 열기
                    const rightDrawer = document.getElementById('rightNavDrawerIcon');
                    if (rightDrawer) {
                        rightDrawer.click();
                    }
                }, 300);
            }
        });
        
        // 새로고침 버튼
        document.getElementById('chat-lobby-refresh').addEventListener('click', () => {
            updateCharacterGrid();
            updatePersonaSelect();
            // 현재 선택된 캐릭터의 채팅도 새로고침
            const selectedCard = document.querySelector('.lobby-char-card.selected');
            if (selectedCard) {
                selectCharacter(selectedCard);
            }
        });
        
        // 캐릭터 임포트 버튼 (PNG 파일 가져오기) - 로비 위에서 작동
        document.getElementById('chat-lobby-import-char').addEventListener('click', () => {
            // 파일 input 직접 트리거 (SillyTavern ID: character_import_file)
            const fileInput = document.getElementById('character_import_file');
            if (fileInput) {
                // 파일 선택 후 로비 새로고침을 위한 이벤트 리스너 추가
                const refreshOnImport = () => {
                    setTimeout(() => {
                        updateCharacterGrid();
                    }, 1000);
                    fileInput.removeEventListener('change', refreshOnImport);
                };
                fileInput.addEventListener('change', refreshOnImport);
                fileInput.click();
            } else {
                console.log('[Chat Lobby] character_import_file not found');
            }
        });
        
        // 페르소나 추가 버튼 - drawer-icon 클릭하고 create_dummy_persona 클릭
        document.getElementById('chat-lobby-add-persona').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('[Chat Lobby] Add persona button clicked');
            
            closeLobby();
            
            // 페르소나 관리 drawer-icon 클릭
            setTimeout(() => {
                const personaDrawer = document.getElementById('persona-management-button');
                if (personaDrawer) {
                    const drawerIcon = personaDrawer.querySelector('.drawer-icon');
                    console.log('[Chat Lobby] drawer-icon for add:', drawerIcon);
                    if (drawerIcon) {
                        drawerIcon.click();
                        
                        // drawer 열린 후 create_dummy_persona 클릭
                        setTimeout(() => {
                            const createBtn = document.getElementById('create_dummy_persona');
                            console.log('[Chat Lobby] create_dummy_persona:', createBtn);
                            if (createBtn) {
                                createBtn.click();
                                console.log('[Chat Lobby] Clicked create_dummy_persona');
                            } else {
                                console.log('[Chat Lobby] create_dummy_persona not found');
                            }
                        }, 400);
                    }
                }
            }, 200);
        });
        
        // 캐릭터 삭제 버튼 - API로 직접 삭제 (로비 열린 상태)
        document.getElementById('chat-lobby-delete-char').addEventListener('click', async () => {
            const selectedCard = document.querySelector('.lobby-char-card.selected');
            if (!selectedCard) return;
            
            const charName = document.getElementById('chat-panel-name').textContent;
            const charAvatar = selectedCard.dataset.charAvatar;
            
            if (!confirm(`"${charName}" 캐릭터를 삭제하시겠습니까?\n\n모든 채팅 기록도 함께 삭제됩니다.\n이 작업은 되돌릴 수 없습니다.`)) return;
            
            // 채팅도 삭제할지 추가 확인
            const deleteChats = confirm('채팅 기록도 함께 삭제하시겠습니까?\n\n취소를 누르면 캐릭터만 삭제됩니다.');
            
            try {
                const response = await fetch('/api/characters/delete', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify({
                        avatar_url: charAvatar,
                        delete_chats: deleteChats
                    })
                });
                
                if (response.ok) {
                    console.log('[Chat Lobby] Character deleted:', charName);
                    // 채팅 패널 닫기
                    const chatsPanel = document.getElementById('chat-lobby-chats');
                    if (chatsPanel) chatsPanel.classList.remove('visible');
                    // 캐릭터 목록 새로고침
                    await updateCharacterGrid();
                } else {
                    console.error('[Chat Lobby] Failed to delete character:', response.status);
                    alert('캐릭터 삭제에 실패했습니다.');
                }
            } catch (error) {
                console.error('[Chat Lobby] Error deleting character:', error);
                alert('캐릭터 삭제 중 오류가 발생했습니다.');
            }
        });
        
        // 폴더 필터 변경 - 데스크톱 + 모바일
        const folderFilter = document.getElementById('chat-lobby-folder-filter');
        folderFilter.addEventListener('change', (e) => {
            const newValue = e.target.value;
            console.log('[Chat Lobby] Filter changed to:', newValue);
            setFilterFolder(newValue);
            // 선택된 캐릭터 다시 로드 (필터값 유지)
            const selectedCard = document.querySelector('.lobby-char-card.selected');
            if (selectedCard) {
                // selectCharacter를 직접 호출하지 않고 채팅만 다시 로드
                reloadChatsWithFilter(selectedCard, newValue);
            }
        });
        
        // 채팅 정렬 변경 - 모바일 호환성을 위해 여러 이벤트 사용
        const chatSortSelect = document.getElementById('chat-lobby-chat-sort');
        let lastChatSortValue = loadLobbyData().sortOption || 'recent';
        chatSortSelect.value = lastChatSortValue;
        
        const applyChatSort = () => {
            const newSort = chatSortSelect.value;
            if (newSort === lastChatSortValue) return;
            
            lastChatSortValue = newSort;
            setSortOption(newSort);
            
            const selectedCard = document.querySelector('.lobby-char-card.selected');
            if (selectedCard) {
                const currentFilter = document.getElementById('chat-lobby-folder-filter')?.value || 'all';
                reloadChatsWithFilter(selectedCard, currentFilter);
            }
        };
        
        // 모든 가능한 이벤트에 리스너 추가
        chatSortSelect.addEventListener('change', applyChatSort);
        chatSortSelect.addEventListener('blur', applyChatSort);
        chatSortSelect.addEventListener('touchend', () => setTimeout(applyChatSort, 100));
        
        // 배치 모드 버튼 - 터치 중복 방지
        const batchModeBtn = document.getElementById('chat-lobby-batch-mode');
        let batchTouchHandled = false;
        const handleBatchMode = (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleBatchMode();
        };
        batchModeBtn.addEventListener('touchstart', () => { batchTouchHandled = false; }, { passive: true });
        batchModeBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            e.stopPropagation();
            batchTouchHandled = true;
            handleBatchMode(e);
        });
        batchModeBtn.addEventListener('click', (e) => {
            if (!batchTouchHandled) handleBatchMode(e);
            batchTouchHandled = false;
        });
        
        // 폴더 관리 버튼 - 터치 중복 방지
        const folderManageBtn = document.getElementById('chat-lobby-folder-manage');
        let folderManageTouchHandled = false;
        const handleFolderManage = (e) => {
            e.preventDefault();
            e.stopPropagation();
            openFolderModal();
        };
        folderManageBtn.addEventListener('touchstart', () => { folderManageTouchHandled = false; }, { passive: true });
        folderManageBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            e.stopPropagation();
            folderManageTouchHandled = true;
            handleFolderManage(e);
        });
        folderManageBtn.addEventListener('click', (e) => {
            if (!folderManageTouchHandled) handleFolderManage(e);
            folderManageTouchHandled = false;
        });
        
        // 폴더 모달 닫기
        document.getElementById('folder-modal-close').addEventListener('click', closeFolderModal);
        
        // 폴더 추가 - 터치 중복 방지
        const addFolderBtn = document.getElementById('add-folder-btn');
        let addFolderTouchHandled = false;
        const handleAddFolder = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const input = document.getElementById('new-folder-name');
            const name = input.value.trim();
            if (name) {
                addFolder(name);
                input.value = '';
                refreshFolderList();
                updateFolderFilterDropdown();
            }
        };
        addFolderBtn.addEventListener('touchstart', () => { addFolderTouchHandled = false; }, { passive: true });
        addFolderBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            e.stopPropagation();
            addFolderTouchHandled = true;
            handleAddFolder(e);
        });
        addFolderBtn.addEventListener('click', (e) => {
            if (!addFolderTouchHandled) handleAddFolder(e);
            addFolderTouchHandled = false;
        });
        
        // Enter 키로 폴더 추가
        document.getElementById('new-folder-name').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                document.getElementById('add-folder-btn').click();
            }
        });
        
        // 배치 이동 버튼 - 터치 중복 방지
        const batchMoveBtn = document.getElementById('batch-move-btn');
        let batchMoveTouchHandled = false;
        const handleBatchMove = (e) => {
            e.preventDefault();
            e.stopPropagation();
            executeBatchMove();
        };
        batchMoveBtn.addEventListener('touchstart', () => { batchMoveTouchHandled = false; }, { passive: true });
        batchMoveBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            e.stopPropagation();
            batchMoveTouchHandled = true;
            handleBatchMove(e);
        });
        batchMoveBtn.addEventListener('click', (e) => {
            if (!batchMoveTouchHandled) handleBatchMove(e);
            batchMoveTouchHandled = false;
        });
        
        // 배치 취소 버튼 - 터치 중복 방지
        const batchCancelBtn = document.getElementById('batch-cancel-btn');
        let batchCancelTouchHandled = false;
        const handleBatchCancel = (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleBatchMode();
        };
        batchCancelBtn.addEventListener('touchstart', () => { batchCancelTouchHandled = false; }, { passive: true });
        batchCancelBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            e.stopPropagation();
            batchCancelTouchHandled = true;
            handleBatchCancel(e);
        });
        batchCancelBtn.addEventListener('click', (e) => {
            if (!batchCancelTouchHandled) handleBatchCancel(e);
            batchCancelTouchHandled = false;
        });
        
        // 채팅 체크박스 변경 감지 (이벤트 위임)
        document.getElementById('chat-lobby-chats-list').addEventListener('change', (e) => {
            if (e.target.classList.contains('chat-select-cb')) {
                updateBatchCount();
            }
        });

        // 검색 기능
        const searchInput = document.getElementById('chat-lobby-search-input');
        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                updateCharacterGrid(e.target.value);
            }, 300);
        });
        
        // 캐릭터 정렬 드롭다운 변경 이벤트 - 모바일 호환성을 위해 여러 이벤트 사용
        const charSortSelect = document.getElementById('chat-lobby-char-sort');
        let lastCharSortValue = loadLobbyData().charSortOption || 'recent';
        charSortSelect.value = lastCharSortValue;
        
        const applyCharSort = () => {
            const newSort = charSortSelect.value;
            if (newSort === lastCharSortValue) return;
            
            lastCharSortValue = newSort;
            setCharSortOption(newSort);
            const currentSearch = searchInput.value;
            updateCharacterGrid(currentSearch);
        };
        
        // 모든 가능한 이벤트에 리스너 추가
        charSortSelect.addEventListener('change', applyCharSort);
        charSortSelect.addEventListener('blur', applyCharSort);
        charSortSelect.addEventListener('touchend', () => setTimeout(applyCharSort, 100));

        // ESC 키로 닫기
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const modal = document.getElementById('chat-lobby-folder-modal');
                if (modal && modal.style.display !== 'none') {
                    closeFolderModal();
                    return;
                }
                const container = document.getElementById('chat-lobby-container');
                if (container && container.style.display !== 'none') {
                    closeLobby();
                }
            }
        });
        
        // SillyTavern 옵션 메뉴에 로비 버튼 추가
        addLobbyToOptionsMenu();

        console.log('[Chat Lobby] Extension initialized');

        // 자동 실행
        setTimeout(() => {
            openLobby();
        }, 100);
    }
    
    // SillyTavern 옵션 메뉴에 로비 버튼 추가
    function addLobbyToOptionsMenu() {
        // 옵션 팝업 메뉴 찾기
        const optionsMenu = document.getElementById('options');
        if (!optionsMenu) {
            console.log('[Chat Lobby] Options menu not found, retrying...');
            setTimeout(addLobbyToOptionsMenu, 1000);
            return;
        }
        
        // 이미 추가되었는지 확인
        if (document.getElementById('option_chat_lobby')) return;
        
        // 로비 버튼 생성
        const lobbyOption = document.createElement('a');
        lobbyOption.id = 'option_chat_lobby';
        lobbyOption.innerHTML = '<i class="fa-solid fa-comments"></i> Chat Lobby';
        lobbyOption.style.cssText = 'cursor: pointer;';
        lobbyOption.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // 옵션 메뉴 닫기
            const optionsBtn = document.getElementById('options_button');
            if (optionsBtn) optionsBtn.click();
            // 로비 열기
            setTimeout(openLobby, 100);
        });
        
        // 메뉴 맨 앞에 추가
        optionsMenu.insertBefore(lobbyOption, optionsMenu.firstChild);
        console.log('[Chat Lobby] Added to options menu');
    }

    // DOM 로드 후 초기화
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 1000);
    }

})();
