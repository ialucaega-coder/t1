(function () {
  'use strict';

  var d = document;
  var scriptTag = d.currentScript;
  var botId = scriptTag && scriptTag.getAttribute('data-bot-id');
  var position = (scriptTag && scriptTag.getAttribute('data-position')) || 'right';
  var color = (scriptTag && scriptTag.getAttribute('data-color')) || '#0EA5E9';
  var baseUrl = scriptTag ? scriptTag.src.replace(/\/widget\.js.*$/, '') : '';

  if (!botId) {
    console.warn('[LocalB Widget] Missing data-bot-id attribute');
    return;
  }

  var isOpen = false;
  var container = d.createElement('div');
  container.id = 'localb-widget';
  container.innerHTML = '';
  d.body.appendChild(container);

  var style = d.createElement('style');
  style.textContent =
    '#localb-widget{position:fixed;bottom:20px;z-index:99999;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}' +
    '#localb-widget.pos-right{right:20px}' +
    '#localb-widget.pos-left{left:20px}' +
    '#localb-btn{width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 24px rgba(0,0,0,.3);transition:transform .2s,box-shadow .2s}' +
    '#localb-btn:hover{transform:scale(1.08);box-shadow:0 6px 32px rgba(0,0,0,.4)}' +
    '#localb-btn svg{width:28px;height:28px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
    '#localb-frame-wrap{display:none;position:absolute;bottom:72px;width:380px;height:560px;border-radius:16px;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.08);background:#0B0F14}' +
    '#localb-widget.pos-right #localb-frame-wrap{right:0}' +
    '#localb-widget.pos-left #localb-frame-wrap{left:0}' +
    '#localb-frame-wrap.open{display:block;animation:localb-slide-up .25s ease-out}' +
    '#localb-frame{width:100%;height:100%;border:none}' +
    '@keyframes localb-slide-up{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}' +
    '@media(max-width:420px){#localb-frame-wrap{width:calc(100vw - 24px);height:calc(100vh - 100px);bottom:72px}#localb-widget.pos-right #localb-frame-wrap{right:-8px}#localb-widget.pos-left #localb-frame-wrap{left:-8px}}';
  d.head.appendChild(style);

  container.className = 'pos-' + position;

  var frameWrap = d.createElement('div');
  frameWrap.id = 'localb-frame-wrap';
  var iframe = d.createElement('iframe');
  iframe.id = 'localb-frame';
  iframe.src = baseUrl + '/chat/' + botId;
  iframe.title = 'Chat';
  iframe.allow = 'clipboard-write';
  frameWrap.appendChild(iframe);
  container.appendChild(frameWrap);

  var btn = d.createElement('button');
  btn.id = 'localb-btn';
  btn.style.backgroundColor = color;
  btn.setAttribute('aria-label', 'Abrir chat');
  btn.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  container.appendChild(btn);

  var chatIcon = '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var closeIcon = '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  btn.addEventListener('click', function () {
    isOpen = !isOpen;
    frameWrap.className = isOpen ? 'open' : '';
    btn.innerHTML = isOpen ? closeIcon : chatIcon;
    btn.setAttribute('aria-label', isOpen ? 'Cerrar chat' : 'Abrir chat');
  });
})();
