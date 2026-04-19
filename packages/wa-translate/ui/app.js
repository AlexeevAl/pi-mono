const socket = io();
const messageContainer = document.getElementById('message-container');
const chatList = document.getElementById('chat-list');
const modeSelector = document.getElementById('mode-selector');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const inputArea = document.getElementById('input-area');

let activeChats = new Set();
let selectedChatId = null;

function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getFlag(lang) {
    const map = { ru: '🇷🇺', he: '🇮🇱', en: '🇺🇸', es: '🇪🇸', fr: '🇫🇷', de: '🇩🇪' };
    return map[lang.toLowerCase()] || `[${lang.toUpperCase()}]`;
}

function formatChatId(id) {
    if (!id) return '';
    if (id.includes('@')) {
        const num = id.split('@')[0];
        if (/^\d+$/.test(num)) return '+' + num;
        return num;
    }
    return id;
}

function addMessage(data) {
    // Remove empty state if present
    if (messageContainer.querySelector('.opacity-20')) {
        messageContainer.innerHTML = '';
    }

    // Only show messages for the selected chat, or show all if nothing selected
    // Note: In a real app we'd filter locally, but for simplicity let's just mark the card
    const card = document.createElement('div');
    card.dataset.chatId = data.chatId;
    card.className = `message-card p-4 rounded-2xl glass mb-4 flex flex-col gap-2 ${data.fromMe ? 'border-l-4 border-blue-500' : 'border-l-4 border-emerald-500'}`;
    
    // If we have a selected chat, hide messages from others
    if (selectedChatId && data.chatId !== selectedChatId) {
        card.classList.add('hidden');
    }
    
    const meta = document.createElement('div');
    meta.className = 'flex justify-between items-center text-xs text-slate-400 mb-1';
    meta.innerHTML = `
        <span class="font-bold text-slate-300">${data.chatName || formatChatId(data.chatId)}</span>
        <span>${formatTime(data.timestamp)}</span>
    `;

    const source = document.createElement('div');
    source.className = `text-sm text-slate-500 italic ${data.targetLang === 'he' ? 'hebrew' : ''}`;
    source.textContent = data.text;

    const translation = document.createElement('div');
    translation.className = 'text-base font-medium text-white flex gap-2 items-start';
    translation.innerHTML = `
        <span class="mt-1">${getFlag(data.targetLang)}</span>
        <span>${data.translatedText}</span>
    `;

    card.appendChild(meta);
    card.appendChild(source);
    card.appendChild(translation);
    
    messageContainer.appendChild(card);
    messageContainer.scrollTop = messageContainer.scrollHeight;

    // Update active chats
    if (!activeChats.has(data.chatId)) {
        activeChats.add(data.chatId);
        updateSidebar(data.chatId, data.chatName);
    }
}

function updateSidebar(chatId, chatName) {
    const nameToDisplay = chatName || formatChatId(chatId);
    const safeId = `chat-${chatId.replace(/[@.]/g, '-')}`;
    let item = document.getElementById(safeId);
    
    if (!item) {
        if (!activeChats.has(chatId)) activeChats.add(chatId);
        
        item = document.createElement('div');
        item.id = safeId;
        item.className = 'chat-item group flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all hover:bg-white/5 active:scale-95';
        item.onclick = () => selectChat(chatId, chatName);
        
        item.innerHTML = `
            <div class="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-xs ring-2 ring-indigo-500/30">
                ${nameToDisplay.charAt(0).toUpperCase()}
            </div>
            <div class="flex-1 min-w-0">
                <div class="font-medium text-slate-200 truncate group-hover:text-white">${nameToDisplay}</div>
                <div class="text-[10px] text-slate-500 flex items-center gap-1">
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    Active
                </div>
            </div>
        `;
        chatList.appendChild(item);
    } else {
        // Update name if it changed
        const nameEl = item.querySelector('.font-medium');
        if (nameEl && nameEl.textContent !== nameToDisplay) {
            nameEl.textContent = nameToDisplay;
            item.querySelector('.w-8').textContent = nameToDisplay.charAt(0).toUpperCase();
        }
    }
}

function selectChat(chatId) {
    selectedChatId = chatId;
    
    // Highlight sidebar
    document.querySelectorAll('#chat-list .chat-item').forEach(b => b.classList.remove('bg-slate-800', 'border', 'border-slate-700'));
    const activeBtn = document.getElementById(`chat-${chatId.replace(/[@.]/g, '-')}`);
    if (activeBtn) activeBtn.classList.add('bg-slate-800', 'border', 'border-slate-700');

    // Show input area
    inputArea.classList.remove('hidden');
    messageInput.focus();

    // Filter messages
    document.querySelectorAll('.message-card').forEach(card => {
        if (card.dataset.chatId === chatId) {
            card.classList.remove('hidden');
        } else {
            card.classList.add('hidden');
        }
    });
}

function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !selectedChatId) return;

    socket.emit('message:send', { chatId: selectedChatId, text });
    messageInput.value = '';
}

sendBtn.onclick = sendMessage;
messageInput.onkeydown = (e) => {
    if (e.key === 'Enter') sendMessage();
};

socket.on('translation', (data) => {
    addMessage(data);
});

socket.on('chats', (chats) => {
    // Fill the sidebar
    chats.forEach(chat => {
        updateSidebar(chat.id, chat.name);
    });

    // Update empty state text if we have chats but no messages
    if (activeChats.size > 0 && messageContainer.querySelector('.opacity-20 p')) {
        messageContainer.querySelector('.opacity-20 p').textContent = 'Select a chat from the left to start.';
    }
});

socket.on('history', (history) => {
    if (history.length > 0) {
        messageContainer.innerHTML = '';
        history.forEach(addMessage);
    }
});

modeSelector.onchange = () => {
    socket.emit('command', { command: 'mode', args: { value: modeSelector.value } });
};
