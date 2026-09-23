import { Signals } from './constants.js';

export class NotificationCenter {
  constructor({ signals, max = 50 } = {}) {
    this.signals = signals;
    this.max = max;
    this.items = [];
  }

  push(notification) {
    const item = Object.freeze({
      id: notification.id ?? `notice-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      status: notification.status ?? 'ready',
      title: notification.title ?? '',
      message: notification.message ?? '',
      createdAt: notification.createdAt ?? Date.now(),
    });
    this.items.unshift(item);
    if (this.items.length > this.max) this.items.length = this.max;
    this.signals?.publish(Signals.UI_NOTIFICATION, { id: item.id, status: item.status, title: item.title, message: item.message }, { source: 'ui-core' });
    return item;
  }
}

export class ToastViewport {
  constructor({ host, signals, scope, limit = 4 } = {}) {
    this.host = host;
    this.signals = signals;
    this.scope = scope;
    this.limit = limit;
    this.items = [];
  }

  mount() {
    this.host.classList.add('a52-toast-viewport');
    this.host.setAttribute('aria-live', 'polite');
    this.scope.subscribe(this.signals, Signals.UI_NOTIFICATION, ({ payload }) => {
      this.items.unshift(payload);
      this.items.length = Math.min(this.items.length, this.limit);
      this.render();
    });
  }

  render() {
    const doc = this.host.ownerDocument;
    this.host.replaceChildren(...this.items.map((item) => {
      const node = doc.createElement('div');
      node.className = 'a52-toast';
      node.dataset.status = item.status;
      node.innerHTML = '<strong></strong><span></span>';
      node.querySelector('strong').textContent = item.title;
      node.querySelector('span').textContent = item.message;
      return node;
    }));
  }
}
