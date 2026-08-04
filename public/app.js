const form = document.querySelector('#chat-form');
const input = document.querySelector('#message-input');
const messages = document.querySelector('#messages');
const handoffButton = document.querySelector('#handoff-button');
const history = [];

function addMessage(content, role) {
  const element = document.createElement('div');
  element.className = `message message--${role}`;
  element.textContent = content;
  messages.append(element);
  messages.scrollTop = messages.scrollHeight;
  return element;
}

function openTawkWidget() {
  if (window.Tawk_API && typeof window.Tawk_API.maximize === 'function') {
    window.Tawk_API.maximize();
    return;
  }

  addMessage(
    'Widget tawk.to belum dipasang pada halaman demo ini. Pasang script Property ID kampus agar tombol dapat membuka live chat.',
    'bot'
  );
}

handoffButton.addEventListener('click', openTawkWidget);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = input.value.trim();

  if (!message) return;

  addMessage(message, 'user');
  input.value = '';
  input.disabled = true;
  const loading = addMessage('Sedang mencari informasi...', 'bot');

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: history.slice(-6) })
    });
    const result = await response.json();
    loading.remove();
    addMessage(result.answer ?? 'Layanan sedang mengalami gangguan.', 'bot');

    history.push(
      { role: 'user', content: message },
      { role: 'assistant', content: result.answer ?? '' }
    );

    handoffButton.hidden = result.decision !== 'HANDOFF';
    
  } catch {
    loading.remove();
    addMessage('Layanan otomatis sedang tidak tersedia. Silakan hubungi customer service.', 'bot');
    handoffButton.hidden = false;
  } finally {
    input.disabled = false;
    input.focus();
  }
});

