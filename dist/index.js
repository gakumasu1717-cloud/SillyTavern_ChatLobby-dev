// Chat Lobby Extension for SillyTavern
// 캐릭터 기반 채팅방 선택 UI + 페르소나 선택

(function() {
    'use strict';

    console.log('[Chat Lobby] Loading extension...');

    const extensionName = 'Chat Lobby';
    const extensionFolderPath = 'third-party/SillyTavern-ChatLobby';

    // SillyTavern API 접근
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

    // 로비 UI HTML
    function createLobbyHTML() {
        return `
        <div id="chat-lobby-fab" title="Chat Lobby 열기">💬</div>
        <div id="chat-lobby-overlay" style="display: none;">
            <div id="chat-lobby-container">
                <div id="chat-lobby-header">
                    <h2>Chat Lobby</h2>
                    <button id="chat-lobby-close">✕</button>
                </div>
                <div id="chat-lobby-persona-bar">
                    <div id="chat-lobby-persona-list">
                        <div class="lobby-loading">로딩 중...</div>
                    </div>
                </div>
                <div id="chat-lobby-search">
                    <input type="text" id="chat-lobby-search-input" placeholder="캐릭터 검색...">
                </div>
                <div id="chat-lobby-content">
                    <div id="chat-lobby-characters">
                        <div class="lobby-loading">캐릭터 로딩 중...</div>
                    </div>
                    <div id="chat-lobby-chats">
                        <div id="chat-lobby-chats-header">
                            <button id="chat-lobby-chats-close" title="닫기">←</button>
                            <img src="" alt="avatar" id="chat-panel-avatar">
                            <div class="char-info">
                                <div class="char-name" id="chat-panel-name">캐릭터 선택</div>
                                <div class="chat-count" id="chat-panel-count">채팅 목록</div>
                            </div>
                            <button id="chat-lobby-new-chat">+ 새 채팅</button>
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
        
        // 모든 페르소나 아바타 + 이름 표시
        let html = '';
        personas.forEach(persona => {
            const isSelected = persona.key === currentPersona ? 'selected' : '';
            const avatarUrl = `/User Avatars/${encodeURIComponent(persona.key)}`;
            html += `<div class="persona-item ${isSelected}" data-persona="${escapeHtml(persona.key)}" title="${escapeHtml(persona.name)}">
                <img class="persona-avatar" src="${avatarUrl}" alt="" onerror="this.outerHTML='<div class=persona-avatar>👤</div>'">
                <span class="persona-name">${escapeHtml(persona.name)}</span>
            </div>`;
        });
        
        container.innerHTML = html;
        
        // 클릭 이벤트
        container.querySelectorAll('.persona-item').forEach(item => {
            item.addEventListener('click', () => {
                container.querySelectorAll('.persona-item').forEach(el => el.classList.remove('selected'));
                item.classList.add('selected');
                changePersona(item.dataset.persona);
            });
        });
        
        console.log('[Chat Lobby] Persona list updated with', personas.length, 'items');
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
                    return;
                }
            } catch (e) {
                console.log('[Chat Lobby] Could not use setUserAvatar:', e);
            }
            
            // 폴백: SillyTavern context
            if (typeof window.SillyTavern?.getContext?.()?.setUserAvatar === 'function') {
                await window.SillyTavern.getContext().setUserAvatar(personaKey);
                console.log('[Chat Lobby] Persona changed via context');
                return;
            }
            
            console.warn('[Chat Lobby] Persona change failed for:', personaKey);
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

    // 캐릭터의 채팅 목록 로드
    async function loadChatsForCharacter(characterAvatar) {
        console.log('[Chat Lobby] Fetching chats for:', characterAvatar);
        if (!characterAvatar) return [];

        try {
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
                return []; // 에러 시 빈 배열 반환
            }
            const data = await response.json();
            console.log('[Chat Lobby] Raw chat data:', JSON.stringify(data).substring(0, 500));
            
            // error 응답 처리
            if (data && data.error === true) {
                return [];
            }
            
            return data || [];
        } catch (error) {
            console.error('[Chat Lobby] Failed to load chats:', error);
            return []; // 에러 시 빈 배열 반환
        }
    }

    // 캐릭터 카드 렌더링
    function renderCharacterCard(char, index) {
        const avatarUrl = char.avatar ? `/characters/${encodeURIComponent(char.avatar)}` : '/img/ai4.png';
        const name = char.name || 'Unknown';
        const safeAvatar = (char.avatar || '').replace(/"/g, '&quot;');

        return `
        <div class="lobby-char-card" data-char-index="${index}" data-char-avatar="${safeAvatar}">
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
        
        // 메타 정보 구성 (메시지 수만)
        const metaInfo = messageCount > 0 ? `💬 ${messageCount}개` : '';

        return `
        <div class="lobby-chat-item" data-file-name="${escapeHtml(fileName)}" data-char-avatar="${safeAvatar}" data-chat-index="${chatIndex}">
            <div class="chat-content">
                <div class="chat-name">${escapeHtml(displayName)}</div>
                <div class="chat-preview">${escapeHtml(truncateText(preview, 80))}</div>
                <div class="chat-meta">
                    ${metaInfo ? `<span>${metaInfo}</span>` : ''}
                </div>
            </div>
            <button class="chat-delete-btn" title="채팅 삭제">🗑️</button>
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
        let filtered = characters;
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            filtered = characters.filter(char =>
                (char.name || '').toLowerCase().includes(term)
            );
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

        // 캐릭터 카드 클릭 이벤트
        container.querySelectorAll('.lobby-char-card').forEach(card => {
            card.addEventListener('click', () => selectCharacter(card));
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

        // 채팅 패널 표시
        const chatsPanel = document.getElementById('chat-lobby-chats');
        chatsPanel.classList.add('visible');

        // 헤더 업데이트
        document.getElementById('chat-panel-avatar').src = avatarSrc;
        document.getElementById('chat-panel-name').textContent = charName;
        document.getElementById('chat-panel-count').textContent = '채팅 로딩 중...';

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
            // 유효한 파일명: .jsonl 확장자 또는 날짜 패턴 포함
            return fileName && 
                   (fileName.includes('.jsonl') || fileName.match(/\d{4}-\d{2}-\d{2}/)) &&
                   !fileName.startsWith('chat_') &&
                   fileName.toLowerCase() !== 'error';
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
        chatArray.sort((a, b) => {
            let dateA = 0, dateB = 0;
            
            // 파일명에서 날짜 추출 (예: 서진욱 - 2025-12-22@11h31m00s.jsonl)
            const fnA = a.file_name || '';
            const fnB = b.file_name || '';
            
            // 날짜 파싱 함수
            function parseDate(filename) {
                // 형식: YYYY-MM-DD@HHhMMmSSs
                const m = filename.match(/(\d{4})-(\d{2})-(\d{2})@(\d{2})h(\d{2})m(\d{2})s/);
                if (m) {
                    return new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]).getTime();
                }
                // 형식: YYYY-MM-DD@HHh MMm SSs (ms 포함)
                const m2 = filename.match(/(\d{4})-(\d{2})-(\d{2})\s*@?(\d{2})h\s*(\d{2})m\s*(\d{2})s/);
                if (m2) {
                    return new Date(+m2[1], +m2[2]-1, +m2[3], +m2[4], +m2[5], +m2[6]).getTime();
                }
                return 0;
            }
            
            dateA = parseDate(fnA);
            dateB = parseDate(fnB);
            
            // 파일명에서 못 찾으면 다른 필드 시도
            if (!dateA && a.last_mes) dateA = typeof a.last_mes === 'number' ? a.last_mes : new Date(a.last_mes).getTime();
            if (!dateB && b.last_mes) dateB = typeof b.last_mes === 'number' ? b.last_mes : new Date(b.last_mes).getTime();
            
            console.log('[Chat Lobby] Sort:', fnA, dateA, 'vs', fnB, dateB);
            return dateB - dateA; // 내림차순 (최신이 위)
        });

        document.getElementById('chat-panel-count').textContent = `${chatArray.length}개 채팅`;
        chatsList.innerHTML = chatArray.map((chat, idx) => renderChatItem(chat, charAvatar, idx)).join('');

        // 채팅 아이템 클릭 이벤트
        chatsList.querySelectorAll('.lobby-chat-item').forEach(item => {
            // 채팅 열기 (컨텐츠 클릭)
            item.querySelector('.chat-content').addEventListener('click', () => openChat(item));
            
            // 삭제 버튼
            item.querySelector('.chat-delete-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                deleteChat(item);
            });
        });
    }

    // 채팅 열기
    async function openChat(chatElement) {
        const fileName = chatElement.dataset.fileName;
        const charAvatar = chatElement.dataset.charAvatar;
        const chatIndex = parseInt(chatElement.dataset.chatIndex) || 0;

        if (!charAvatar) {
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

            // 채팅 열기 - 딜레이 최소화
            setTimeout(async () => {
                await openChatByIndex(chatIndex, charAvatar);
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

    // 인덱스로 채팅 열기
    async function openChatByIndex(chatIndex, charAvatar) {
        try {
            // 채팅 관리 버튼 클릭
            const manageChatsBtn = document.getElementById('option_select_chat');
            if (manageChatsBtn) {
                manageChatsBtn.click();

                // 채팅 목록에서 해당 채팅 선택 - 딜레이 최소화
                setTimeout(() => {
                    const chatItems = document.querySelectorAll('.select_chat_block');
                    if (chatItems[chatIndex]) {
                        chatItems[chatIndex].click();
                    }
                }, 200);
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
            
            // 캐릭터 로딩 (약간의 딜레이 후 시도)
            setTimeout(() => {
                updateCharacterGrid();
                updatePersonaSelect();
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



    // 초기화
    function init() {
        console.log('[Chat Lobby] Initializing...');
        
        // 기존 UI 제거
        const existingOverlay = document.getElementById('chat-lobby-overlay');
        if (existingOverlay) existingOverlay.remove();
        const existingFab = document.getElementById('chat-lobby-fab');
        if (existingFab) existingFab.remove();

        document.body.insertAdjacentHTML('beforeend', createLobbyHTML());
        
        // FAB 버튼 초기 표시
        const fab = document.getElementById('chat-lobby-fab');
        if (fab) {
            fab.style.display = 'flex';
        }

        // 이벤트 리스너
        document.getElementById('chat-lobby-close').addEventListener('click', closeLobby);
        document.getElementById('chat-lobby-new-chat').addEventListener('click', startNewChat);
        
        // FAB 버튼 클릭
        document.getElementById('chat-lobby-fab').addEventListener('click', openLobby);
        
        // 채팅 패널 닫기 버튼 (모바일용)
        document.getElementById('chat-lobby-chats-close').addEventListener('click', () => {
            const chatsPanel = document.getElementById('chat-lobby-chats');
            if (chatsPanel) {
                chatsPanel.classList.remove('visible');
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

        // ESC 키로 닫기
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
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
