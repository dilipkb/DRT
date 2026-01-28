// --- State Management ---
let chatHistoryItems = [];
let selectedFiles = [];

const messagesContainer = document.getElementById('messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const historyList = document.getElementById('chat-history');
const fileInput = document.getElementById('chat-file-upload');
const attachBtn = document.getElementById('attach-btn');
const filePreview = document.getElementById('file-preview');
const previewName = document.getElementById('preview-name');
const removeFileBtn = document.getElementById('remove-file');
const themeToggle = document.getElementById('theme-toggle');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Load saved theme
    const savedTheme = localStorage.getItem('theme') || 'light';
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
        themeToggle.checked = false;
    } else {
        themeToggle.checked = true;
    }

    setupEventListeners();
});

function setupEventListeners() {
    // Theme Switch
    themeToggle.addEventListener('change', (e) => {
        if (e.target.checked) {
            document.body.classList.remove('dark-mode'); // Light Mode
            localStorage.setItem('theme', 'light');
        } else {
            document.body.classList.add('dark-mode'); // Dark Mode
            localStorage.setItem('theme', 'dark');
        }
    });

    sendBtn.addEventListener('click', handleSendMessage);
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    // Auto-resize textarea
    chatInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });

    // Paste Logic
    chatInput.addEventListener('paste', (e) => {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (let item of items) {
            if (item.kind === 'file') {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) {
                    addFile(file);
                }
            }
        }
    });
    
    // File Attachment Logic
    attachBtn.addEventListener('click', () => fileInput.click());
    
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            for (let file of e.target.files) {
                addFile(file);
            }
        }
    });
}

// Clear all files (Removed general clear button, now handled by chips)
/* 
removeFileBtn.addEventListener('click', () => {
    selectedFiles = [];
    fileInput.value = '';
    renderFilePreview();
});
*/

function addFile(file) {
    if (selectedFiles.length >= 5) {
        alert("Maximum 5 files allowed.");
        return;
    }
    // Prevent duplicates
    if (selectedFiles.some(f => f.name === file.name && f.size === file.size)) {
        return;
    }
    selectedFiles.push(file);
    renderFilePreview();
}

function removeFile(index) {
    selectedFiles.splice(index, 1);
    fileInput.value = ''; // Reset input to allow re-selection
    renderFilePreview();
}

function renderFilePreview() {
    filePreview.innerHTML = ''; // Clear container

    if (selectedFiles.length === 0) {
        filePreview.classList.add('hidden');
        return;
    }
    
    selectedFiles.forEach((file, index) => {
        const chip = document.createElement('div');
        chip.className = 'file-chip';
        // Check if image for icon
        const icon = file.type.startsWith('image/') ? 'image' : 'file';
        
        chip.innerHTML = `
            <i data-lucide="${icon}" width="14" height="14"></i>
            <span>${file.name}</span>
            <button onclick="window.removeFileWrapper(${index})"><i data-lucide="x" width="14" height="14"></i></button>
        `;
        filePreview.appendChild(chip);
    });

    filePreview.classList.remove('hidden');
    lucide.createIcons();
}

// Global wrapper to access from inline HTML
window.removeFileWrapper = (index) => {
    removeFile(index);
};

// --- Chat Actions ---

async function handleSendMessage() {
    const text = chatInput.value.trim();
    if (!text && selectedFiles.length === 0) return;

    // Reset UI for first message
    if (messagesContainer.querySelector('.hero-section')) {
        messagesContainer.innerHTML = '';
        messagesContainer.classList.add('chat-active');
    }

    // Prepare content display
    let attachmentHTML = '';
    
    selectedFiles.forEach(file => {
        if (file.type.startsWith('image/')) {
            const imageUrl = URL.createObjectURL(file);
            attachmentHTML += `<div class="chat-media"><img src="${imageUrl}" alt="Uploaded Image"></div>`;
        } else {
            attachmentHTML += `<div class="chat-attachment"><i data-lucide="file"></i> ${file.name}</div>`;
        }
    });

    const userMsgContent = (text ? `<div>${text}</div>` : '') + attachmentHTML;
    appendMessage('user', userMsgContent);
    
    chatInput.value = '';
    chatInput.style.height = 'auto';
    
    // Prepare data for backend
    const formData = new FormData();
    formData.append('prompt', text || "Analyze these files"); 
    
    selectedFiles.forEach(file => {
        formData.append('files', file); 
    });
    
    // Clear attachment state
    selectedFiles = [];
    fileInput.value = '';
    renderFilePreview();
    
    // Typing state
    const loadingId = appendMessage('bot', '<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>', true);

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            body: formData // Send as multipart/form-data
        });
        
        const data = await response.json();
        
        if (response.ok) {
            updateMessage(loadingId, data.response);
            if (text) addToHistory(text);
        } else {
            updateMessage(loadingId, `**Error:** ${data.error || 'Something went wrong.'}`);
        }

    } catch (error) {
        updateMessage(loadingId, '**Connection Error:** Failed to reach the consultant.');
    }
}

function appendMessage(role, text, isHtml = false) {
    const id = Date.now();
    const div = document.createElement('div');
    div.className = `message-wrapper ${role}`;
    div.id = `msg-${id}`;
    
    // Add avatar icons
    const icon = role === 'user' 
        ? '<div class="avatar user"><i data-lucide="user"></i></div>'
        : '<div class="avatar bot"><i data-lucide="zap"></i></div>';

    div.innerHTML = `
        ${role === 'bot' ? icon : ''}
        <div class="message-bubble">
            <div class="message-text">${text}</div>
        </div>
        ${role === 'user' ? icon : ''}
    `;
    
    messagesContainer.appendChild(div);
    lucide.createIcons();
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return id;
}

function updateMessage(id, text) {
    const el = document.querySelector(`#msg-${id} .message-text`);
    if (el) {
        // Use marked for rich markdown rendering
        el.innerHTML = marked.parse(text);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

function addToHistory(text) {
    if (historyList.querySelector('.history-empty')) {
        historyList.innerHTML = '';
    }
    
    const div = document.createElement('div');
    div.className = 'history-item';
    div.textContent = text;
    div.onclick = () => {
        chatInput.value = text;
        chatInput.focus();
    };
    
    historyList.prepend(div);
}
